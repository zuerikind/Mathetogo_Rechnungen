/**
 * Der eigentliche Nachfass-Lauf auf tutor24.ch. Aufgerufen von
 * scripts/followup_group_offer.mts (Kommandozeile) und /api/tutor24/followup (App).
 *
 * Probelauf: liest, analysiert ALLE Konversationen (Stufe, Faecher, Klasse, Ort,
 * Zeitwunsch, Anlass) und schreibt die Vorschau-CSV nach jeder Konversation;
 * ein neuer Lauf setzt dort fort. Sendet nie.
 * Senden: nur effektiver Status "wird gesendet" (aktiver passender Kurs, status=send),
 * hoechstens 25 pro Tag, 60–180 s Pause.
 * Antworten pruefen: liest nur Konversationen aus dem Protokoll, sendet nie; geoeffnet
 * werden nur die, bei denen die Konversationsliste neue Aktivitaet zeigt.
 * Vergleich (--compare N): wertet N Konversationen einmal nur mit der Konversationsseite
 * und einmal mit Inserat aus, schreibt die Unterschiede in compare.csv. Sendet nie.
 *
 * Schneller nur ueber weniger Seitenaufrufe, nie ueber kuerzere Pausen: Konversationsliste
 * aus dem Zwischenspeicher, Inserat optional nur bei Bedarf, Bilder/Schriften/Tracker blockiert.
 * Zeitmessung pro Phase in timing.csv.
 *
 * Abbruch ohne Umgehungsversuch bei Captcha, 429/Fehlerseite, Login-Problem oder
 * unerwartetem Seitenaufbau. Mit der Erst-Nachrichten-Automation geteilt werden
 * nur der Login (lib/tutor24-messaging.ts) und die Sperre (lib/tutor24-lock.ts).
 */
import type { Page } from "playwright";
import { followupJobState as state } from "./automation-state";
import {
  MAX_AGE_DAYS,
  MIN_AGE_DAYS,
  FOLLOWUP_MARKER,
  ageDays,
  analyzeListing,
  compareAnalyses,
  entryChanged,
  findReply,
  hasNewActivity,
  needsReplyCheck,
  isOfferLevel,
  listSender,
  listSkipReason,
  listingFromConversation,
  needsListing,
  parseTutor24Date,
  scrollStop,
  snippetSig,
  validateCourses,
  type Bubble,
  type ListCache,
  type ListEntry,
  type ListingInfo,
  type PreviewRow,
} from "./tutor24-followup";
import {
  COMPARE_COLS,
  COMPARE_PATH,
  PREVIEW_PATH,
  LOG_PATH,
  TIMING_COLS,
  TIMING_PATH,
  appendCsv,
  appendLog,
  clearStop,
  loadCourses,
  loadListCache,
  loadSettings,
  loggedIds,
  readLog,
  readPreview,
  saveListCache,
  sendQueue,
  sentToday,
  stopRequested,
  updateLog,
  writePreview,
  writeStatus,
} from "./tutor24-followup-store";
import { acquireTutor24Lock, readTutor24Lock } from "./tutor24-lock";
import { TUTOR24_BASE_URL, acceptTutor24Cookies, gotoTutor24, loginToTutor24, sleep } from "./tutor24-messaging";

/** Abbruch ohne Umgehungsversuch: Captcha, Login-Problem, Fehlerseite, unerwarteter Aufbau, Stopp. */
export class StopRun extends Error {}
/** Eine einzelne Seite war nicht lesbar: als "fehler" speichern, naechster Lauf prueft erneut. */
class ReadError extends Error {}
/** So viele Lesefehler in Folge deuten auf einen geaenderten Seitenaufbau: dann abbrechen. */
const MAX_READ_ERRORS_IN_ROW = 3;

const convoUrl = (id: string) => `${TUTOR24_BASE_URL}/de/conversations/${id}?tab=sent`;
const fmtDate = (d: Date) => d.toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" });
const jitter = (minMs: number, maxMs: number) => minMs + Math.random() * (maxMs - minMs);

type Log = (line: string) => void;

// ── Zeitmessung ──
type Phase = "liste" | "konversation" | "inserat" | "pause" | "auswertung";
const PHASES: Phase[] = ["liste", "konversation", "inserat", "pause", "auswertung"];
const timing = { phases: {} as Record<Phase, { ms: number; calls: number }>, convos: 0 };
const resetTiming = () => {
  timing.phases = Object.fromEntries(PHASES.map((p) => [p, { ms: 0, calls: 0 }])) as typeof timing.phases;
  timing.convos = 0;
};
resetTiming();

async function timed<T>(phase: Phase, fn: () => Promise<T>, calls = 0): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    timing.phases[phase].ms += Date.now() - t0;
    timing.phases[phase].calls += calls;
  }
}

/** Die Pause bleibt fest bei 8–15 s nach jedem Aufruf: tutor24 antwortet sonst mit 429. */
const pause = () => timed("pause", () => sleep(jitter(8_000, 15_000)));

/** Ein Seitenaufruf: laden, gezielt auf das auszulesende Element warten, dann die Pause. */
async function visit(page: Page, url: string, phase: Phase, ready: () => Promise<void>): Promise<void> {
  await timed(phase, async () => {
    await gotoTutor24(page, url);
    await ready();
  }, 1);
  await pause();
}

/** Ziel-Element abwarten; fehlt es, erst auf Captcha/Fehlerseite pruefen (Abbruch), sonst onMissing. */
async function waitFor(page: Page, what: string, wait: () => Promise<unknown>, onMissing: (msg: string) => Error): Promise<void> {
  try {
    await wait();
  } catch {
    await assertPageOk(page, what);
    throw onMissing(`${what}: erwartete Inhalte fehlen nach 15 s`);
  }
}

/** Status fuer den Tab in die Datei: der Lauf ist ein eigener Prozess, nicht Teil des Dev-Servers. */
const persist = () =>
  writeStatus({
    ...state,
    pid: process.pid,
    startedAt: state.startedAt?.toISOString() ?? null,
    finishedAt: state.finishedAt?.toISOString() ?? null,
    log: state.log.slice(-200),
  });

function checkStop() {
  persist();
  if (state.shouldStop || stopRequested()) throw new StopRun("Vom Benutzer gestoppt.");
}

async function assertPageOk(page: Page, what: string): Promise<void> {
  const url = page.url();
  if (/sign_in/.test(url)) throw new StopRun(`Login-Problem: auf Anmeldeseite umgeleitet (${what}).`);
  if (/captcha|challenge|verification/i.test(url)) throw new StopRun(`Captcha/Prüfung erkannt (${what}): ${url}`);
  const bad = await page.evaluate(() => {
    if (document.querySelector('iframe[src*="captcha"], [class*="captcha"], [id*="captcha"], iframe[src*="challenge"]'))
      return "Captcha";
    const t = document.body?.innerText ?? "";
    if (/ich bin kein roboter|sicherheitsüberprüfung|verify you are human/i.test(t)) return "Captcha";
    const m = t.match(/[\s\S]{0,80}(es ist ein fehler aufgetreten|something went wrong|zu viele anfragen|too many requests)[\s\S]{0,80}/i);
    if (m) return `Fehlermeldung «${m[0].replace(/\s+/g, " ").trim()}»`;
    return null;
  });
  if (bad) throw new StopRun(`${bad} auf der Seite (${what}): ${url}`);
}

/**
 * Liste eines Tabs nachladen (Endlos-Scroll), aber nur so weit wie noetig: bis Eintraege
 * aelter als maxAgeDays sind, ein ganzer Block unveraendert im Zwischenspeicher steht oder
 * `until` erfuellt ist. Nicht nachgeladene Eintraege kommen aus dem Zwischenspeicher.
 * `cacheKey` trennt die Laeufe: jeder vergleicht mit dem, was ER zuletzt gesehen hat.
 * changed = bekannte Konversationen mit neuer Aktivitaet (Datum, letzter Absender, Ausschnitt).
 */
async function collectList(
  page: Page,
  tab: string,
  cacheKey: string,
  log: Log,
  opts: { maxAgeDays?: number; until?: (loaded: Map<string, ListEntry>) => boolean } = {}
): Promise<{ entries: ListEntry[]; changed: Set<string> }> {
  const cache: ListCache = loadListCache(cacheKey);
  await visit(page, `${TUTOR24_BASE_URL}/de/conversations?tab=${tab}`, "liste", () =>
    // Ein leerer Tab hat nur die (versteckte) Mobil-Liste — sichtbar ist dann die Leer-Meldung.
    waitFor(page, `Liste ${tab}`,
      () => page.waitForSelector(".js-conversations-list a[data-conversation-id], .js-conversations-main-box h4", { timeout: 15_000 }),
      () => new StopRun(`Unerwarteter Seitenaufbau: Konversationsliste (${tab}) fehlt.`))
  );
  await assertPageOk(page, `Liste ${tab}`);
  const { hasEntries, empty } = await page.evaluate(() => ({
    hasEntries: !!document.querySelector(".js-conversations-list a[data-conversation-id]"),
    empty: /keine .*Unterhaltungen/i.test(document.querySelector(".js-conversations-main-box")?.textContent ?? ""),
  }));
  if (!hasEntries) {
    if (!empty) throw new StopRun(`Unerwarteter Seitenaufbau: Konversationsliste (${tab}) ohne Einträge und ohne Leer-Meldung.`);
    log(`Liste „${tab}“: leer.`);
    return { entries: [], changed: new Set() };
  }

  const read = async (): Promise<ListEntry[]> => {
    const raw = await page.evaluate(() => {
      const list = document.querySelector(".js-conversations-list");
      return Array.from(list?.querySelectorAll("a[data-conversation-id]") ?? []).map((a) => ({
        id: a.getAttribute("data-conversation-id") ?? "",
        name: (a.querySelector(".truncate")?.textContent ?? "").trim(),
        text: (a as HTMLElement).innerText,
        snippet: ((a.querySelector(".js-message-snippet") as HTMLElement | null)?.innerText ?? "").trim(),
        unread: ((a.querySelector(".js-conversation-preview-unread") as HTMLElement | null)?.innerText ?? "").trim(),
      }));
    });
    const seen = new Set<string>();
    return raw
      .filter((i) => i.id && !seen.has(i.id) && seen.add(i.id))
      .map((i) => {
        const unread = Number(i.unread.match(/\d+/)?.[0] ?? 0);
        return {
          id: i.id,
          name: i.name,
          date: parseTutor24Date(i.text)?.toISOString() ?? "",
          lastSender: listSender(i.snippet, unread),
          unread,
          sig: snippetSig(i.snippet),
          link: convoUrl(i.id),
        };
      });
  };

  let items = await read();
  let batch = items;
  let why = "";
  for (let round = 0; round < 200; round++) {
    checkStop();
    why = scrollStop(batch, cache, new Date(), opts.maxAgeDays) ??
      (opts.until?.(new Map(items.map((e) => [e.id, e]))) ? "alle gesuchten gefunden" : "");
    if (why) break;
    await page.evaluate(() => {
      const l = document.querySelector(".js-conversations-list");
      if (l) l.scrollTop = l.scrollHeight;
    });
    // Nachladen ist ebenfalls ein Aufruf beim Server — mit derselben Pause.
    timing.phases.liste.calls++;
    await pause();
    await assertPageOk(page, `Liste ${tab}`);
    const next = await read();
    batch = next.slice(items.length);
    items = next;
    state.progress = `Liste „${tab}“: ${items.length} geladen`;
  }

  // Nur bekannte Eintraege koennen sich "geaendert" haben; neue prueft der Lauf ohnehin.
  const changed = new Set(items.filter((e) => cache[e.id] && entryChanged(cache[e.id], e)).map((e) => e.id));
  const loadedIds = new Set(items.map((e) => e.id));
  const fromCache = Object.values(cache).filter((e) => !loadedIds.has(e.id));
  saveListCache(cacheKey, { ...cache, ...Object.fromEntries(items.map((e) => [e.id, e])) });
  log(`Liste „${tab}“: ${items.length} geladen (Stopp: ${why || "max. Runden"}), ${fromCache.length} aus dem Zwischenspeicher.`);
  return { entries: [...items, ...fromCache], changed };
}

type Conversation = {
  mine: number;
  theirs: number;
  service: string[];
  lastIsMine: boolean;
  lastMineDate: Date | null;
  jobId: string | null;
  canWrite: boolean;
  /** alle Blasen in Reihenfolge, fuer "Antworten pruefen" */
  bubbles: Bubble[];
  /** eine eigene Nachricht enthaelt schon unser Nachfassen */
  followedUp: boolean;
  /** was die Konversationsseite selbst ueber das Inserat zeigt (Kopfbereich, ohne Nachrichten) */
  listing: ListingInfo;
};

async function readConversation(page: Page, id: string): Promise<Conversation> {
  await visit(page, convoUrl(id), "konversation", () =>
    waitFor(page, `Konversation ${id}`,
      () => page.waitForSelector(".js-conversation-container .js-conversation-message", { timeout: 15_000 }),
      (msg) => new ReadError(msg))
  );
  await assertPageOk(page, `Konversation ${id}`);
  // Keine benannten Funktionen im Browser-Kontext: tsx/esbuild fuegt sonst __name ein.
  const raw = await page.evaluate(() => {
    // Die Konversation steht doppelt im DOM (Desktop + Mobil) — nur der erste Container zaehlt.
    const box = document.querySelector(".js-conversation-container");
    const entries = Array.from(box?.querySelectorAll(".js-conversation-message") ?? []).map((w) => {
      if (w.classList.contains("conversation-service-message"))
        return { kind: "service", text: (w as HTMLElement).innerText.trim() };
      const bubble = w.querySelector(".conversation-message");
      if (!bubble) return { kind: "tip", text: "" };
      const side = bubble.classList.contains("conversation-message--right")
        ? "mine"
        : bubble.classList.contains("conversation-message--left")
          ? "theirs"
          : "unknown";
      return { kind: side, text: (w as HTMLElement).innerText.trim() };
    });
    const jobLink = Array.from(document.querySelectorAll('a[href*="/jobs/"]'))
      .map((a) => a.getAttribute("href") ?? "")
      .find((h) => /\/jobs\/\d+/.test(h) && h.includes("back=conversation"));
    const input = document.querySelector(".js-conversations-interface-input") as HTMLTextAreaElement | null;
    const canWrite = !!input && !input.disabled && input.offsetParent !== null;
    // Kopfbereich um den Inserat-Link: hochsteigen, solange weder Nachrichten noch die Liste
    // (fremde Ausschnitte) darin stehen — meine eigene Nachricht darf die Analyse nicht faerben.
    const jobA = Array.from(document.querySelectorAll('a[href*="/jobs/"]')).find((a) =>
      (a.getAttribute("href") ?? "").includes("back=conversation")
    ) as HTMLElement | undefined;
    let header = jobA?.innerText ?? "";
    for (let el = jobA?.parentElement ?? null; el && el !== document.body; el = el.parentElement) {
      if (el.querySelector(".js-conversation-message, .js-conversations-list") || el.innerText.length > 1500) break;
      header = el.innerText;
    }
    return { entries, jobLink: jobLink ?? null, canWrite, header };
  });

  if (raw.entries.some((e) => e.kind === "unknown"))
    throw new StopRun(`Unerwarteter Seitenaufbau: Absender einer Nachricht in Konversation ${id} nicht erkennbar.`);
  const bubbles = raw.entries.filter((e): e is Bubble => e.kind === "mine" || e.kind === "theirs");
  if (bubbles.length === 0) throw new StopRun(`Unerwarteter Seitenaufbau: keine Nachrichten-Blasen in Konversation ${id}.`);
  const mineList = bubbles.filter((b) => b.kind === "mine");
  const lastMine = mineList[mineList.length - 1];
  return {
    mine: mineList.length,
    theirs: bubbles.length - mineList.length,
    service: raw.entries.filter((e) => e.kind === "service").map((e) => e.text),
    lastIsMine: bubbles[bubbles.length - 1].kind === "mine",
    lastMineDate: lastMine ? parseTutor24Date(lastMine.text) : null,
    jobId: raw.jobLink?.match(/\/jobs\/(\d+)/)?.[1] ?? null,
    canWrite: raw.canWrite,
    bubbles,
    followedUp: mineList.some((b) => b.text.includes(FOLLOWUP_MARKER)),
    listing: listingFromConversation(raw.header),
  };
}

/** Grund, warum eine Konversation (jetzt) nicht angeschrieben wird; null = Regeln 1, 2, 5 erfuellt. */
function conversationSkipReason(c: Conversation, now: Date): string | null {
  if (c.service.some((t) => /nicht an ihrer bewerbung interessiert/i.test(t))) return "abgelehnt";
  if (c.followedUp) return "bereits_nachgefasst";
  if (c.service.length > 0) return `systemmeldung: ${c.service[0].replace(/\s+/g, " ").slice(0, 60)}`;
  if (c.theirs > 0) return "gegenseite_hat_geschrieben";
  if (!c.lastIsMine) return "letzte_nachricht_nicht_von_mir";
  if (!c.lastMineDate) return "datum_unklar";
  const age = ageDays(c.lastMineDate, now);
  if (age < MIN_AGE_DAYS) return "juenger_als_3_tage";
  if (age > MAX_AGE_DAYS) return "aelter_als_8_wochen";
  if (!c.canWrite) return "konversation_geschlossen";
  return null;
}

async function readJob(page: Page, jobId: string): Promise<ListingInfo & { active: boolean }> {
  await visit(page, `${TUTOR24_BASE_URL}/de/jobs/${jobId}`, "inserat", () =>
    waitFor(page, `Inserat ${jobId}`,
      () => page.waitForFunction(
        () => /Gesuchte Nachhilfe|nicht mehr aktiv|nicht mehr verfügbar|deaktiviert|wurde gelöscht|existiert nicht/i.test(document.body?.innerText ?? ""),
        undefined,
        { timeout: 15_000 }
      ),
      (msg) => new ReadError(msg))
  );
  await assertPageOk(page, `Inserat ${jobId}`);
  // Nur Text holen, auswerten in Node (siehe __name oben).
  const [t, title] = await Promise.all([page.evaluate(() => document.body.innerText), page.title()]);
  const field = (label: string) => t.match(new RegExp(`\\n${label}\\n([^\\n]+)`))?.[1]?.trim() ?? "";
  const inactive = /nicht mehr aktiv|nicht mehr verfügbar|deaktiviert|wurde gelöscht|existiert nicht/i.test(t);
  const desc = t.match(/Zusätzliche Informationen\n+([\s\S]*?)\n+Gesuchte Nachhilfe/)?.[1] ?? "";
  return {
    active: t.includes("Gesuchte Nachhilfe") && !inactive,
    title: title.replace(/\s*-\s*Tutor24\s*$/i, ""),
    fach: field("Fach"),
    schulstufe: field("Schulstufe"),
    description: desc.trim(),
    // ponytail: Feldname auf tutor24 nicht geprueft; fehlt er, sucht extractOrt im Freitext.
    ort: field("Ort") || field("Unterrichtsort"),
  };
}

/** Nur diese Gruende haengen vom Datum ab und werden bei jedem Lauf neu geprueft. */
const RECHECK = new Set(["juenger_als_3_tage"]);

async function preview(page: Page, maxChecks: number, log: Log): Promise<void> {
  const now = new Date();
  const logged = loggedIds();
  const onDemand = loadSettings().listingOnDemand;
  log(onDemand ? "Inserat nur bei Bedarf öffnen: EIN." : "Inserat wird immer geöffnet (Optimierung im Tab aus).");
  const rows = readPreview();
  const save = () => writePreview(rows);

  log("Lese archivierte Konversationen …");
  const archived = new Set((await collectList(page, "archived", "preview:archived", log)).entries.map((i) => i.id));
  log("Lese gesendete Konversationen …");
  const { entries: sent, changed } = await collectList(page, "sent", "preview:sent", log, { maxAgeDays: MAX_AGE_DAYS + 1 });
  // Neue Aktivitaet bei einer schon geprueften Konversation: Zeile sofort entfernen, damit sie
  // auch nach einem Abbruch neu geprueft wird (der Zwischenspeicher kennt die Aenderung dann schon).
  const stale = rows.filter((r) => changed.has(r.conversation_id) && r.grund !== "bereits_nachgefasst");
  if (stale.length) {
    for (const r of stale) rows.splice(rows.indexOf(r), 1);
    save();
    log(`${stale.length} schon geprüfte Konversationen haben neue Aktivität und werden neu geprüft.`);
  }
  // Fortsetzen: was schon in der CSV steht, wird nicht nochmals geoeffnet — ausser Datumsgruende,
  // Lesefehler und Zeilen aus der Zeit vor der Nachfrage-Analyse (Inserat gelesen, keine Faecher).
  const done = new Set(
    rows.filter((r) => !RECHECK.has(r.grund) && !r.grund.startsWith("fehler") && !(r.fach && !r.faecher)).map((r) => r.conversation_id)
  );
  if (rows.length) log(`Setze fort: ${done.size} Konversationen schon in der Vorschau.`);
  const open = sent.filter((i) => !done.has(i.id));
  log(`${sent.length} im Tab „Gesendet“, ${archived.size} archiviert, ${open.length} noch zu prüfen (max. ${maxChecks} geöffnet in diesem Lauf).`);

  let checked = 0;
  let fromList = 0;
  let errorsInRow = 0;
  state.total = Math.min(maxChecks, open.length);
  for (let i = 0; i < open.length; i++) {
    const item = open[i];
    checkStop();
    const date = item.date ? new Date(item.date) : null;
    const row: PreviewRow = {
      status: "skip", conversation_id: item.id, link: convoUrl(item.id), name: item.name,
      kategorie: "", begruendung: "", stufe: "", fach: "",
      faecher: "", klasse: "", gymi_jahr: "", kursgruppe: "", sicherheit: "", ort: "", ortsname: "", zeitwunsch: "", anlass: "",
      letzte_nachricht: date ? fmtDate(date) : "", anrede: "", grund: "", quelle: "", kurs: "", nachricht: "",
    };
    const existing = rows.findIndex((r) => r.conversation_id === item.id);
    if (existing > -1) rows[existing] = row;
    else rows.push(row);
    const skip = (grund: string) => { row.grund = grund; save(); };

    if (logged.has(item.id)) { skip("bereits_nachgefasst"); continue; }
    if (archived.has(item.id)) { skip("archiviert"); continue; }
    // Die Liste zeigt die letzte Aktivitaet: ist sie schon zu jung/alt, gilt das auch fuer meine letzte Nachricht.
    if (date && ageDays(date, now) > MAX_AGE_DAYS) { skip("aelter_als_8_wochen"); continue; }
    if (date && ageDays(date, now) < MIN_AGE_DAYS) { skip("juenger_als_3_tage"); continue; }
    // Absage oder ungelesene Nachricht steht schon in der Liste: wird sicher nicht angeschrieben.
    const fromListReason = listSkipReason(item);
    if (fromListReason) { row.quelle = "liste"; skip(fromListReason); fromList++; timing.convos++; continue; }

    if (checked >= maxChecks) {
      // Nicht geprueft: wieder raus, damit der naechste Lauf sie oeffnet.
      rows.splice(rows.indexOf(row), 1);
      continue;
    }
    checked++;
    timing.convos++;
    state.done = checked - 1;
    state.progress = `${item.name} (${item.id}), Nr. ${i + 1} von ${open.length} offenen, ${checked - 1} in diesem Lauf fertig geprüft`;
    const tag = `[${checked}/${state.total}] ${item.name} (${item.id})`;

    try {
      const convo = await readConversation(page, item.id);
      if (convo.lastMineDate) row.letzte_nachricht = fmtDate(convo.lastMineDate);
      const reason = conversationSkipReason(convo, now);
      if (reason) { skip(reason); log(`${tag}: ${reason}`); errorsInRow = 0; continue; }
      if (!convo.jobId) { skip("inserat_unbekannt"); log(`${tag}: inserat_unbekannt`); errorsInRow = 0; continue; }

      // Analysiert wird immer, unabhaengig von Kursen und Faechern — beides laesst sich spaeter ohne neuen Lauf aendern.
      let a = await timed("auswertung", async () => analyzeListing(convo.listing));
      const need = onDemand ? needsListing(a, convo.listing) : "immer";
      row.quelle = "konversation";
      row.fach = convo.listing.fach;
      row.stufe = convo.listing.schulstufe;
      if (need) {
        const job = await readJob(page, convo.jobId);
        row.quelle = "konversation+inserat";
        row.fach = job.fach;
        row.stufe = job.schulstufe;
        if (!job.active) { skip("inserat_nicht_aktiv"); log(`${tag}: inserat_nicht_aktiv`); errorsInRow = 0; continue; }
        a = await timed("auswertung", async () => analyzeListing(job));
      }
      Object.assign(row, a);
      // "unklar"/"ausgeschlossen" bleiben skip; alles andere ist bereit, gesendet wird nur mit passendem aktivem Kurs.
      if (isOfferLevel(a.kategorie)) row.status = "send";
      else row.grund = `stufe_${a.kategorie}`;
      await timed("auswertung", async () => save());
      errorsInRow = 0;
      log(
        `${tag}: ${isOfferLevel(a.kategorie) ? `→ ${a.kategorie}${a.kursgruppe ? `/${a.kursgruppe}` : ""}, ${a.faecher}, ${row.anrede}` : a.kategorie}` +
          ` (${a.begruendung}) [${row.quelle}${onDemand && need ? `: ${need}` : ""}]`
      );
    } catch (err) {
      // Nie als "keine Antwort"/"ausgeschlossen" speichern: als Fehler, naechster Lauf prueft erneut.
      const msg = err instanceof Error ? err.message : String(err);
      Object.assign(row, { status: "skip", kategorie: "", faecher: "", kursgruppe: "", sicherheit: "" });
      skip(`fehler: ${msg.replace(/\s+/g, " ").slice(0, 120)}`);
      if (!(err instanceof ReadError)) throw err;
      log(`${tag}: ✖ Lesefehler — ${msg} (wird beim nächsten Lauf erneut geprüft)`);
      if (++errorsInRow >= MAX_READ_ERRORS_IN_ROW)
        throw new StopRun(`${MAX_READ_ERRORS_IN_ROW} Lesefehler in Folge — Seitenaufbau geändert? Abgebrochen.`);
    }
  }
  state.done = checked;
  save();
  if (fromList) log(`${fromList} Konversationen direkt aus der Liste entschieden (Absage/ungelesen), ohne sie zu öffnen.`);

  const remaining = sent.filter((i) => !rows.some((r) => r.conversation_id === i.id)).length;
  const ready = rows.filter((r) => r.status === "send");
  const byLevel = ready.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.kategorie]: (acc[r.kategorie] ?? 0) + 1 }), {});
  const byReason = rows
    .filter((r) => r.status !== "send")
    .reduce<Record<string, number>>((acc, r) => {
      const k = r.grund.split(":")[0];
      return { ...acc, [k]: (acc[k] ?? 0) + 1 };
    }, {});
  const lines = (o: Record<string, number>) =>
    Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${k}: ${n}`).join("\n");
  log(`══ Probelauf fertig — es wurde NICHTS gesendet ══`);
  log(`In diesem Lauf geprüft: ${checked}. Bereit (status=send): ${ready.length}`);
  if (ready.length) log(lines(byLevel));
  log(`Übersprungen: ${rows.length - ready.length}`);
  if (rows.length > ready.length) log(lines(byReason));
  if (remaining > 0) log(`Noch ${remaining} Konversationen ungeprüft — für den Rest den Probelauf später erneut starten.`);
  log(`Vorschau: ${PREVIEW_PATH}`);
}

async function send(page: Page, log: Log): Promise<void> {
  const courses = loadCourses();
  // Gespeicherte Kurse koennen aus der Zeit vor einer Pruefregel stammen: vor dem ersten Senden pruefen.
  const invalid = validateCourses(courses);
  if (invalid.length) throw new StopRun(`Kurse fehlerhaft, nichts gesendet: ${invalid.join(" ")}`);
  const { pending, queue } = sendQueue(courses, loadSettings());
  // Alle Texte VOR der ersten Nachricht pruefen: der Lauf bricht nie mittendrin wegen eines Textes ab.
  const bad = queue.filter((r) => r.problem);
  if (bad.length)
    throw new StopRun(`Nichts gesendet — ${bad.length} Nachricht(en) fehlerhaft: ${bad.map((r) => `${r.name}: ${r.problem}`).join("; ")}`);
  log(`Alle ${queue.length} Nachrichten vorab geprüft: Anrede, Platzhalter, Nachfass-Satz, keine Links/Nummern.`);
  log(
    `Heute schon gesendet: ${sentToday()}/25. Jetzt: ${queue.length} von ${pending.length} offenen (nur aktive Kurse).` +
      (pending.length > queue.length ? " Der Rest folgt an einem späteren Tag." : "")
  );
  state.total = queue.length;

  let sentCount = 0;
  for (let i = 0; i < queue.length; i++) {
    const row = queue[i];
    checkStop();
    state.done = sentCount;
    state.progress = `${row.name} (${row.conversation_id}), Nr. ${i + 1} von ${queue.length}, ${sentCount} gesendet`;
    const text = row.text;

    // Zwischen Probelauf und Senden kann eine Antwort gekommen sein: neu pruefen.
    const convo = await readConversation(page, row.conversation_id);
    const reason = conversationSkipReason(convo, new Date());
    if (reason) {
      log(`[${i + 1}/${queue.length}] ${row.name}: übersprungen (${reason})`);
      continue;
    }

    const input = await page.$(".js-conversations-interface-input");
    const isTextarea = await input?.evaluate((el) => el.tagName === "TEXTAREA");
    const button = await page.$(".js-conversations-interface-send-button");
    if (!input || !isTextarea || !button) throw new StopRun(`Unerwarteter Seitenaufbau: Eingabefeld/Senden-Knopf fehlt (${row.conversation_id}).`);

    await input.click();
    await input.fill(text);
    if ((await input.inputValue()).trim() !== text) throw new StopRun(`Text liess sich nicht vollständig eintragen (${row.conversation_id}).`);
    await button.click();

    // Bestaetigung: eine zusaetzliche eigene Nachricht mit unserem Anfang.
    const marker = (text.split("\n").find((l) => l.startsWith("Ich hatte mich")) ?? text).slice(0, 40);
    let confirmed = false;
    for (let t = 0; t < 30 && !confirmed; t++) {
      await sleep(500);
      confirmed = await page.evaluate(
        ({ before, marker }) => {
          const box = document.querySelector(".js-conversation-container");
          const mine = Array.from(box?.querySelectorAll(".conversation-message--right") ?? []);
          return mine.length > before && (mine[mine.length - 1] as HTMLElement).innerText.includes(marker);
        },
        { before: convo.mine, marker }
      );
    }
    // Auch unbestaetigt protokollieren: lieber einmal zu wenig als doppelt nachfassen.
    appendLog({
      conversation_id: row.conversation_id,
      name: row.name,
      zeitstempel: new Date().toISOString(),
      kurs: row.course.id,
      variante: `${row.course.name}/${row.anrede}`,
      status: confirmed ? "gesendet" : "unbestaetigt",
    });
    if (!confirmed) {
      await assertPageOk(page, `nach dem Senden ${row.conversation_id}`);
      throw new StopRun(`Senden an ${row.name} (${row.conversation_id}) nicht bestätigt — bitte in tutor24 nachsehen. Als "unbestaetigt" protokolliert.`);
    }
    sentCount++;
    state.done = sentCount;
    log(`[${i + 1}/${queue.length}] ✓ ${row.name} (${row.course.name}, ${row.anrede})`);

    if (i < queue.length - 1) {
      const wait = jitter(60_000, 180_000);
      log(`   warte ${Math.round(wait / 1000)} s …`);
      // In Sekundenschritten warten, damit "Stoppen" nicht drei Minuten braucht.
      for (let waited = 0; waited < wait; waited += 1000) {
        checkStop();
        await sleep(1000);
      }
    }
  }
  log(`══ Fertig: ${sentCount} gesendet. Protokoll: ${LOG_PATH} ══`);
}

/** Nur lesend: kam nach meinem Nachfassen eine Antwort? Gewertet wird sie nicht — das markiere ich im Tab. */
async function replies(page: Page, log: Log): Promise<void> {
  const open = readLog().filter(needsReplyCheck);
  log(`${open.length} nachgefasste Konversationen ohne bekannte Antwort.`);
  if (!open.length) return;
  // Liste nur so weit laden, bis alle gesuchten Konversationen drin sind (oder aelter als das erste Nachfassen).
  const want = new Set(open.map((r) => r.conversation_id));
  const firstSent = Math.min(...open.map((r) => new Date(r.zeitstempel).getTime()).filter((t) => !Number.isNaN(t)));
  const { entries } = await collectList(page, "sent", "replies:sent", log, {
    maxAgeDays: Number.isFinite(firstSent) ? Math.ceil(ageDays(new Date(firstSent), new Date())) + 1 : undefined,
    until: (loaded) => Array.from(want).every((id) => loaded.has(id)),
  });
  const byId = new Map(entries.map((e) => [e.id, e]));

  state.total = open.length;
  let answered = 0;
  let skipped = 0;
  let errorsInRow = 0;
  for (let i = 0; i < open.length; i++) {
    const r = open[i];
    checkStop();
    state.done = i;
    timing.convos++;
    state.progress = `${r.name || r.conversation_id} (${r.conversation_id}), Nr. ${i + 1} von ${open.length}`;
    const tag = `[${i + 1}/${open.length}] ${r.name || r.conversation_id}`;
    // Liste zeigt: mein Nachfassen ist weiterhin die letzte Nachricht, nichts ungelesen → keine Antwort.
    if (!hasNewActivity(byId.get(r.conversation_id))) {
      updateLog(r.conversation_id, { geantwortet: "nein" });
      skipped++;
      continue;
    }
    try {
      const convo = await readConversation(page, r.conversation_id);
      // Absage ueber tutor24 ist eine Systemmeldung, keine Chat-Blase: findReply saehe sie nie.
      // Vor dem Senden war sie nicht da (Senden prueft das), also kam sie nach dem Nachfassen.
      if (convo.service.some((t) => /nicht an ihrer bewerbung interessiert/i.test(t))) {
        updateLog(r.conversation_id, { geantwortet: "ja", antwort: "Absage über tutor24 (Systemmeldung)", markierung: "Absage" });
        answered++;
        errorsInRow = 0;
        log(`${tag}: Absage über tutor24`);
        continue;
      }
      const reply = findReply(convo.bubbles, new Date(r.zeitstempel));
      updateLog(
        r.conversation_id,
        reply
          ? { geantwortet: "ja", antwort_datum: reply.date ? fmtDate(reply.date) : "", antwort: reply.text, markierung: r.markierung || "offen" }
          : { geantwortet: "nein" }
      );
      if (reply) answered++;
      errorsInRow = 0;
      log(`${tag}: ${reply ? "Antwort" : "keine Antwort"}`);
    } catch (err) {
      // Nicht als "keine Antwort" speichern: "fehler: …" wird beim naechsten Lauf erneut geprueft.
      const msg = err instanceof Error ? err.message : String(err);
      updateLog(r.conversation_id, { geantwortet: `fehler: ${msg.replace(/\s+/g, " ").slice(0, 120)}` });
      if (!(err instanceof ReadError)) throw err;
      log(`${tag}: ✖ Lesefehler — ${msg}`);
      if (++errorsInRow >= MAX_READ_ERRORS_IN_ROW)
        throw new StopRun(`${MAX_READ_ERRORS_IN_ROW} Lesefehler in Folge — Seitenaufbau geändert? Abgebrochen.`);
    }
  }
  state.done = open.length;
  log(`${skipped} laut Liste ohne neue Aktivität (nicht geöffnet), ${open.length - skipped} geöffnet.`);
  log(`══ Antworten geprüft: ${answered} neue Antworten — bitte im Tab markieren. Es wurde NICHTS gesendet. ══`);
}

/**
 * Vergleich fuer "Inserat nur bei Bedarf": N Konversationen, deren Inserat der Probelauf schon
 * gelesen hat, beide Varianten auswerten. Schreibt nur compare.csv, aendert die Vorschau nicht.
 */
async function compare(page: Page, n: number, log: Log): Promise<void> {
  const logged = loggedIds();
  const candidates = readPreview().filter((r) => r.kategorie && !logged.has(r.conversation_id));
  log(`Vergleiche ${Math.min(n, candidates.length)} Konversationen (von ${candidates.length} mit gelesenem Inserat).`);
  const out: Record<string, string>[] = [];
  const write = () => appendCsv(COMPARE_PATH, COMPARE_COLS, out.splice(0));
  appendCsv(COMPARE_PATH, COMPARE_COLS, []); // Datei anlegen, falls noch keine
  const runStart = new Date().toLocaleString("de-CH");
  out.push({ conversation_id: "", name: `── Vergleich ${runStart} ──`, inserat_noetig: "", feld: "", nur_konversation: "", mit_inserat: "" });

  let compared = 0;
  let needed = 0;
  let identical = 0;
  let critical = 0;
  let errorsInRow = 0;
  state.total = Math.min(n, candidates.length);
  for (const r of candidates) {
    if (compared >= n) break;
    checkStop();
    state.done = compared;
    state.progress = `${r.name} (${r.conversation_id}), ${compared} von ${state.total} verglichen`;
    try {
      const convo = await readConversation(page, r.conversation_id);
      if (!convo.jobId) { log(`${r.name}: kein Inserat-Link — übersprungen`); continue; }
      const short = analyzeListing(convo.listing);
      const need = needsListing(short, convo.listing);
      const job = await readJob(page, convo.jobId);
      const full = analyzeListing(job);
      const diffs = compareAnalyses(short, full);
      if (!job.active) diffs.push({ feld: "inserat_aktiv", nur_konversation: "?", mit_inserat: "nein" });
      compared++;
      timing.convos++;
      errorsInRow = 0;
      if (need) needed++;
      if (!diffs.length) identical++;
      // Kritisch: die Optimierung haette das Inserat NICHT geoeffnet, das Ergebnis waere aber anders.
      if (diffs.length && !need) critical++;
      const base = { conversation_id: r.conversation_id, name: r.name, inserat_noetig: need ?? "nein" };
      if (diffs.length) out.push(...diffs.map((d) => ({ ...base, ...d })));
      else out.push({ ...base, feld: "", nur_konversation: "keine Unterschiede", mit_inserat: "" });
      write();
      log(`[${compared}/${state.total}] ${r.name}: Inserat nötig: ${need ?? "nein"}; ${diffs.length ? diffs.map((d) => d.feld).join(", ") : "gleich"}`);
    } catch (err) {
      if (!(err instanceof ReadError)) throw err;
      log(`${r.name}: ✖ Lesefehler — ${err.message} (nicht verglichen)`);
      if (++errorsInRow >= MAX_READ_ERRORS_IN_ROW)
        throw new StopRun(`${MAX_READ_ERRORS_IN_ROW} Lesefehler in Folge — Seitenaufbau geändert? Abgebrochen.`);
    }
  }
  state.done = compared;
  log(`══ Vergleich fertig: ${compared} verglichen, ${identical} ohne Unterschied. ══`);
  log(`Die Optimierung hätte das Inserat bei ${needed} von ${compared} geöffnet (${compared - needed} Seitenaufrufe gespart).`);
  log(`KRITISCH (Inserat nicht geöffnet, Ergebnis aber anders): ${critical}. Details: ${COMPARE_PATH}`);
}

export type FollowupRunOptions = {
  mode: "preview" | "send" | "replies" | "compare";
  /** Probelauf: hoechstens so viele Konversationen oeffnen; Vergleich: so viele vergleichen */
  maxChecks?: number;
  headless?: boolean;
  /** zusaetzliche Ausgabe, z.B. console.log fuer die Kommandozeile */
  onLog?: Log;
};

const BLOCKED_URLS = [
  "*.png*", "*.jpg*", "*.jpeg*", "*.gif*", "*.webp*", "*.svg*", "*.ico*", "*.avif*",
  "*.woff*", "*.ttf*", "*.otf*", "*.eot*",
  "*.mp4*", "*.webm*", "*.mp3*",
  "*googletagmanager.com*", "*google-analytics.com*", "*doubleclick.net*", "*googlesyndication.com*",
  "*googleadservices.com*", "*facebook.net*", "*connect.facebook.com*", "*hotjar.com*", "*clarity.ms*",
  "*criteo.*", "*taboola.com*", "*outbrain.com*", "*tiktok.com*", "*bat.bing.com*", "*snap.licdn.com*",
];

/** Zusammenfassung der Zeitmessung ins Log und als Zeilen in timing.csv. */
function reportTiming(mode: string, log: Log): void {
  const total = state.startedAt ? Date.now() - state.startedAt.getTime() : 0;
  const calls = PHASES.reduce((n, p) => n + timing.phases[p].calls, 0);
  const lauf = state.startedAt?.toISOString() ?? "";
  const row = (phase: string, ms: number, c: number) => ({
    lauf, modus: mode, phase, dauer_s: (ms / 1000).toFixed(1), seitenaufrufe: String(c), konversationen: String(timing.convos),
  });
  try {
    appendCsv(TIMING_PATH, TIMING_COLS, [
      ...PHASES.map((p) => row(p, timing.phases[p].ms, timing.phases[p].calls)),
      row("gesamt", total, calls),
    ]);
  } catch {
    // Messung ist Beiwerk — ein Schreibfehler darf das Laufende nicht verdecken.
  }
  const min = (ms: number) => `${(ms / 60_000).toFixed(1)} min`;
  log(`⏱ Gesamt ${min(total)}, ${calls} Seitenaufrufe, ${timing.convos} Konversationen` +
    (timing.convos ? ` (${(calls / timing.convos).toFixed(2)} Aufrufe pro Konversation)` : "") + ".");
  log(`⏱ ${PHASES.map((p) => `${p} ${min(timing.phases[p].ms)}${timing.phases[p].calls ? ` / ${timing.phases[p].calls}×` : ""}`).join(" · ")}`);
}

/** Startet einen Lauf. Wirft nach dem Aufraeumen, wenn er abgebrochen wurde (state.error enthaelt die Meldung). */
export async function runFollowup(opts: FollowupRunOptions): Promise<void> {
  if (state.running) throw new Error("Nachfassen läuft bereits.");
  const email = process.env.TUTOR24_EMAIL;
  const password = process.env.TUTOR24_PASSWORD;
  let releaseLock: () => void;
  try {
    if (!email || !password) throw new Error("TUTOR24_EMAIL / TUTOR24_PASSWORD fehlen in .env.local");
    // Vor allem anderen: haelt die Erst-Nachrichten-Automation die Sperre, wirft das hier.
    releaseLock = acquireTutor24Lock(
      opts.mode === "send" ? "Nachfassen (Senden)"
        : opts.mode === "replies" ? "Nachfassen (Antworten prüfen)"
        : opts.mode === "compare" ? "Nachfassen (Vergleich)"
        : "Nachfassen (Probelauf)"
    );
  } catch (err) {
    // Sichtbar machen, auch wenn der Lauf gar nicht erst beginnt.
    Object.assign(state, { mode: opts.mode, error: err instanceof Error ? err.message : String(err), finishedAt: new Date(), log: [] });
    // Den Status eines anderen, laufenden Laufs nicht ueberschreiben.
    if (!readTutor24Lock()) persist();
    throw err;
  }
  clearStop();
  resetTiming();
  Object.assign(state, {
    running: true, shouldStop: false, mode: opts.mode, startedAt: new Date(), finishedAt: null,
    progress: "Anmelden …", done: 0, total: 0, log: [], error: null,
  });
  persist();
  const log: Log = (line) => {
    state.log.push(line);
    if (state.log.length > 500) state.log.splice(0, state.log.length - 500);
    persist();
    opts.onLog?.(line);
  };

  let browser: import("playwright").Browser | null = null;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: opts.headless ?? true });
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    // Bilder, Schriften, Videos und Tracker gar nicht erst laden. Per CDP statt page.route:
    // route schaltet den HTTP-Cache ab, dann kaemen CSS/JS bei jedem Aufruf neu von tutor24.
    // Captcha-Anbieter bleiben erlaubt, sonst wuerde ein Captcha nicht mehr erkannt.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setBlockedURLs", { urls: BLOCKED_URLS });
    // Login-Log bleibt stumm: loginToTutor24 nennt die E-Mail-Adresse.
    await loginToTutor24(page, email, password, () => {});
    await acceptTutor24Cookies(page, () => {});
    await assertPageOk(page, "nach dem Login");
    log("Angemeldet.");
    if (opts.mode === "send") await send(page, log);
    else if (opts.mode === "replies") await replies(page, log);
    else if (opts.mode === "compare") await compare(page, opts.maxChecks ?? 20, log);
    else await preview(page, opts.maxChecks ?? 150, log);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.error =
      `${err instanceof StopRun ? msg : `Login/Seitenfehler: ${msg}`} — Stand: ${state.progress || "noch keine Konversation"}.` +
      (opts.mode === "preview" ? " Bisheriges ist in der Vorschau gespeichert; der nächste Lauf setzt dort fort." : "");
    log(`✖ ABGEBROCHEN: ${state.error}`);
    throw err;
  } finally {
    await browser?.close().catch(() => {});
    reportTiming(opts.mode, log);
    releaseLock();
    clearStop();
    state.running = false;
    state.finishedAt = new Date();
    persist();
  }
}
