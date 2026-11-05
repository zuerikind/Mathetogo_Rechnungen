/**
 * Automatik fuer tutor24 (scripts/autopilot.mts, Windows-Aufgabenplanung 9 und 17 Uhr):
 * Zustand (an/probe/aus), Protokoll pro Durchgang, Stopp-Regeln, Telegram-Meldungen.
 *
 * Der Zustand liegt bewusst NICHT in settings.json: /kurse speichert die Einstellungen aus einem
 * Entwurf — ein "/stop" per Telegram wuerde sonst beim naechsten Speichern wieder ueberschrieben.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "tutor24-followup");
export const AUTOPILOT_PATH = join(DIR, "autopilot.json");
export const AUTOPILOT_LOG_PATH = join(DIR, "autopilot.log");

/** aus = nichts; probe = alles lesen, nichts senden, Meldungen mit "PROBE"; an = senden */
export type AutoMode = "aus" | "probe" | "an";
export type AutoState = {
  modus: AutoMode;
  /** letzter automatischer Stopp (Grund + Zeit), null nach dem Einschalten */
  gestoppt: { grund: string; am: string } | null;
  /** Fehler des letzten Durchgangs: kommt derselbe nochmals, stoppt die Automatik */
  letzterFehler: string | null;
  /** Tag (YYYY-MM-DD) der letzten Abend-Zusammenfassung */
  zusammenfassungAm: string | null;
  /** Telegram getUpdates: naechste update_id (sonst kaeme ein altes /stop nach jedem Neustart wieder) */
  telegramOffset: number;
};
const DEFAULT: AutoState = { modus: "aus", gestoppt: null, letzterFehler: null, zusammenfassungAm: null, telegramOffset: 0 };

export function loadAutopilot(): AutoState {
  try {
    const s = existsSync(AUTOPILOT_PATH) ? (JSON.parse(readFileSync(AUTOPILOT_PATH, "utf8")) as Partial<AutoState>) : {};
    return { ...DEFAULT, ...s, modus: s.modus === "an" || s.modus === "probe" ? s.modus : "aus" };
  } catch {
    // Kaputte Datei = aus: im Zweifel nie senden.
    return DEFAULT;
  }
}

/** Lesen, aendern, schreiben (Bot und Durchgang schreiben beide; ponytail: kein Lock, die Felder ueberschneiden sich kaum). */
export function updateAutopilot(patch: Partial<AutoState>): AutoState {
  const next = { ...loadAutopilot(), ...patch };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(AUTOPILOT_PATH, JSON.stringify(next, null, 2));
  return next;
}

// ── Protokoll ─────────────────────────────────────────────────────────────────

export type PassCounts = { gesendet: number; wuerde: number; uebersprungen: number; pruefungFehler: number };
export type PassLog = {
  start: string;
  ende: string;
  modus: AutoMode;
  erst: PassCounts;
  nachfassen: PassCounts;
  antworten: number;
  fehler: string[];
  /** Grund, falls dieser Durchgang die Automatik ausgeschaltet hat */
  stopp: string | null;
  /** nur Probe: was gesendet wuerde (Vorname, Kurs) */
  probe?: string[];
};
export const emptyCounts = (): PassCounts => ({ gesendet: 0, wuerde: 0, uebersprungen: 0, pruefungFehler: 0 });

export function appendPassLog(p: PassLog): void {
  mkdirSync(DIR, { recursive: true });
  appendFileSync(AUTOPILOT_LOG_PATH, JSON.stringify(p) + "\n");
}

export function readPassLog(limit = 20): PassLog[] {
  if (!existsSync(AUTOPILOT_LOG_PATH)) return [];
  return readFileSync(AUTOPILOT_LOG_PATH, "utf8")
    .split("\n")
    .filter(Boolean)
    .slice(-limit)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as PassLog];
      } catch {
        return [];
      }
    });
}

// ── Regeln ────────────────────────────────────────────────────────────────────

export const SEND_FROM_HOUR = 8;
export const SEND_UNTIL_HOUR = 20;
/** Senden nur 8:00–19:59 */
export const inSendWindow = (now = new Date()) => now.getHours() >= SEND_FROM_HOUR && now.getHours() < SEND_UNTIL_HOUR;
export const MAX_CHECK_FAILURES = 3;

/** Sicherheitsabfrage, Captcha, Sperre, Login: sofort stoppen, nicht weiterprobieren. */
const HARD_RE = /captcha|sicherheits(abfrage|überprüfung|pruefung)|prüfung erkannt|kein roboter|verify you are human|(konto|account|zugang|profil)\S*\s[^.]{0,30}(gesperrt|blockiert|locked|suspended)|zu viele anfragen|too many requests|login|anmeldeseite|anmeldung fehlgeschlagen|sign_in/i;
/** Eigene Sperre (ein anderer Lauf ist aktiv, lib/tutor24-lock.ts): kein Fehler, der Durchgang wartet aufs naechste Mal. */
export const isBusy = (msg: string) => /^tutor24 ist gesperrt: „/.test(msg) || /automation is already running|Nachfassen läuft bereits/i.test(msg);
export const isHardStop = (msg: string) => !isBusy(msg) && HARD_RE.test(msg);

/** Ohne "Stand: <Name> (<Konversation>) …" (summarizeRunError): kein Name in Meldungen, gleicher Fehler bleibt gleich. */
export const shortError = (msg: string) => msg.replace(/ Stand: [\s\S]*$/, "").trim();
/** Fehlertext ohne Stand/Zahlen, damit "derselbe Fehler" auch in zwei Durchgaengen gleich aussieht. */
export const errorKey = (msg: string) => shortError(msg).replace(/\d+/g, "#").replace(/\s+/g, " ").slice(0, 160);

/** Muss die Automatik nach diesem Durchgang aus? null = nein. */
export function stopReason(p: { pruefungFehler: number; fehler: string | null; letzterFehler: string | null }): string | null {
  if (p.pruefungFehler > MAX_CHECK_FAILURES) return `${p.pruefungFehler} Nachrichten haben die Prüfung nicht bestanden (mehr als ${MAX_CHECK_FAILURES}).`;
  if (!p.fehler || isBusy(p.fehler)) return null;
  if (isHardStop(p.fehler)) return `tutor24: ${p.fehler}`;
  if (p.letzterFehler && errorKey(p.fehler) === p.letzterFehler) return `Derselbe Fehler zweimal hintereinander: ${p.fehler}`;
  return null;
}

/** Automatisch nachgefasst wird nur mit Kurs und Sicherheit "hoch"; Stufen-Frage und Franzoesisch nur von Hand. */
export const AUTO_KINDS = new Set(["angebot", "erinnerung", "geaendert", "neuer_durchgang"]);
export const autoEligible = (r: { sicherheit: string; kind?: string; course: unknown }) =>
  r.sicherheit === "hoch" && !!r.course && AUTO_KINDS.has(r.kind ?? "");

// ── Telegram ──────────────────────────────────────────────────────────────────

/** Nur Vorname: keine weiteren Angaben aus dem Inserat in Meldungen. */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || "(ohne Name)";

async function telegram(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: "TELEGRAM_BOT_TOKEN fehlt" };
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(70_000),
  });
  return (await res.json()) as { ok: boolean; result?: unknown; description?: string };
}

/** Meldung an mich. Scheitert nie laut: eine fehlende Meldung darf keinen Durchgang abbrechen. */
export async function notify(text: string, chatId = process.env.TELEGRAM_CHAT_ID, html = false, markup?: object): Promise<boolean> {
  if (!chatId) {
    console.log(`[telegram, keine TELEGRAM_CHAT_ID] ${text}`);
    return false;
  }
  try {
    const r = await telegram("sendMessage", {
      chat_id: chatId, text, disable_web_page_preview: true, ...(html ? { parse_mode: "HTML" } : {}), ...(markup ? { reply_markup: markup } : {}),
    });
    if (!r.ok) console.error(`[telegram] ${r.description}`);
    return r.ok;
  } catch (err) {
    console.error(`[telegram] ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export type TgUpdate = {
  update_id: number;
  message?: { date: number; text?: string; chat: { id: number; type?: string }; from?: { id?: number; first_name?: string } };
  /** Druck auf einen Knopf ("Jetzt starten"); hat kein eigenes Datum — gilt als jetzt */
  callback_query?: { id: string; data?: string; from: { id: number }; message?: { chat: { id: number } } };
};
/** Knopf-Druck quittieren; Fehler egal (der Knopf zeigt sonst nur kurz eine Uhr) */
export async function answerCallback(id: string, text: string): Promise<void> {
  await telegram("answerCallbackQuery", { callback_query_id: id, text }).catch(() => {});
}

export async function getUpdates(offset: number, timeoutS = 50): Promise<TgUpdate[]> {
  const r = await telegram("getUpdates", { offset, timeout: timeoutS, allowed_updates: ["message", "callback_query"] });
  if (!r.ok) throw new Error(`Telegram getUpdates: ${r.description}`);
  return (r.result as TgUpdate[]) ?? [];
}

/** YYYY-MM-DD in Ortszeit */
export const localDay = (d = new Date()) => d.toLocaleDateString("sv-SE");
const fmt = (d: Date) => d.toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" });
const MODE_LABEL: Record<AutoMode, string> = { aus: "AUS", probe: "PROBE (sendet nichts)", an: "AN" };

export function passSummary(p: PassLog): string {
  const c = (x: PassCounts) => (p.modus === "probe" ? `${x.wuerde} würden gesendet` : `${x.gesendet} gesendet`) + `, ${x.uebersprungen} übersprungen` + (x.pruefungFehler ? `, ${x.pruefungFehler} Prüfung nicht bestanden` : "");
  return [
    `${fmt(new Date(p.start))}–${new Date(p.ende).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })} (${MODE_LABEL[p.modus]})`,
    `Erst-Nachricht: ${c(p.erst)}`,
    `Nachfassen: ${c(p.nachfassen)}`,
    `Neue Antworten: ${p.antworten}`,
    ...(p.fehler.length ? [`Fehler: ${p.fehler.join(" | ")}`] : []),
    ...(p.stopp ? [`Automatik gestoppt: ${p.stopp}`] : []),
  ].join("\n");
}

// ── 429 und naechster Lauf ────────────────────────────────────────────────────

export const RATE_LIMIT_TEXT = "Tutor24 hat das Anfragelimit erreicht. Der Lauf wurde gestoppt.";
export const is429 = (s: string) => /\b429\b|too many requests|zu viele anfragen/i.test(s);
/** ponytail: feste Pause nach einem 429 (tutor24 nennt keine Wartezeit); verlaengern, falls 429 wiederkommt. */
export const RATE_LIMIT_PAUSE_H = 12;

/** Ende der 429-Pause aus dem Protokoll (letzter Durchgang mit 429 + 12 h); null = keine Pause bekannt. */
export function rateLimitUntil(passes: PassLog[]): Date | null {
  const hit = [...passes].reverse().find((p) => is429(p.stopp ?? "") || p.fehler.some(is429));
  return hit ? new Date(new Date(hit.ende || hit.start).getTime() + RATE_LIMIT_PAUSE_H * 3_600_000) : null;
}
/** Laeuft die 429-Pause noch? Dann ihr Ende, sonst null. */
export const activePause = (passes: PassLog[], now = new Date()) => {
  const until = rateLimitUntil(passes);
  return until && until > now ? until : null;
};

/** Lebenszeichen fuer den Waechter (Tutor24Signal "laptop"): jetzt, Modus, letzter Stopp, 429-Pause */
export function laptopSignal(now = new Date()) {
  const s = loadAutopilot();
  const pause = activePause(readPassLog(50), now);
  return { at: now.toISOString(), modus: s.modus, gestoppt: s.gestoppt, pauseBis: pause?.toISOString() ?? null };
}

/** Geplante Laeufe (Windows-Aufgabe), Ortszeit des PCs = Europe/Zurich */
// Start mit 2 statt 3 Durchgaengen (Entscheid 5.11. nach dem 429); muss zur Windows-Aufgabe passen.
export const RUN_HOURS = [9, 17];
/** Abend-Zusammenfassung ab dem letzten geplanten Durchgang */
export const SUMMARY_FROM_HOUR = RUN_HOURS[RUN_HOURS.length - 1];
/** Naechster geplanter Lauf ab `from` (inklusive). */
export function nextScheduled(from: Date): Date {
  for (let day = 0; day < 3; day++)
    for (const h of RUN_HOURS) {
      const t = new Date(from.getFullYear(), from.getMonth(), from.getDate() + day, h, 0, 0, 0);
      if (t >= from) return t;
    }
  throw new Error("unreachable");
}

// ── /status ───────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const TZ = "Europe/Zurich";
export const fmtZurich = (d: Date) =>
  d.toLocaleString("de-CH", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Kurzes Ergebnis eines Durchgangs */
export function passResult(p: PassLog): string {
  if (is429(p.stopp ?? "") || p.fehler.some(is429)) return RATE_LIMIT_TEXT;
  if (p.stopp) return `Gestoppt: ${p.stopp.slice(0, 120)}`;
  if (p.fehler.length) return `Abgebrochen: ${p.fehler[0].slice(0, 120)}`;
  const replies = `${p.antworten} ${p.antworten === 1 ? "neue Antwort" : "neue Antworten"}`;
  return p.modus === "probe" ? `Probelauf ohne Fehler · ${replies}` : `Ohne Fehler · ${replies}`;
}

export const HELP_LINES = [
  "/status zeigt den Stand.",
  "/run startet einen Probelauf ohne Versand.",
  "/stop schaltet die Automatik aus.",
  "/enable schaltet die Automatik ein (mit Bestätigung).",
];

/** Antwort auf /status (Telegram-HTML), fuer das Handy: Zustand, letzter Lauf, naechster Lauf, Befehle. */
export function statusHtml(s: AutoState, passes: PassLog[], now = new Date()): string {
  const last = passes[passes.length - 1];
  const pause = activePause(passes, now);
  const head =
    s.modus === "an" ? "🟢 <b>Automatik eingeschaltet</b>" : s.modus === "probe" ? "🟡 <b>Probe-Modus (sendet nichts)</b>" : "🔴 <b>Automatik ausgeschaltet</b>";
  const lines = ["<b>Mathetogo · tutor24</b>", head, ""];
  if (!last) lines.push("Noch kein Lauf erfasst");
  else {
    const sent = last.erst.gesendet + last.nachfassen.gesendet;
    const wuerde = last.erst.wuerde + last.nachfassen.wuerde;
    lines.push(
      `<b>Letzter Lauf</b> ${esc(fmtZurich(new Date(last.start)))}`,
      `<b>Ergebnis</b> ${esc(passResult(last))}`,
      `<b>Gesendete Nachrichten</b> ${sent}` +
        (last.modus === "probe" ? ` (Probe: ${wuerde} wären gesendet worden)` : ` (Erst-Nachricht ${last.erst.gesendet} · Nachfassen ${last.nachfassen.gesendet})`)
    );
  }
  // Steht der 429 schon als Ergebnis da, nur noch die Zeit nennen.
  if (pause)
    lines.push(
      "",
      ...(last && passResult(last) === RATE_LIMIT_TEXT ? [] : [`⏸ ${esc(RATE_LIMIT_TEXT)}`]),
      `<b>Frühester nächster Lauf</b> ${esc(fmtZurich(s.modus === "an" ? nextScheduled(pause) : pause))}`
    );
  else if (s.modus !== "aus") lines.push("", `<b>Nächster geplanter Lauf</b> ${esc(fmtZurich(nextScheduled(now)))}`);
  return [...lines, "", ...HELP_LINES].join("\n");
}

/** Abend: alle Durchgaenge eines Tages zusammen. */
export function daySummary(day: string, passes = readPassLog(50)): string {
  const today = passes.filter((p) => localDay(new Date(p.start)) === day);
  const sum = (f: (p: PassLog) => number) => today.reduce((n, p) => n + f(p), 0);
  const probe = today.some((p) => p.modus === "probe");
  return [
    `${probe ? "PROBE — " : ""}Zusammenfassung ${day.split("-").reverse().join(".")}: ${today.length} Durchgänge`,
    `Erst-Nachrichten: ${sum((p) => p.erst.gesendet)} gesendet${probe ? `, ${sum((p) => p.erst.wuerde)} würden gesendet` : ""}`,
    `Nachfassen: ${sum((p) => p.nachfassen.gesendet)} gesendet${probe ? `, ${sum((p) => p.nachfassen.wuerde)} würden gesendet` : ""}`,
    `Neue Antworten: ${sum((p) => p.antworten)}`,
    `Fehler: ${sum((p) => p.fehler.length)}`,
  ].join("\n");
}
