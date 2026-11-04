/**
 * Dateiablage fuers Nachfassen: Einstellungen und Kurse (JSON), Vorschau und Protokoll (CSV).
 * Alles unter tutor24-followup/ im Projektordner — dort, wo Kommandozeile und
 * App-Server gleichermassen hinschauen. Der Ordner ist gitignored (Namen).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "./prisma";
import {
  LOG_COLS,
  MARKS,
  MAX_SENDS_PER_DAY,
  PREVIEW_COLS,
  courseExclusion,
  effectiveStatus,
  isOfferLevel,
  mergeSettings,
  messageProblem,
  parseCsv,
  renderMessage,
  toCsv,
  validateCourses,
  type Anrede,
  type Course,
  type FollowupSettings,
  type ListCache,
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
/** Zwischenspeicher der Konversationslisten (pro Tab), damit nicht jeder Lauf alles nachlaedt. */
export const CONVERSATIONS_PATH = join(FOLLOWUP_DIR, "conversations.json");
/** Zeitmessung: pro Lauf eine Zeile je Phase. */
export const TIMING_PATH = join(FOLLOWUP_DIR, "timing.csv");
/** Vergleichsmodus: Unterschiede "nur Konversation" vs. "Konversation + Inserat". */
export const COMPARE_PATH = join(FOLLOWUP_DIR, "compare.csv");
export const TIMING_COLS = ["lauf", "modus", "phase", "dauer_s", "seitenaufrufe", "konversationen"] as const;
export const COMPARE_COLS = ["conversation_id", "name", "inserat_noetig", "feld", "nur_konversation", "mit_inserat"] as const;

export type RunStatus = {
  running: boolean;
  pid: number;
  mode: "preview" | "send" | "replies" | "compare" | null;
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

export function loadListCache(tab: string): ListCache {
  try {
    return ((readJson(CONVERSATIONS_PATH) as Record<string, ListCache> | null) ?? {})[tab] ?? {};
  } catch {
    // Kaputter Zwischenspeicher = keiner: die Liste wird dann einfach ganz geladen.
    return {};
  }
}

export function saveListCache(tab: string, cache: ListCache): void {
  let all: Record<string, ListCache> = {};
  try {
    all = (readJson(CONVERSATIONS_PATH) as Record<string, ListCache> | null) ?? {};
  } catch {
    /* neu anlegen */
  }
  writeChecked(CONVERSATIONS_PATH, JSON.stringify({ ...all, [tab]: cache }));
}

/** CSV um Zeilen ergaenzen (ganze Datei neu, wie beim Protokoll). */
export function appendCsv(path: string, cols: readonly string[], rows: Record<string, string>[]): void {
  const old = existsSync(path) ? parseCsv(readFileSync(path, "utf8")) : [];
  writeChecked(path, toCsv([...old, ...rows], cols));
}

export function loadSettings(): FollowupSettings {
  return mergeSettings(readJson(SETTINGS_PATH) as Partial<FollowupSettings> | null);
}

export function loadCourses(): Course[] {
  const raw = readJson(COURSES_PATH);
  return Array.isArray(raw) ? (raw as Course[]) : [];
}

export const BACKUP_DIR = join(FOLLOWUP_DIR, "backups");
const KEEP_BACKUPS = 20;

/**
 * courses.json ist nicht im Git: vor dem Ueberschreiben eine Kopie mit Zeitstempel.
 * /kurse speichert automatisch bei jeder Aenderung — darum hoechstens eine Kopie pro Stunde,
 * sonst waeren 20 Kopien nach wenigen Minuten Tippen nur noch Zwischenstaende.
 * Gesichert wird der Stand VOR der ersten Aenderung der Stunde.
 */
function backupCourses(now = new Date()): void {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const files = readdirSync(BACKUP_DIR).filter((f) => /^courses-.*\.json$/.test(f)).sort();
  const newest = files.at(-1);
  if (newest && now.getTime() - statSync(join(BACKUP_DIR, newest)).mtimeMs < 60 * 60 * 1000) return;
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  // writeFileSync statt copyFileSync: copyFile uebernimmt unter Windows das alte Aenderungsdatum.
  writeFileSync(join(BACKUP_DIR, `courses-${stamp}.json`), readFileSync(COURSES_PATH));
  for (const old of [...files, `courses-${stamp}.json`].slice(0, -KEEP_BACKUPS)) rmSync(join(BACKUP_DIR, old), { force: true });
}

/** Speichert Faecher + Kurse nach Pruefung und frischt Kurs und Nachricht in der Vorschau-CSV auf. */
export function saveConfig(input: { settings?: unknown; courses?: unknown }): { settings: FollowupSettings; courses: Course[] } {
  const settings = mergeSettings(input.settings as Partial<FollowupSettings> | null);
  const courses = Array.isArray(input.courses) ? (input.courses as Course[]) : [];
  const errors = validateCourses(courses);
  if (errors.length) throw new Error(errors.join(" "));
  writeChecked(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  const next = JSON.stringify(courses, null, 2);
  if (existsSync(COURSES_PATH) && readFileSync(COURSES_PATH, "utf8") !== next) backupCourses();
  writeChecked(COURSES_PATH, next);
  if (existsSync(PREVIEW_PATH)) writePreview(readPreview(), courses, settings);
  return { settings, courses };
}

export function readPreview(): PreviewRow[] {
  if (!existsSync(PREVIEW_PATH)) return [];
  // Vorschau aus der Zeit vor der Nachfrage-Analyse: neue Spalten leer ergaenzen.
  // Vor "offen" blieb die Kursgruppe leer, wenn das Jahr fehlte.
  return parseCsv(readFileSync(PREVIEW_PATH, "utf8")).map((r) => {
    const row = Object.fromEntries(PREVIEW_COLS.map((c) => [c, r[c] ?? ""])) as PreviewRow;
    if (!row.kursgruppe && row.faecher && isOfferLevel(row.kategorie)) row.kursgruppe = "offen";
    // Vor der Ausschluss-Spalte gespeichert: so gut es geht aus Stufe und Fundstelle nachholen.
    // Der naechste Probelauf ueberschreibt das mit der Analyse des ganzen Inserats.
    if (!("ausschluss" in r))
      row.ausschluss = courseExclusion({ title: "", fach: row.fach, schulstufe: row.stufe, description: row.begruendung }) ?? "";
    return row;
  });
}

/** Zugeordneter Kurs und Text einer Zeile aus den AKTUELLEN Kursen; null = wird nicht gesendet. */
export function messageFor(row: PreviewRow, courses: Course[], settings: FollowupSettings, log: LogRow[]) {
  const eff = effectiveStatus(row, courses, settings, undefined, log);
  if (!eff.course) return null;
  return { course: eff.course, send: eff.send, ...renderMessage(eff.course, row.name, (row.anrede === "du" ? "du" : "Sie") as Anrede) };
}

/** Schreibt die Vorschau; "kurs" und "nachricht" folgen immer den aktuellen Kursen. */
export function writePreview(rows: PreviewRow[], courses = loadCourses(), settings = loadSettings()): void {
  const log = readLog();
  const withText = rows.map((r) => {
    const m = messageFor(r, courses, settings, log);
    return { ...r, kurs: m?.course.name ?? "", nachricht: m?.text ?? "" };
  });
  writeChecked(PREVIEW_PATH, toCsv(withText, PREVIEW_COLS));
}

/** Anrede einer Person von Hand korrigieren (die Erkennung aus dem Inserat liegt mal daneben). */
export function setRowAnrede(conversationId: string, anrede: Anrede): void {
  const rows = readPreview();
  const row = rows.find((r) => r.conversation_id === conversationId);
  if (!row) throw new Error(`Konversation ${conversationId} steht nicht in der Vorschau.`);
  row.anrede = anrede;
  writePreview(rows);
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

/**
 * Antwort auf "Stufe nachfragen" einem richtigen Kurs zuordnen: die Person steht dann in dessen
 * Pipeline unter "Interessiert". Gesendet wird ihr nichts mehr (sie steht im Protokoll).
 */
export function assignToCourse(conversationId: string, courseId: string): void {
  const course = loadCourses().find((c) => c.id === courseId);
  if (!course || course.gruppe === "offen") throw new Error("Unbekannter Kurs.");
  const row = readLog().find((r) => r.conversation_id === conversationId);
  updateLog(conversationId, { kurs: course.id, markierung: "Frage", variante: `${row?.variante ?? ""} → ${course.name}` });
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
/** Inserat-ID → Kurs, der schon in der Erst-Nachricht angeboten wurde (Tutor24Contact.kursId). */
export async function offeredCourses(): Promise<Map<string, string>> {
  const rows = await prisma.tutor24Contact.findMany({ where: { kursId: { not: null } }, select: { tutor24Id: true, kursId: true } });
  return new Map(rows.map((r) => [r.tutor24Id, r.kursId as string]));
}

/**
 * courseId: nur diesen Kurs anschreiben (Knopf beim ausgewaehlten Kurs); das Tageslimit gilt trotzdem gesamt.
 * offered: wer denselben Kurs schon in der Erst-Nachricht bekam, wird nicht nochmals angeschrieben.
 */
export function sendQueue(
  courses = loadCourses(),
  settings = loadSettings(),
  now = new Date(),
  courseId?: string,
  offered: Map<string, string> = new Map()
) {
  const log = readLog();
  const logged = new Set(log.map((r) => r.conversation_id));
  const pending = readPreview()
    .map((row) => ({ row, eff: effectiveStatus(row, courses, settings, logged, log, now) }))
    .filter((x) => x.eff.send && (!courseId || x.eff.course?.id === courseId))
    .filter((x) => !(x.row.inserat_id && offered.get(x.row.inserat_id) === x.eff.course?.id))
    .map((x) => {
      const course = x.eff.course as Course;
      // Fertiger Text samt Pruefung: derselbe, den Tab, API und Sende-Lauf sehen.
      const m = renderMessage(course, x.row.name, x.row.anrede === "du" ? "du" : "Sie");
      const text = m.text.trim();
      return { ...x.row, course, text, anrede: m.anrede, problem: messageProblem(text, m.anrede) };
    });
  const budget = Math.max(0, MAX_SENDS_PER_DAY - sentToday(now));
  return { pending, queue: pending.slice(0, budget), budget };
}
