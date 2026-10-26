/**
 * Der eigentliche Nachfass-Lauf auf tutor24.ch. Aufgerufen von
 * scripts/followup_group_offer.mts (Kommandozeile) und /api/tutor24/followup (App).
 *
 * Probelauf: liest, analysiert ALLE Konversationen (Stufe, Faecher, Klasse, Ort,
 * Zeitwunsch, Anlass) und schreibt die Vorschau-CSV nach jeder Konversation;
 * ein neuer Lauf setzt dort fort. Sendet nie.
 * Senden: nur effektiver Status "wird gesendet" (aktiver passender Kurs, status=send),
 * hoechstens 25 pro Tag, 60–180 s Pause.
 * Antworten pruefen: liest nur Konversationen aus dem Protokoll, sendet nie.
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
  containsForbiddenContact,
  findReply,
  isOfferLevel,
  parseTutor24Date,
  renderMessage,
  type Bubble,
  type ListingInfo,
  type PreviewRow,
} from "./tutor24-followup";
import {
  PREVIEW_PATH,
  LOG_PATH,
  appendLog,
  clearStop,
  loadCourses,
  loadSettings,
  loggedIds,
  readLog,
  readPreview,
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

const convoUrl = (id: string) => `${TUTOR24_BASE_URL}/de/conversations/${id}?tab=sent`;
const fmtDate = (d: Date) => d.toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" });
const jitter = (minMs: number, maxMs: number) => minMs + Math.random() * (maxMs - minMs);

type Log = (line: string) => void;

/** Jeder Seitenaufruf, danach 8–15 s Pause: tutor24 antwortet sonst mit 429. */
async function visit(page: Page, url: string): Promise<void> {
  await gotoTutor24(page, url);
  await sleep(jitter(8_000, 15_000));
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

type ListItem = { id: string; name: string; date: Date | null };

/** Liste eines Tabs vollstaendig nachladen (Endlos-Scroll), optional bis zu einem Mindestalter. */
async function collectList(page: Page, tab: string, stopOlderThanDays?: number): Promise<ListItem[]> {
  await visit(page, `${TUTOR24_BASE_URL}/de/conversations?tab=${tab}`);
  await assertPageOk(page, `Liste ${tab}`);
  if (!(await page.$(".js-conversations-list"))) throw new StopRun(`Unerwarteter Seitenaufbau: Konversationsliste (${tab}) fehlt.`);

  const read = () =>
    page.evaluate(() => {
      const list = document.querySelector(".js-conversations-list");
      return Array.from(list?.querySelectorAll("a[data-conversation-id]") ?? []).map((a) => ({
        id: a.getAttribute("data-conversation-id") ?? "",
        name: (a.querySelector(".truncate")?.textContent ?? "").trim(),
        text: (a as HTMLElement).innerText,
      }));
    });

  let items = await read();
  for (let round = 0; round < 200; round++) {
    checkStop();
    const oldest = items.length ? parseTutor24Date(items[items.length - 1].text) : null;
    if (stopOlderThanDays !== undefined && oldest && ageDays(oldest, new Date()) > stopOlderThanDays) break;
    await page.evaluate(() => {
      const l = document.querySelector(".js-conversations-list");
      if (l) l.scrollTop = l.scrollHeight;
    });
    // Nachladen ist ebenfalls ein Aufruf beim Server.
    await sleep(jitter(8_000, 15_000));
    await assertPageOk(page, `Liste ${tab}`);
    const next = await read();
    if (next.length === items.length) break;
    items = next;
    state.progress = `Liste „${tab}“: ${items.length} geladen`;
  }
  const seen = new Set<string>();
  return items
    .filter((i) => i.id && !seen.has(i.id) && seen.add(i.id))
    .map((i) => ({ id: i.id, name: i.name, date: parseTutor24Date(i.text) }));
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
};

async function readConversation(page: Page, id: string): Promise<Conversation> {
  await visit(page, convoUrl(id));
  await assertPageOk(page, `Konversation ${id}`);
  try {
    await page.waitForSelector(".js-conversation-container .js-conversation-message", { timeout: 12000 });
  } catch {
    await assertPageOk(page, `Konversation ${id}`);
    throw new StopRun(`Unerwarteter Seitenaufbau: keine Nachrichten in Konversation ${id}.`);
  }
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
    return { entries, jobLink: jobLink ?? null, canWrite };
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
  await visit(page, `${TUTOR24_BASE_URL}/de/jobs/${jobId}`);
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
  // Fortsetzen: was schon in der CSV steht, wird nicht nochmals geoeffnet.
  const rows = readPreview();
  // Zeilen aus der Zeit vor der Nachfrage-Analyse (Inserat gelesen, aber keine Faecher) nochmals oeffnen.
  const done = new Set(rows.filter((r) => !RECHECK.has(r.grund) && !(r.fach && !r.faecher)).map((r) => r.conversation_id));
  if (rows.length) log(`Setze fort: ${done.size} Konversationen schon in der Vorschau.`);
  const save = () => writePreview(rows);

  log("Lese archivierte Konversationen …");
  const archived = new Set((await collectList(page, "archived")).map((i) => i.id));
  log("Lese gesendete Konversationen …");
  const sent = await collectList(page, "sent", MAX_AGE_DAYS + 1);
  const open = sent.filter((i) => !done.has(i.id));
  log(`${sent.length} im Tab „Gesendet“, ${archived.size} archiviert, ${open.length} noch zu prüfen (max. ${maxChecks} in diesem Lauf).`);

  let checked = 0;
  state.total = Math.min(maxChecks, open.length);
  for (let i = 0; i < open.length; i++) {
    const item = open[i];
    checkStop();
    const row: PreviewRow = {
      status: "skip", conversation_id: item.id, link: convoUrl(item.id), name: item.name,
      kategorie: "", begruendung: "", stufe: "", fach: "",
      faecher: "", klasse: "", gymi_jahr: "", kursgruppe: "", sicherheit: "", ort: "", ortsname: "", zeitwunsch: "", anlass: "",
      letzte_nachricht: item.date ? fmtDate(item.date) : "", anrede: "", grund: "", kurs: "", nachricht: "",
    };
    const existing = rows.findIndex((r) => r.conversation_id === item.id);
    if (existing > -1) rows[existing] = row;
    else rows.push(row);
    const skip = (grund: string) => { row.grund = grund; save(); };

    if (logged.has(item.id)) { skip("bereits_nachgefasst"); continue; }
    if (archived.has(item.id)) { skip("archiviert"); continue; }
    // Die Liste zeigt die letzte Aktivitaet: ist sie schon zu jung/alt, gilt das auch fuer meine letzte Nachricht.
    if (item.date && ageDays(item.date, now) > MAX_AGE_DAYS) { skip("aelter_als_8_wochen"); continue; }
    if (item.date && ageDays(item.date, now) < MIN_AGE_DAYS) { skip("juenger_als_3_tage"); continue; }

    if (checked >= maxChecks) {
      // Nicht geprueft: wieder raus, damit der naechste Lauf sie oeffnet.
      rows.splice(rows.indexOf(row), 1);
      continue;
    }
    checked++;
    state.done = checked - 1;
    state.progress = `${item.name} (${item.id}), Nr. ${i + 1} von ${open.length} offenen, ${checked - 1} in diesem Lauf fertig geprüft`;

    const convo = await readConversation(page, item.id);
    if (convo.lastMineDate) row.letzte_nachricht = fmtDate(convo.lastMineDate);
    const reason = conversationSkipReason(convo, now);
    const tag = `[${checked}/${state.total}] ${item.name} (${item.id})`;
    if (reason) { skip(reason); log(`${tag}: ${reason}`); continue; }
    if (!convo.jobId) { skip("inserat_unbekannt"); log(`${tag}: inserat_unbekannt`); continue; }

    const job = await readJob(page, convo.jobId);
    row.fach = job.fach;
    row.stufe = job.schulstufe;
    if (!job.active) { skip("inserat_nicht_aktiv"); log(`${tag}: inserat_nicht_aktiv`); continue; }

    // Analysiert wird immer, unabhaengig von Kursen und Faechern — beides laesst sich spaeter ohne neuen Lauf aendern.
    const a = analyzeListing(job);
    Object.assign(row, a);
    if (!isOfferLevel(a.kategorie)) { skip(`stufe_${a.kategorie}`); log(`${tag}: ${a.kategorie} (${a.begruendung})`); continue; }
    // "unklar"/"ausgeschlossen" bleiben skip; alles andere ist bereit, gesendet wird nur mit passendem aktivem Kurs.
    row.status = "send";
    save();
    log(`${tag}: → ${a.kategorie}${a.kursgruppe ? `/${a.kursgruppe}` : ""}, ${a.faecher}, ${row.anrede} (${a.begruendung})`);
  }
  state.done = checked;
  save();

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
  const { pending, queue } = sendQueue(loadCourses(), loadSettings());
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
    const rendered = renderMessage(row.course, row.name, row.anrede === "du" ? "du" : "Sie");
    const text = rendered.text.trim();
    if (!text.startsWith("Hallo") || containsForbiddenContact(text))
      throw new StopRun(`Nachricht für ${row.conversation_id} sieht nicht wie die Vorlage aus — abgebrochen.`);

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
      variante: `${row.course.name}/${rendered.anrede}`,
      status: confirmed ? "gesendet" : "unbestaetigt",
    });
    if (!confirmed) {
      await assertPageOk(page, `nach dem Senden ${row.conversation_id}`);
      throw new StopRun(`Senden an ${row.name} (${row.conversation_id}) nicht bestätigt — bitte in tutor24 nachsehen. Als "unbestaetigt" protokolliert.`);
    }
    sentCount++;
    state.done = sentCount;
    log(`[${i + 1}/${queue.length}] ✓ ${row.name} (${row.course.name}, ${rendered.anrede})`);

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
  const open = readLog().filter((r) => r.geantwortet !== "ja");
  log(`${open.length} nachgefasste Konversationen ohne bekannte Antwort.`);
  state.total = open.length;
  let answered = 0;
  for (let i = 0; i < open.length; i++) {
    const r = open[i];
    checkStop();
    state.done = i;
    state.progress = `${r.name || r.conversation_id} (${r.conversation_id}), Nr. ${i + 1} von ${open.length}`;
    const convo = await readConversation(page, r.conversation_id);
    const reply = findReply(convo.bubbles, new Date(r.zeitstempel));
    updateLog(
      r.conversation_id,
      reply
        ? { geantwortet: "ja", antwort_datum: reply.date ? fmtDate(reply.date) : "", antwort: reply.text, markierung: r.markierung || "offen" }
        : { geantwortet: "nein" }
    );
    if (reply) answered++;
    log(`[${i + 1}/${open.length}] ${r.name || r.conversation_id}: ${reply ? "Antwort" : "keine Antwort"}`);
  }
  state.done = open.length;
  log(`══ Antworten geprüft: ${answered} neue Antworten — bitte im Tab markieren. Es wurde NICHTS gesendet. ══`);
}

export type FollowupRunOptions = {
  mode: "preview" | "send" | "replies";
  /** Probelauf: hoechstens so viele Konversationen oeffnen */
  maxChecks?: number;
  headless?: boolean;
  /** zusaetzliche Ausgabe, z.B. console.log fuer die Kommandozeile */
  onLog?: Log;
};

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
      opts.mode === "send" ? "Nachfassen (Senden)" : opts.mode === "replies" ? "Nachfassen (Antworten prüfen)" : "Nachfassen (Probelauf)"
    );
  } catch (err) {
    // Sichtbar machen, auch wenn der Lauf gar nicht erst beginnt.
    Object.assign(state, { mode: opts.mode, error: err instanceof Error ? err.message : String(err), finishedAt: new Date(), log: [] });
    // Den Status eines anderen, laufenden Laufs nicht ueberschreiben.
    if (!readTutor24Lock()) persist();
    throw err;
  }
  clearStop();
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
    // Login-Log bleibt stumm: loginToTutor24 nennt die E-Mail-Adresse.
    await loginToTutor24(page, email, password, () => {});
    await acceptTutor24Cookies(page, () => {});
    await assertPageOk(page, "nach dem Login");
    log("Angemeldet.");
    if (opts.mode === "send") await send(page, log);
    else if (opts.mode === "replies") await replies(page, log);
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
    releaseLock();
    clearStop();
    state.running = false;
    state.finishedAt = new Date();
    persist();
  }
}
