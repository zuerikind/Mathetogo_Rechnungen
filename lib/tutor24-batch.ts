/**
 * Batch von Hand (bis 20.11. nur iPhone-Hotspot, Automatik aus): vorbereiten → Vorschau auf /kurse → "Ausgewählte senden".
 * Ablage tutor24-followup/batch.json (lokal, gitignored). Laeufe: scripts/batch.mts (eigener Prozess).
 *
 * Mindestabstand: Vorbereiten und Senden zaehlen als EIN Lauf. Vorbereiten braucht die 2 h Abstand wie jeder Lauf;
 * Senden darf direkt danach, solange seit dem Vorbereiten kein anderer Lauf war und hoechstens SEND_WITHIN_MIN vergangen sind.
 * Sonst gilt wieder der normale Abstand (dann neu vorbereiten).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { freemem, totalmem } from "node:os";
import { join } from "node:path";
import { FOLLOWUP_DIR } from "./tutor24-followup-store";
import type { Addressee, ListingInfo } from "./tutor24-followup";

export const BATCH_PATH = join(FOLLOWUP_DIR, "batch.json");
export const BATCH_MAX = 20;
export const SEND_WITHIN_MIN = 60;

export type AnredeWahl = "du" | "Tochter" | "Sohn" | "Kind" | "unklar";
export const ANREDE_WAHL: AnredeWahl[] = ["du", "Tochter", "Sohn", "Kind", "unklar"];
export const addresseeFor = (w: AnredeWahl): Addressee =>
  w === "du" ? { wer: "schueler", anrede: "du", kind: null } : w === "unklar" ? { wer: "unklar", anrede: "Sie", kind: null } : { wer: "eltern", anrede: "Sie", kind: w };
export const wahlOf = (a: Addressee): AnredeWahl => (a.wer === "schueler" ? "du" : a.wer === "eltern" && a.kind ? a.kind : "unklar");

export type BatchItem = {
  /** erst: Inserat-ID; nachfassen: Konversations-ID */
  id: string;
  art: "erst" | "nachfassen";
  titel: string;
  stufe: string;
  ort: string;
  link: string;
  sprache: "de" | "en" | "fr";
  anrede: AnredeWahl;
  /** z. B. "Kursblock: Mathe-Vorbereitungskurs …", "Kurs-Hinweis", "ohne" */
  block: string;
  kursId: string | null;
  hint: string | null;
  /** ki | fallback (Ersatzsatz) | - (Nachfassen) */
  satz: string;
  text: string;
  /** Pruefung vor dem Senden; != null → nicht sendbar */
  problem: string | null;
  ausgewaehlt: boolean;
  /** "⚠ Möglicherweise Agentur": Grund (agenturVerdacht); dann ohne Haekchen, Omid entscheidet */
  agentur?: string | null;
  /** "⚠ Mathe nur Nebenfach": Grund (matheNebenfach); dann ohne Haekchen, Omid entscheidet */
  nebenfach?: string | null;
  /** nur erst: fuer Anrede umstellen und Lead-Daten beim Senden */
  info?: ListingInfo;
  ergebnis?: "gesendet" | "übersprungen" | "fehler";
  meldung?: string;
};

export type Batch = {
  zustand: "vorbereiten" | "bereit" | "sendet" | "fertig" | "fehler";
  pid: number;
  gestartet: string;
  /** Ende des Vorbereitens (= letzter-lauf.json "ende") */
  vorbereitetBis: string | null;
  fehler: string | null;
  items: BatchItem[];
  log: string[];
};

export function loadBatch(path = BATCH_PATH): Batch | null {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Batch) : null;
  } catch {
    return null;
  }
}
export const saveBatch = (b: Batch, path = BATCH_PATH) => writeFileSync(path, JSON.stringify(b, null, 1));

/**
 * Darf jetzt gesendet werden? null = ja, sonst der Grund.
 * lastRunEnd: Ende des letzten tutor24-Laufs (letzter-lauf.json); earliest: normaler Mindestabstand (null = erreicht).
 */
export function sendBlock(b: Batch | null, now: Date, lastRunEnd: Date | null, earliest: Date | null): string | null {
  if (!b || b.zustand !== "bereit") return "Kein vorbereiteter Batch.";
  if (!b.items.some((i) => i.ausgewaehlt && !i.problem && !i.ergebnis)) return "Nichts ausgewählt.";
  if (!earliest) return null;
  const prepared = b.vorbereitetBis ? new Date(b.vorbereitetBis) : null;
  const sameRun = !!prepared && !!lastRunEnd && Math.abs(lastRunEnd.getTime() - prepared.getTime()) < 5_000;
  if (sameRun && now.getTime() - prepared!.getTime() <= SEND_WITHIN_MIN * 60_000) return null;
  return sameRun
    ? `Vorbereitet vor mehr als ${SEND_WITHIN_MIN} min — bitte neu vorbereiten (frühestens ${earliest.toLocaleTimeString("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" })}).`
    : `Seit dem Vorbereiten lief ein anderer Lauf. Nächster Lauf frühestens um ${earliest.toLocaleTimeString("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" })}.`;
}

/** Mindestens so viel Arbeitsspeicher frei (verfuegbar), bevor ein Batch-Lauf den Browser startet (9.11.: Dev-Server wegen Speicher beendet). */
export const MIN_FREI_GB = 1.5;

/** null = genug frei; sonst Meldung mit den Programmen, die am meisten brauchen. */
export function speicherProblem(freiBytes = freemem(), gesamtBytes = totalmem()): string | null {
  const gb = (b: number) => (b / 2 ** 30).toFixed(1);
  if (freiBytes / 2 ** 30 >= MIN_FREI_GB) return null;
  let top = "";
  try {
    top = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command",
        "Get-Process | Group-Object ProcessName | ForEach-Object { '{0} {1:N1} GB' -f $_.Name, (($_.Group | Measure-Object WorkingSet64 -Sum).Sum/1GB) } | Sort-Object { [double](($_ -split ' ')[-2]) } -Descending | Select-Object -First 5"],
      { encoding: "utf8", timeout: 15_000 }
    ).trim().split(/\r?\n/).join(", ");
  } catch {
    // Liste ist Beiwerk
  }
  return `Zu wenig Arbeitsspeicher frei: ${gb(freiBytes)} von ${gb(gesamtBytes)} GB (nötig ${MIN_FREI_GB} GB). ${top ? `Am meisten brauchen: ${top}. ` : ""}Bitte etwas schliessen (z. B. Chrome-Tabs, Cursor) und nochmals versuchen.`;
}
