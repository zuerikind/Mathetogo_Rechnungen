/**
 * Dateiablage fuers Nachfassen: Einstellungen (JSON), Vorschau (CSV), Protokoll (CSV).
 * Alles unter tutor24-followup/ im Projektordner — dort, wo Kommandozeile und
 * App-Server gleichermassen hinschauen. Der Ordner ist gitignored (Namen).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  LOG_COLS,
  MAX_SENDS_PER_DAY,
  PREVIEW_COLS,
  isOfferLevel,
  mergeSettings,
  parseCsv,
  renderMessage,
  toCsv,
  validateSettings,
  type Anrede,
  type FollowupSettings,
  type PreviewRow,
} from "./tutor24-followup";

export const FOLLOWUP_DIR = join(process.cwd(), "tutor24-followup");
export const PREVIEW_PATH = join(FOLLOWUP_DIR, "followup_preview.csv");
export const LOG_PATH = join(FOLLOWUP_DIR, "followup_log.csv");
export const SETTINGS_PATH = join(FOLLOWUP_DIR, "settings.json");

function ensureDir() {
  mkdirSync(FOLLOWUP_DIR, { recursive: true });
}

/** Excel sperrt geoeffnete Dateien — dann eine verstaendliche Meldung statt EBUSY. */
function writeChecked(path: string, content: string): void {
  try {
    ensureDir();
    writeFileSync(path, content);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EBUSY")
      throw new Error(`${path} ist gesperrt (in Excel geöffnet?) — bitte schliessen und nochmals versuchen.`);
    throw err;
  }
}

export function loadSettings(): FollowupSettings {
  if (!existsSync(SETTINGS_PATH)) return mergeSettings(null);
  return mergeSettings(JSON.parse(readFileSync(SETTINGS_PATH, "utf8")));
}

/** Speichert nach Pruefung und frischt die Nachrichten in der Vorschau-CSV auf. */
export function saveSettings(input: unknown): FollowupSettings {
  const settings = mergeSettings(input as Parameters<typeof mergeSettings>[0]);
  const errors = validateSettings(settings);
  if (errors.length) throw new Error(errors.join(" "));
  writeChecked(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  if (existsSync(PREVIEW_PATH)) writePreview(readPreview(), settings);
  return settings;
}

export function readPreview(): PreviewRow[] {
  if (!existsSync(PREVIEW_PATH)) return [];
  return parseCsv(readFileSync(PREVIEW_PATH, "utf8")) as PreviewRow[];
}

/** Text einer Zeile aus den AKTUELLEN Einstellungen; leer bei Stufen ohne Angebot. */
export function messageFor(row: PreviewRow, settings: FollowupSettings) {
  if (!isOfferLevel(row.kategorie)) return null;
  return renderMessage(settings[row.kategorie], row.name, (row.anrede === "du" ? "du" : "Sie") as Anrede);
}

/** Schreibt die Vorschau; die Spalte "nachricht" folgt immer den aktuellen Einstellungen. */
export function writePreview(rows: PreviewRow[], settings = loadSettings()): void {
  const withText = rows.map((r) => ({ ...r, nachricht: messageFor(r, settings)?.text ?? "" }));
  writeChecked(PREVIEW_PATH, toCsv(withText, PREVIEW_COLS));
}

export function setRowStatus(conversationId: string, status: "send" | "skip"): void {
  const rows = readPreview();
  const row = rows.find((r) => r.conversation_id === conversationId);
  if (!row) throw new Error(`Konversation ${conversationId} steht nicht in der Vorschau.`);
  row.status = status;
  writePreview(rows);
}

export function readLog(): Record<string, string>[] {
  if (!existsSync(LOG_PATH)) return [];
  return parseCsv(readFileSync(LOG_PATH, "utf8"));
}

export function loggedIds(): Set<string> {
  return new Set(readLog().map((r) => r.conversation_id));
}

export function appendLog(row: Record<(typeof LOG_COLS)[number], string>): void {
  ensureDir();
  if (!existsSync(LOG_PATH)) writeFileSync(LOG_PATH, toCsv([], LOG_COLS));
  // toCsv liefert BOM + Kopfzeile; nur die Datenzeile anhaengen.
  appendFileSync(LOG_PATH, toCsv([row], LOG_COLS).split("\r\n").slice(1).join("\r\n"));
}

/** Heute schon versuchte Sendungen (auch "unbestaetigt" zaehlt mit). */
export function sentToday(now = new Date()): number {
  const today = now.toDateString();
  return readLog().filter((r) => new Date(r.zeitstempel).toDateString() === today).length;
}

/** Was jetzt gesendet wuerde: status=send, Stufe angehakt, nie zuvor nachgefasst, im Tageslimit. */
export function sendQueue(settings = loadSettings(), now = new Date()) {
  const logged = loggedIds();
  const pending = readPreview().filter(
    (r) =>
      r.status.trim().toLowerCase() === "send" &&
      isOfferLevel(r.kategorie) &&
      settings[r.kategorie].enabled &&
      !logged.has(r.conversation_id)
  );
  const budget = Math.max(0, MAX_SENDS_PER_DAY - sentToday(now));
  return { pending, queue: pending.slice(0, budget), budget };
}
