/**
 * Dateiablage fuers Nachfassen: Einstellungen und Kurse (JSON), Vorschau und Protokoll (CSV).
 * Alles unter tutor24-followup/ im Projektordner — dort, wo Kommandozeile und
 * App-Server gleichermassen hinschauen. Der Ordner ist gitignored (Namen).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  LOG_COLS,
  MARKS,
  MAX_SENDS_PER_DAY,
  PREVIEW_COLS,
  effectiveStatus,
  mergeSettings,
  parseCsv,
  renderMessage,
  toCsv,
  validateCourses,
  type Anrede,
  type Course,
  type FollowupSettings,
  type LogRow,
  type PreviewRow,
} from "./tutor24-followup";

export const FOLLOWUP_DIR = join(process.cwd(), "tutor24-followup");
export const PREVIEW_PATH = join(FOLLOWUP_DIR, "followup_preview.csv");
export const LOG_PATH = join(FOLLOWUP_DIR, "followup_log.csv");
export const SETTINGS_PATH = join(FOLLOWUP_DIR, "settings.json");
export const COURSES_PATH = join(FOLLOWUP_DIR, "courses.json");
/** Laufstatus des Lauf-Prozesses; der Tab liest ihn, statt Speicher im Dev-Server. */
export const STATUS_PATH = join(FOLLOWUP_DIR, "status.json");
/** Existiert die Datei, haelt der Lauf beim naechsten Schritt an. */
export const STOP_PATH = join(FOLLOWUP_DIR, "stop.request");
/** Ausgabe des aus der App gestarteten Prozesses (fuer Abstuerze vor dem ersten Status). */
export const RUN_LOG_PATH = join(FOLLOWUP_DIR, "run.log");

export type RunStatus = {
  running: boolean;
  pid: number;
  mode: "preview" | "send" | "replies" | null;
  startedAt: string | null;
  finishedAt: string | null;
  progress: string;
  done: number;
  total: number;
  log: string[];
  error: string | null;
};

export function writeStatus(s: RunStatus): void {
  try {
    mkdirSync(FOLLOWUP_DIR, { recursive: true });
    writeFileSync(STATUS_PATH, JSON.stringify(s));
  } catch {
    // Status ist Anzeige — ein Schreibfehler darf den Lauf nicht abbrechen.
  }
}

export function readStatus(): RunStatus | null {
  try {
    return JSON.parse(readFileSync(STATUS_PATH, "utf8")) as RunStatus;
  } catch {
    return null;
  }
}

export const requestStop = () => writeChecked(STOP_PATH, new Date().toISOString());
export const stopRequested = () => existsSync(STOP_PATH);
export const clearStop = () => rmSync(STOP_PATH, { force: true });

/** Excel sperrt geoeffnete Dateien — dann eine verstaendliche Meldung statt EBUSY. */
function writeChecked(path: string, content: string): void {
  try {
    mkdirSync(FOLLOWUP_DIR, { recursive: true });
    writeFileSync(path, content);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EBUSY")
      throw new Error(`${path} ist gesperrt (in Excel geöffnet?) — bitte schliessen und nochmals versuchen.`);
    throw err;
  }
}

const readJson = (path: string): unknown => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);

export function loadSettings(): FollowupSettings {
  return mergeSettings(readJson(SETTINGS_PATH) as Partial<FollowupSettings> | null);
}

export function loadCourses(): Course[] {
  const raw = readJson(COURSES_PATH);
  return Array.isArray(raw) ? (raw as Course[]) : [];
}

/** Speichert Faecher + Kurse nach Pruefung und frischt Kurs und Nachricht in der Vorschau-CSV auf. */
export function saveConfig(input: { settings?: unknown; courses?: unknown }): { settings: FollowupSettings; courses: Course[] } {
  const settings = mergeSettings(input.settings as Partial<FollowupSettings> | null);
  const courses = Array.isArray(input.courses) ? (input.courses as Course[]) : [];
  const errors = validateCourses(courses);
  if (errors.length) throw new Error(errors.join(" "));
  writeChecked(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  writeChecked(COURSES_PATH, JSON.stringify(courses, null, 2));
  if (existsSync(PREVIEW_PATH)) writePreview(readPreview(), courses, settings);
  return { settings, courses };
}

export function readPreview(): PreviewRow[] {
  if (!existsSync(PREVIEW_PATH)) return [];
  // Vorschau aus der Zeit vor der Nachfrage-Analyse: neue Spalten leer ergaenzen.
  return parseCsv(readFileSync(PREVIEW_PATH, "utf8")).map(
    (r) => Object.fromEntries(PREVIEW_COLS.map((c) => [c, r[c] ?? ""])) as PreviewRow
  );
}

/** Zugeordneter Kurs und Text einer Zeile aus den AKTUELLEN Kursen; null = wird nicht gesendet. */
export function messageFor(row: PreviewRow, courses: Course[], settings: FollowupSettings, logged?: Set<string>) {
  const eff = effectiveStatus(row, courses, settings, logged);
  if (!eff.course) return null;
  return { course: eff.course, send: eff.send, ...renderMessage(eff.course, row.name, (row.anrede === "du" ? "du" : "Sie") as Anrede) };
}

/** Schreibt die Vorschau; "kurs" und "nachricht" folgen immer den aktuellen Kursen. */
export function writePreview(rows: PreviewRow[], courses = loadCourses(), settings = loadSettings()): void {
  const withText = rows.map((r) => {
    const m = messageFor(r, courses, settings);
    return { ...r, kurs: m?.course.name ?? "", nachricht: m?.text ?? "" };
  });
  writeChecked(PREVIEW_PATH, toCsv(withText, PREVIEW_COLS));
}

export function setRowStatus(conversationId: string, status: "send" | "skip"): void {
  const rows = readPreview();
  const row = rows.find((r) => r.conversation_id === conversationId);
  if (!row) throw new Error(`Konversation ${conversationId} steht nicht in der Vorschau.`);
  row.status = status;
  writePreview(rows);
}

export function readLog(): LogRow[] {
  if (!existsSync(LOG_PATH)) return [];
  // Aeltere Protokolle haben weniger Spalten: fehlende als leer ergaenzen.
  return parseCsv(readFileSync(LOG_PATH, "utf8")).map(
    (r) => Object.fromEntries(LOG_COLS.map((c) => [c, r[c] ?? ""])) as LogRow
  );
}

export function writeLog(rows: LogRow[]): void {
  writeChecked(LOG_PATH, toCsv(rows, LOG_COLS));
}

export function loggedIds(): Set<string> {
  return new Set(readLog().map((r) => r.conversation_id));
}

/** Ganze Datei neu schreiben: so bekommen auch alte Protokolle die neuen Spalten. */
export function appendLog(row: Partial<LogRow> & Pick<LogRow, "conversation_id" | "zeitstempel" | "status">): void {
  const full = Object.fromEntries(LOG_COLS.map((c) => [c, row[c] ?? ""])) as LogRow;
  writeLog([...readLog(), full]);
}

export function updateLog(conversationId: string, patch: Partial<LogRow>): void {
  const rows = readLog();
  const row = rows.find((r) => r.conversation_id === conversationId);
  if (!row) throw new Error(`Konversation ${conversationId} steht nicht im Protokoll.`);
  Object.assign(row, patch);
  writeLog(rows);
}

export function setMark(conversationId: string, markierung: string): void {
  if (!(MARKS as readonly string[]).includes(markierung)) throw new Error(`Markierung muss eine von ${MARKS.join(", ")} sein.`);
  updateLog(conversationId, { markierung });
}

/** Heute schon versuchte Sendungen (auch "unbestaetigt" zaehlt mit). */
export function sentToday(now = new Date()): number {
  const today = now.toDateString();
  return readLog().filter((r) => new Date(r.zeitstempel).toDateString() === today).length;
}

/** Was jetzt gesendet wuerde: effektiver Status "wird gesendet", im Tageslimit. */
export function sendQueue(courses = loadCourses(), settings = loadSettings(), now = new Date()) {
  const logged = loggedIds();
  const pending = readPreview()
    .map((row) => ({ row, eff: effectiveStatus(row, courses, settings, logged) }))
    .filter((x) => x.eff.send)
    .map((x) => ({ ...x.row, course: x.eff.course as Course }));
  const budget = Math.max(0, MAX_SENDS_PER_DAY - sentToday(now));
  return { pending, queue: pending.slice(0, budget), budget };
}
