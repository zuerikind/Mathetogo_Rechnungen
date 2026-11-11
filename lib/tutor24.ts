import { prisma } from "./prisma";
import { assertNoAutomationRunning, tutor24JobState as jobState } from "./automation-state";
import { acquireTutor24Lock } from "./tutor24-lock";
import { savedSession, signIn } from "./tutor24-session";
import {
  personalSentenceChecked,
  personalSentenceV3,
  generateTutor24Message,
  TUTOR24_MESSAGE_TEMPLATE,
} from "./tutor24-message-prompt";
import { agenturVerdacht, assembleFirstMessage, festerSatz, festeZweiSaetze, matheNebenfach, planFirstMessage, satzStufe } from "./tutor24-course-offer";
import { addMarkiert, loadMarkiert, wahlOf } from "./tutor24-batch";
import { rueckfrageArt, unsicherGruende, type Rueckfrage } from "./tutor24-rueckfragen";
import { agentProtokoll, agentZaehlen, pruefAgent, urteilLabel, type AgentPass } from "./tutor24-pruefagent";
import { courseSnapshot, parseJobText, type ListingInfo } from "./tutor24-followup";
import { loadCourses, loadLog, loadSettings } from "./tutor24-followup-store";
import { listingHash, recordSend, type LeadFields } from "./tutor24-leads";
import {
  CookieBannerError,
  EXISTING_CONVO_SEL,
  TUTOR24_BASE_URL,
  buildPaginatedUrl,
  collectListingLinks,
  extractProfile,
  findVisible,
  gotoTutor24,
  isSameSearchResultsPage,
  acceptTutor24Cookies,
  jsClick,
  resolveTargetLanguage,
  sendMessageOnListing,
  sleep,
  ts,
  waitForJobListingReady,
  type ListingProfile,
} from "./tutor24-messaging";

import { StopRun, assertPageOk } from "./tutor24-followup-runner";
import { isHardStop, type PassCounts } from "./tutor24-autopilot";

export type { Tutor24Result } from "./tutor24-types";

/** Automatik (scripts/autopilot.mts): Tageslimit, Probe ohne Senden, Zeitfenster/Notbremse vor jeder Nachricht. */
export type AutoErst = {
  limit: number;
  dryRun: boolean;
  mayContinue: () => string | null;
  counts: PassCounts;
  probe: string[];
  /** Hinweise fuer die Telegram-Meldung (z. B. alter Text als Rueckfall), auch im echten Betrieb */
  notes?: string[];
  /** begrenzter Probelauf: hoechstens so viele Inserate oeffnen (auch uebersprungene zaehlen) */
  maxOpen?: number;
  /** Probe: vollstaendige Texte der Erst-Nachrichten, die gesendet wuerden (Telegram, je eine Meldung) */
  texte?: string[];
  /**
   * Automatik (11.11.): unsichere Nachricht als Rueckfrage stellen (lib/tutor24-rueckfragen.ts) statt senden.
   * Fehlt die Funktion, gelten alle als Rueckfrage → Liste "markiert".
   */
  rueckfrage?: (r: Omit<Rueckfrage, "tag" | "erstelltAm" | "status">) => Promise<"gestellt" | "liste" | "schon">;
  /** Probe: unsichere Nachrichten fuer Probe-Rueckfragen (Knoepfe ausprobieren, nichts wird gesendet) */
  probeRueckfragen?: Array<Omit<Rueckfrage, "tag" | "erstelltAm" | "status">>;
  /** Probe: erste sichere Nachricht, falls keine unsichere dabei ist */
  probeBeispiel?: Omit<Rueckfrage, "tag" | "erstelltAm" | "status">;
  /** Pruef-Agent: Zaehler des Durchgangs (mit Nachfassen geteilt); halt → mayContinue haelt an */
  agent?: AgentPass;
  /** Batch vorbereiten (scripts/batch.mts): Nachricht nur sammeln, nichts senden */
  collect?: (item: CollectedListing) => void;
};
export type CollectedListing = {
  tutor24Id: string;
  href: string;
  title: string;
  info: ListingInfo;
  plan: ReturnType<typeof planFirstMessage>;
  composed: Awaited<ReturnType<typeof composeFirstMessage>>;
  language: "de" | "en" | "fr";
};
export { tutor24JobState as jobState } from "./automation-state";

export const MESSAGE_TEMPLATE = TUTOR24_MESSAGE_TEMPLATE;

/** Erst-Nachricht (de/en): Analyse, Kurswahl, KI-Satz, Pruefung. Auch vom Probelauf (scripts/course-offer-dryrun.mts) genutzt. */
export async function composeFirstMessage(
  info: ListingInfo,
  log: (s: string) => void,
  now = new Date(),
  sprache: "de" | "en" | "fr" = "de",
  anredeOverride?: import("./tutor24-followup").Addressee
) {
  const plan = planFirstMessage(info, loadCourses(), loadSettings(), await loadLog(), now, sprache, anredeOverride);
  const f = plan.form;
  // Abgelehnt → zweiter Versuch mit dem Grund; erst danach der Ersatzsatz.
  const settings = loadSettings();
  let personal: string | null;
  let v3: "ki" | "fest" | "ohne" | null = null;
  if (settings.satzV4) {
    // v4 (nach Omids OK): zwei Saetze (verstanden + Anpassung), ohne Detail die festen zwei Saetze der Stufe
    const r = await personalSentenceV3(info, f, festeZweiSaetze(satzStufe(plan.analysis, info), f, settings.zweiSaetze), log, true);
    personal = r.satz;
    v3 = r.quelle;
    if (r.gruende.length) log(`Zwei Sätze v4: ${r.quelle}${r.detail ? ` (Detail „${r.detail}“)` : ""}, Gründe: ${r.gruende.join("; ")}`);
  } else if (settings.satzV3) {
    // v3 (nach Omids OK): KI nur mit konkretem Detail, sonst fester Satz der Stufe, ohne Stufe kein Satz
    const r = await personalSentenceV3(info, f, festerSatz(satzStufe(plan.analysis, info), f, settings.festeSaetze), log);
    personal = r.satz;
    v3 = r.quelle;
    if (r.gruende.length) log(`Satz v3: ${r.quelle}${r.detail ? ` (Detail „${r.detail}“)` : ""}, Gründe: ${r.gruende.join("; ")}`);
  } else {
    const ki = await personalSentenceChecked(info, f, log);
    personal = ki.satz;
    if (ki.gruende.length) log(`KI-Satz: ${ki.versuche} Versuch(e), abgelehnt: ${ki.gruende.join("; ")}`);
  }
  const assembled = assembleFirstMessage(plan, personal);
  const m = v3 && assembled.satz === "ki" ? { ...assembled, satz: v3 } : assembled;
  log(
    `Anrede=${plan.addressee.wer}${plan.addressee.kind ? `/${plan.addressee.kind}` : ""} Stufe=${plan.analysis.kategorie}/${plan.analysis.kursgruppe || "-"} ` +
      `(${plan.analysis.sicherheit}) → ${m.course ? `Kurs „${m.course.name}“` : m.hint ? "Kurs-Hinweis" : plan.offer.kind === "nachfrage" ? `Nachfrage: ${plan.offer.grund}` : `kein Kurs (${plan.offer.kind === "nichts" ? plan.offer.grund : "Prüfung"})`}, Satz=${m.satz}`
  );
  return { ...m, plan };
}

/** Analyse beim ersten Kontakt → Tutor24Lead (auch ohne Kurs: Interessentenliste auf /kurse). */
export function leadFields(info: ListingInfo, plan: ReturnType<typeof planFirstMessage>, sprache: string): LeadFields {
  const a = plan.analysis;
  const offer = plan.offer;
  return {
    quelle: "erstnachricht",
    listingHash: listingHash([info.title, info.fach, info.schulstufe, info.description]),
    faecher: a.faecher, stufe: info.schulstufe, kategorie: a.kategorie, kursgruppe: a.kursgruppe, sicherheit: a.sicherheit,
    ausschluss: a.ausschluss, anlass: a.anlass, ort: a.ort, ortsname: a.ortsname,
    wer: plan.addressee.wer, anrede: plan.addressee.anrede, kind: plan.addressee.kind, sprache,
    grund: offer.kind === "kurs" ? "" : offer.grund,
    auszug: info.description.replace(/\s+/g, " ").slice(0, 300),
  };
}

/** Konversation nach dem Senden: aus der URL oder dem Link "Konversation öffnen" (sonst verknuepft der Probelauf). */
async function conversationIdOnPage(page: import("playwright").Page): Promise<string | null> {
  const fromUrl = page.url().match(/conversations\/(\d+)/)?.[1];
  if (fromUrl) return fromUrl;
  const href = await page.locator('a[href*="/conversations/"]').first().getAttribute("href", { timeout: 2000 }).catch(() => null);
  return href?.match(/conversations\/(\d+)/)?.[1] ?? null;
}

const BASE_URL = TUTOR24_BASE_URL;
/** Logged-in tutors land on /jobs/search (students/search redirects there). */
const SEARCH_BASE = `${BASE_URL}/de/jobs/search?q%5Bplace%5D=8000%2C+Z%C3%BCrich`;

function searchUrl(subject: string, pageNum: number) {
  const q = encodeURIComponent(subject);
  return `${SEARCH_BASE}&q%5Bsubject_cont%5D=${q}&q%5Bdistance%5D=100&page=${pageNum}`;
}

export async function runTutor24Messaging(
  headless = false,
  maxPages = 10,
  subjects = ["Mathematik", "Physik"],
  auto?: AutoErst
): Promise<import("./tutor24-types").Tutor24Result> {
  assertNoAutomationRunning("tutor24");

  const email = process.env.TUTOR24_EMAIL;
  const password = process.env.TUTOR24_PASSWORD;
  if (!email || !password) throw new Error("TUTOR24_EMAIL and TUTOR24_PASSWORD must be set in .env.local");

  // Gemeinsam mit scripts/followup_group_offer.mts: nie zwei Laeufe auf demselben Konto.
  // ponytail: scheitert der Browserstart, bleibt die Sperre bis zum Neustart des Servers.
  const releaseLock = acquireTutor24Lock("Erst-Nachrichten-Automation");
  jobState.running = true;
  jobState.startedAt = new Date();

  const result: import("./tutor24-types").Tutor24Result = {
    messaged: 0,
    skipped: 0,
    errors: [],
    log: [],
    newContacts: [],
  };
  jobState.result = result;
  let opened = 0;

  const { chromium } = await import("playwright");

  const browser = await chromium.launch({
    headless,
    slowMo: headless ? 0 : 80,
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    storageState: savedSession(),
  });
  // Unter tsx (Automatik, scripts/*.mts) fuegt esbuild in Browser-Funktionen __name(...) ein; ohne diese
  // Definition scheitert jedes page.evaluate mit "__name is not defined" (Probelauf 6.11., alle Inserate).
  await context.addInitScript({ content: "globalThis.__name = globalThis.__name || function (f) { return f; };" });
  const page = await context.newPage();

  try {
    result.log.push(`${ts()} ${await signIn(page, email, password)}`);
    await acceptTutor24Cookies(page, (s) => result.log.push(s));
    await assertPageOk(page, "nach dem Login");

    for (const subject of subjects) {
      result.log.push(`${ts()} ════ Suche: ${subject} ════`);

      await gotoTutor24(page, SEARCH_BASE, (s) => result.log.push(s));
      await assertPageOk(page, "Suche");
      await sleep(1000);

      let subjectBaseUrl = searchUrl(subject, 1);

      const INPUT_SEL = [
        'input[name*="subject"]',
        'input[name*="fach"]',
        'input[placeholder*="Fach"]',
        'input[placeholder*="fach"]',
        'input[id*="subject"]',
        'input[id*="fach"]',
      ].join(", ");

      const inputEl = await findVisible(page, INPUT_SEL);
      let formFilled = false;

      if (inputEl) {
        await inputEl.fill(subject);
        await sleep(700);
        const autoItem = await findVisible(
          page,
          `[class*="dropdown"] *:has-text("${subject}"), ` +
            `[class*="suggest"] *:has-text("${subject}"), ` +
            `[role="option"]:has-text("${subject}"), ` +
            `[role="listbox"] li:has-text("${subject}")`
        );
        if (autoItem) {
          result.log.push(`${ts()} Autocomplete-Vorschlag geklickt`);
          await jsClick(autoItem);
          await sleep(400);
        }
        formFilled = true;
        result.log.push(`${ts()} Textfeld befüllt mit "${subject}"`);
      } else {
        const SELECT_SEL = [
          'select[name*="subject"]',
          'select[name*="fach"]',
          'select[id*="subject"]',
          'select[id*="fach"]',
        ].join(", ");
        const matchedOpt = await page.evaluate(
          ([sel, subj]: [string, string]) => {
            const el = document.querySelector(sel) as HTMLSelectElement | null;
            if (!el) return null;
            const opt = Array.from(el.options).find(
              (o) =>
                o.text.toLowerCase().includes(subj.toLowerCase()) ||
                o.value.toLowerCase().includes(subj.toLowerCase())
            );
            if (!opt) return null;
            el.value = opt.value;
            el.dispatchEvent(new Event("change", { bubbles: true }));
            return opt.text;
          },
          [SELECT_SEL, subject] as [string, string]
        );
        if (matchedOpt) {
          result.log.push(`${ts()} Select-Option gewählt: "${matchedOpt}"`);
          formFilled = true;
        }
      }

      if (!formFilled) {
        result.log.push(`${ts()} ⚠ Kein Suchfeld gefunden — Fallback auf URL-Parameter`);
      }

      const radiusSet = await page.evaluate(() => {
        const SLIDER_SEL = [
          'input[type="range"][name*="radius"]',
          'input[type="range"][id*="radius"]',
          'input[type="range"][class*="radius"]',
          'input[type="range"]',
        ].join(", ");
        const slider = document.querySelector(SLIDER_SEL) as HTMLInputElement | null;
        if (!slider) return false;
        const max = slider.max || "100";
        slider.value = max;
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        slider.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      });
      result.log.push(
        radiusSet ? `${ts()} Radius-Slider auf Maximum gesetzt` : `${ts()} Kein Radius-Slider gefunden`
      );

      const submitBtn = await findVisible(
        page,
        'button[type="submit"], input[type="submit"], button:has-text("Suchen"), button:has-text("Search")'
      );
      if (submitBtn) {
        const beforeUrl = page.url();
        await jsClick(submitBtn);
        try {
          await page.waitForURL((u) => u.toString() !== beforeUrl, {
            timeout: 15000,
            waitUntil: "domcontentloaded",
          });
        } catch {
          await sleep(2000);
        }
        const postSubmitUrl = page.url();
        if (postSubmitUrl !== SEARCH_BASE && postSubmitUrl.includes("/search")) {
          subjectBaseUrl = postSubmitUrl.replace(/([?&])page=\d+&?/, "$1").replace(/[?&]$/, "");
          result.log.push(`${ts()} ✓ Filter-URL: ${subjectBaseUrl}`);
        } else {
          result.log.push(`${ts()} ⚠ Submit führte zu keiner Filterseite (${postSubmitUrl}) — Fallback`);
        }
      } else {
        result.log.push(`${ts()} ⚠ Kein Submit-Button gefunden — Fallback auf URL-Parameter`);
      }

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        result.log.push(`${ts()} ── ${subject} Seite ${pageNum}/${maxPages} ──`);

        const listingUrl = buildPaginatedUrl(subjectBaseUrl, pageNum);
        const alreadyOnResults =
          pageNum === 1 && isSameSearchResultsPage(page.url(), listingUrl);

        if (alreadyOnResults) {
          result.log.push(`${ts()} Suchergebnisse bereits geladen — sammle Links`);
        } else {
          result.log.push(`${ts()} Lade ${listingUrl}`);
          await gotoTutor24(page, listingUrl, (s) => result.log.push(s));
          await assertPageOk(page, `Suchseite ${pageNum}`);
        }
        await acceptTutor24Cookies(page, (s) => result.log.push(s));

        const links = await collectListingLinks(page, "jobs", (s) => result.log.push(s));

        if (links.length === 0) {
          result.log.push(
            `${ts()} Seite ${pageNum}: keine Gesuche auf ${page.url()} — Ende (evtl. Filter/Suche prüfen)`
          );
          break;
        }
        result.log.push(`${ts()} Seite ${pageNum}: ${links.length} Gesuche gefunden (${page.url()})`);

        for (const { href, id: tutor24Id } of links) {
          if (jobState.shouldStop) {
            result.log.push(`${ts()} ⏹ Gestoppt durch Benutzer`);
            break;
          }
          try {
            // Automatik: Limit, Zeitfenster und Notbremse VOR dem Oeffnen (spart auch den KI-Aufruf).
            const halt =
              auto &&
              (auto.counts.gesendet + auto.counts.wuerde >= auto.limit
                ? `Tageslimit ${auto.limit} erreicht`
                : auto.maxOpen !== undefined && opened >= auto.maxOpen
                  ? `${auto.maxOpen} Inserate geöffnet (begrenzter Lauf)`
                  : auto.mayContinue());
            if (halt) {
              result.log.push(`${ts()} ⏹ ${halt}`);
              jobState.shouldStop = true;
              break;
            }
            const existing = await prisma.tutor24Contact.findUnique({ where: { tutor24Id } });
            if (existing) {
              result.skipped++;
              result.log.push(`${ts()} [${tutor24Id}] bereits in DB — übersprungen`);
              continue;
            }
            // Automatik: schon markierte Inserate (Agentur, Nebenfach, Pruefung) nicht nochmals oeffnen — Omid prueft sie auf /kurse.
            if (auto && !auto.collect && loadMarkiert().some((m) => m.id === tutor24Id)) {
              result.skipped++;
              result.log.push(`${ts()} [${tutor24Id}] markiert (Liste auf /kurse) — übersprungen`);
              continue;
            }

            // Automatik: 8–15 s zwischen Inseraten wie beim Nachfassen. Ohne Pause folgte am 5.11. ein 429
            // (Inserate im Sekundentakt direkt nach 133 Aufrufen der Antwortpruefung).
            if (auto && opened > 0) await sleep(8_000 + Math.random() * 7_000);
            opened++;
            result.log.push(`${ts()} [${tutor24Id}] Öffne ${href}`);
            await gotoTutor24(page, href, (s) => result.log.push(s));
            await waitForJobListingReady(page, tutor24Id, (s) => result.log.push(s));
            await assertPageOk(page, `Inserat ${tutor24Id}`);

            const listingTitle = await page.title();
            const displayName = listingTitle.split(/[-–|]/)[0].trim() || tutor24Id;
            const pageUrl = page.url();

            const existingConvo = await findVisible(page, EXISTING_CONVO_SEL);
            if (existingConvo) {
              result.log.push(`${ts()} [${tutor24Id}] Konversation bereits vorhanden — übersprungen`);
              result.skipped++;
              continue;
            }

            const extracted = await extractProfile(page, displayName, subject, listingTitle);
            const { language, source } = resolveTargetLanguage(
              pageUrl,
              extracted.htmlLang,
              extracted.pageTitle,
              extracted.bodyText
            );
            const profile: ListingProfile = {
              name: extracted.name,
              subject: extracted.subject,
              bodyText: extracted.bodyText,
              pageTitle: extracted.pageTitle,
              language,
            };
            result.log.push(
              `${ts()} [${tutor24Id}] Sprache=${language} (${source}, URL=${pageUrl.match(/\/(de|en|fr)\//)?.[1] ?? "?"}) ` +
                `bodyText="${profile.bodyText.slice(0, 80) || "(leer)"}"`
            );
            const tag = (s: string) => result.log.push(`${ts()} [${tutor24Id}] ${s}`);
            // Seit 6.11. immer der neue Text (de/en): Anrede, Sprache, persoenlicher Satz; Kursblock bzw. Kurs-Hinweis
            // je nach Schalter. Der alte Text nur noch als Rueckfall, wenn der neue die Pruefung nicht besteht (wird gemeldet).
            // Franzoesisch: KI-Text in der vous-Form wie bisher, Hinweis als fester Absatz.
            let message: string;
            let kursId: string | null = null;
            let hint: string | null = null;
            let altText: string | null = null;
            const info = parseJobText(await page.evaluate(() => document.body.innerText), listingTitle);
            // Analyse immer (ohne KI): die Person kommt so oder so in Tutor24Lead.
            let plan = planFirstMessage(info, loadCourses(), loadSettings(), await loadLog(), new Date(), language);
            // Automatik (10./11.11.): Agentur- oder Nebenfach-Verdacht nie von selbst anschreiben — Rueckfrage per Telegram
            // (lib/tutor24-rueckfragen.ts) oder Liste auf /kurse; "Pruefung nicht bestanden" immer Liste.
            const markieren = (grund: string) => {
              addMarkiert({ id: tutor24Id, titel: info.title || displayName, link: href, grund, am: new Date().toISOString() });
              auto!.counts.uebersprungen++;
              auto!.notes?.push(`⚠ Nicht angeschrieben, Liste auf /kurse: https://tutor24.ch/de/jobs/${tutor24Id} · ${grund}`);
              tag(`markiert, nicht angeschrieben: ${grund}`);
            };
            const verdacht = auto && !auto.collect ? agenturVerdacht(info) : null;
            const nebenfach = auto && !auto.collect ? matheNebenfach(info) : null;
            // Seit 9.11. auch Franzoesisch mit festem Text (vous) statt KI-Uebersetzung der alten du-Vorlage.
            const composed = await composeFirstMessage(info, tag, new Date(), language);
            plan = composed.plan;
            if (auto?.collect) {
              // Batch: nur vorbereiten, nie den alten Text; fehlerhafte erscheinen mit Grund in der Vorschau (nicht sendbar).
              auto.collect({ tutor24Id, href, title: info.title, info, plan, composed, language });
              auto.counts.wuerde++;
              continue;
            }
            if (composed.problem && auto) {
              // Automatik wie Batch: nie der alte Text; zaehlt als Pruefungsfehler (mehr als 3 → Automatik aus).
              auto.counts.pruefungFehler++;
              markieren(`Prüfung nicht bestanden: ${composed.problem}`);
              continue;
            }
            // Sicher oder Rueckfrage? (Omid, 11.11.) Sicher = fester Text, Anrede erkannt (oder unklar + neutraler Text),
            // Stufe erkannt, Deutsch, keine Markierung. Alles andere stellt die Automatik als Rueckfrage; die Probe zeigt es nur.
            let sicherLabel = "";
            if (auto && !auto.collect && loadSettings().pruefAgent) {
              // Pruef-Agent (Omid, 11.11. abends): Markierungen nie automatisch (Liste; Probe zeigt sie nur), sonst entscheidet der Agent.
              const mark = verdacht ? `Möglicherweise Agentur: ${verdacht}` : nebenfach ? `Mathe nur Nebenfach: ${nebenfach}` : null;
              if (mark) {
                if (auto.dryRun) {
                  auto.counts.uebersprungen++;
                  auto.notes?.push(`🏷 Würde markiert (Liste auf /kurse): https://tutor24.ch/de/jobs/${tutor24Id} · ${mark}`);
                } else markieren(mark);
                continue;
              }
              const u = await pruefAgent({ art: "erst", titel: info.title || displayName, fach: info.fach, stufe: info.schulstufe, beschreibung: info.description, text: composed.text });
              const vorher = auto.agent?.halt;
              if (auto.agent) agentZaehlen(auto.agent, u);
              agentProtokoll({ id: tutor24Id, art: "erst", titel: info.title || displayName, urteil: u.urteil, grund: u.grund, probe: auto.dryRun || undefined });
              tag(`Prüf-Agent: ${u.urteil}${u.grund ? ` — ${u.grund}` : ""}`);
              if (auto.dryRun && auto.agent?.halt && !vorher) auto.notes?.push(`⛔ Im echten Betrieb würde hier gestoppt: ${auto.agent.halt}`);
              sicherLabel = urteilLabel(u);
              const sicherInput = { sprache: language, wer: plan.addressee.wer, satz: composed.satz, problem: composed.problem, agentur: verdacht, nebenfach };
              const r = {
                id: tutor24Id, titel: info.title || displayName, stufe: info.schulstufe, link: href, sprache: language, anrede: wahlOf(plan.addressee),
                grund: u.urteil === "ok" ? "" : u.urteil === "auffaellig" ? `Prüf-Agent: ${u.grund}` : u.grund,
                art: rueckfrageArt(sicherInput), text: composed.text, kursId: composed.course?.id ?? null, hint: composed.hint, satz: composed.satz, info,
              };
              if (auto.dryRun && auto.probeRueckfragen) {
                if (u.urteil !== "ok") auto.probeRueckfragen.push(r);
                else if (!auto.probeBeispiel) auto.probeBeispiel = { ...r, grund: "Beispiel — der Agent hat diese Nachricht mit ok bewertet" };
              }
              if (u.urteil !== "ok" && !auto.dryRun) {
                const ergebnis = auto.rueckfrage ? await auto.rueckfrage(r) : "liste";
                if (ergebnis === "liste") markieren(`${r.grund} (ohne Rückfrage)`);
                else {
                  auto.counts.rueckfragen = (auto.counts.rueckfragen ?? 0) + 1;
                  tag(`Rückfrage ${ergebnis === "schon" ? "besteht schon" : "gestellt"}: ${r.grund}`);
                }
                continue;
              }
            } else if (auto && !auto.collect) {
              const sicherInput = { sprache: language, wer: plan.addressee.wer, satz: composed.satz, problem: composed.problem, agentur: verdacht, nebenfach };
              const gruende = unsicherGruende(sicherInput, loadSettings());
              sicherLabel = gruende.length ? `❓ Rückfrage: ${gruende.join("; ")}` : "✅ sicher";
              const r = {
                id: tutor24Id, titel: info.title || displayName, stufe: info.schulstufe, link: href, sprache: language, anrede: wahlOf(plan.addressee),
                grund: gruende.join("; "), art: rueckfrageArt(sicherInput), text: composed.text, kursId: composed.course?.id ?? null, hint: composed.hint, satz: composed.satz, info,
              };
              // Probe: unsichere als Probe-Rueckfrage (Knoepfe ohne echtes Senden); gibt es keine, eine sichere als Beispiel
              if (auto.dryRun && auto.probeRueckfragen) {
                if (gruende.length) auto.probeRueckfragen.push(r);
                else if (!auto.probeBeispiel) auto.probeBeispiel = { ...r, grund: "Beispiel — diese Nachricht gilt als sicher" };
              }
              if (gruende.length && !auto.dryRun) {
                const ergebnis = auto.rueckfrage ? await auto.rueckfrage(r) : "liste";
                if (ergebnis === "liste") markieren(`${r.grund} (ohne Rückfrage)`);
                else {
                  auto.counts.rueckfragen = (auto.counts.rueckfragen ?? 0) + 1;
                  tag(`Rückfrage ${ergebnis === "schon" ? "besteht schon" : "gestellt"}: ${r.grund}`);
                }
                continue;
              }
            }
            if (composed.problem) {
              altText = composed.problem;
              tag(`⚠ Neuer Text besteht die Prüfung nicht (${composed.problem}) — alter Text als Rückfall`);
              message = await generateTutor24Message(profile, tag);
            } else {
              message = composed.text;
              kursId = composed.course?.id ?? null;
              hint = composed.hint;
            }
            const kindLabel = kursId ? "Kursblock" : hint ? "Hinweis" : "ohne Kurs";
            /** nur fuer Gesendetes bzw. im Probemodus "wuerde gesendet" */
            const countKind = () => {
              if (!auto) return;
              if (kursId) auto.counts.kurs = (auto.counts.kurs ?? 0) + 1;
              else if (hint) auto.counts.hinweis = (auto.counts.hinweis ?? 0) + 1;
              if (altText) auto.notes?.push(`⚠ Inserat https://tutor24.ch/de/jobs/${tutor24Id}: alter Text${auto.dryRun ? " würde gesendet" : " gesendet"} (neuer Text: ${altText})`);
            };

            if (auto?.dryRun) {
              const course = kursId ? loadCourses().find((c) => c.id === kursId) : null;
              auto.counts.wuerde++;
              countKind();
              // Inserate haben keinen Personennamen (displayName ist der Titel): nur Link, Kurs — nichts aus dem Inserat.
              auto.probe.push(`Inserat https://tutor24.ch/de/jobs/${tutor24Id} · ${course?.name ?? kindLabel}${altText ? " (alter Text)" : ""} · Erst-Nachricht`);
              auto.texte?.push(`${sicherLabel}\nhttps://tutor24.ch/de/jobs/${tutor24Id} · ${info.title || displayName}\n\n${message}`);
              tag(`PROBE — würde senden (${course?.name ?? kindLabel}):\n${message}`);
              continue;
            }
            // Notbremse direkt vor dem Senden nochmals lesen (KI-Text und Seitenaufbau dauern bis zu 30 s).
            const haltNow = auto?.mayContinue();
            if (haltNow) {
              result.log.push(`${ts()} ⏹ ${haltNow} — ${tutor24Id} nicht gesendet`);
              jobState.shouldStop = true;
              break;
            }
            const outcome = await sendMessageOnListing(page, message, tutor24Id, displayName, (s) =>
              result.log.push(s),
              href
            );

            if (outcome === "sent") {
              await prisma.tutor24Contact.create({ data: { tutor24Id, name: displayName, profileUrl: href, kursId } });
              const course = kursId ? loadCourses().find((c) => c.id === kursId) : null;
              await recordSend({
                inseratId: tutor24Id,
                conversationId: await conversationIdOnPage(page),
                name: displayName,
                art: "erst",
                kursId,
                // "hinweis/…": Antworten darauf erkennt die Interessentenliste (hat auf Kurs-Hinweis geantwortet)
                variante: course ? `${course.name}/${plan.addressee.anrede}` : hint ? `hinweis/${plan.addressee.anrede}` : `ohne Kurs/${plan.addressee.anrede}`,
                text: message,
                status: "gesendet",
                kursDaten: course ? courseSnapshot(course) : null,
                lead: leadFields(info, plan, language),
              });
              result.messaged++;
              if (auto) {
                auto.counts.gesendet++;
                countKind();
              }
              result.newContacts.push({ name: displayName, tutor24Id, profileUrl: href });
              await sleep(1500);
            } else if (outcome === "skipped_no_button") {
              result.skipped++;
              if (auto) auto.counts.uebersprungen++;
            } else if (outcome === "skipped_no_textarea") {
              result.errors.push(`No textarea: ${tutor24Id} (${displayName})`);
            } else if (outcome === "error_no_submit") {
              result.errors.push(`No submit button: ${tutor24Id} (${displayName})`);
            } else if (outcome === "error_unconfirmed") {
              result.errors.push(`Send unconfirmed: ${tutor24Id} (${displayName})`);
            }
          } catch (err) {
            // Captcha, Sicherheitsabfrage, Login-Umleitung: sofort ganz aufhoeren, nichts weiter versuchen.
            if (err instanceof StopRun || isHardStop(err instanceof Error ? err.message : String(err))) throw err;
            // Cookie-Fenster bleibt offen: ganzer Lauf sauber beenden, nichts weiter senden.
            if (err instanceof CookieBannerError) {
              result.errors.push(err.message);
              result.log.push(`${ts()} ✖ ${err.message}`);
              jobState.shouldStop = true;
              break;
            }
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push(`[${tutor24Id}] ${msg}`);
            result.log.push(`${ts()} [${tutor24Id}] Fehler: ${msg}`);
          }
          if (jobState.shouldStop) break;
        }
        if (jobState.shouldStop) break;
      }
      if (jobState.shouldStop) break;
    }
  } finally {
    await browser.close();
    releaseLock();
    jobState.running = false;
    jobState.shouldStop = false;
    jobState.result = result;
  }

  return result;
}

/**
 * Batch senden (scripts/batch.mts): genau die freigegebenen Erst-Nachrichten, Text wie in der Vorschau.
 * Vor jedem Inserat nochmals: schon angeschrieben (Tutor24Contact) oder Konversation vorhanden → übersprungen.
 * 8–15 s zwischen den Inseraten; 429/Captcha/Login (StopRun, isHardStop) beenden sofort.
 */
export async function sendBatchErst(
  items: import("./tutor24-batch").BatchItem[],
  log: (s: string) => void,
  onResult: (item: import("./tutor24-batch").BatchItem) => void
): Promise<void> {
  const email = process.env.TUTOR24_EMAIL;
  const password = process.env.TUTOR24_PASSWORD;
  if (!email || !password) throw new Error("TUTOR24_EMAIL and TUTOR24_PASSWORD must be set in .env.local");
  const { addresseeFor } = await import("./tutor24-batch");
  const releaseLock = acquireTutor24Lock("Batch (Erst-Nachrichten senden)");
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      storageState: savedSession(),
    });
    await context.addInitScript({ content: "globalThis.__name = globalThis.__name || function (f) { return f; };" });
    const page = await context.newPage();
    log(await signIn(page, email, password));
    await acceptTutor24Cookies(page, log);
    await assertPageOk(page, "nach dem Login");
    let opened = 0;
    for (const item of items) {
      const done = (ergebnis: "gesendet" | "übersprungen" | "fehler", meldung: string) => {
        item.ergebnis = ergebnis;
        item.meldung = meldung;
        log(`[${item.id}] ${ergebnis}: ${meldung}`);
        onResult(item);
      };
      if (await prisma.tutor24Contact.findUnique({ where: { tutor24Id: item.id } })) {
        done("übersprungen", "schon angeschrieben");
        continue;
      }
      if (opened++ > 0) await sleep(8_000 + Math.random() * 7_000);
      try {
        await gotoTutor24(page, item.link, log);
        await waitForJobListingReady(page, item.id, log);
        await assertPageOk(page, `Inserat ${item.id}`);
        if (await findVisible(page, EXISTING_CONVO_SEL)) {
          done("übersprungen", "Konversation schon vorhanden");
          continue;
        }
        const outcome = await sendMessageOnListing(page, item.text, item.id, item.titel, log, item.link);
        if (outcome !== "sent") {
          done(outcome === "skipped_no_button" ? "übersprungen" : "fehler", outcome);
          continue;
        }
        await prisma.tutor24Contact.create({ data: { tutor24Id: item.id, name: item.titel, profileUrl: item.link, kursId: item.kursId } });
        const info = item.info!;
        const plan = planFirstMessage(info, loadCourses(), loadSettings(), await loadLog(), new Date(), item.sprache, addresseeFor(item.anrede));
        const course = item.kursId ? loadCourses().find((c) => c.id === item.kursId) ?? null : null;
        await recordSend({
          inseratId: item.id,
          conversationId: await conversationIdOnPage(page),
          name: item.titel,
          art: "erst",
          kursId: item.kursId,
          variante: course ? `${course.name}/${plan.addressee.anrede}` : item.hint ? `hinweis/${plan.addressee.anrede}` : `ohne Kurs/${plan.addressee.anrede}`,
          text: item.text,
          status: "gesendet",
          kursDaten: course ? courseSnapshot(course) : null,
          lead: leadFields(info, plan, item.sprache),
        });
        done("gesendet", "✓");
        await sleep(1500);
      } catch (err) {
        if (err instanceof StopRun || err instanceof CookieBannerError || isHardStop(err instanceof Error ? err.message : String(err))) throw err;
        done("fehler", err instanceof Error ? err.message.slice(0, 200) : String(err));
      }
    }
  } finally {
    await browser.close();
    releaseLock();
  }
}
