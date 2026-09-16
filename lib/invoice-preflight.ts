/**
 * Vorpruefung vor der Auslieferung: keine Rechnung raus, solange der Kalender
 * fuer genau diese Lektionen einen offenen Befund hat.
 *
 * Der Fall, den das verhindert: im August sind Leo und Elenor mit einer
 * doppelten Zeile fakturiert worden. Die Erkennung haette es gesehen — nur lief
 * sie damals nicht, und selbst mit Stage 1 haette niemand hingeschaut, bevor die
 * Mail draussen war. Ausgeliefert ist unumkehrbar: ab da laeuft die Korrektur
 * ueber eine Neuausstellung, mit neuer Fassung beim Kunden.
 *
 * Zugeordnet wird ueber die LEKTIONEN, nicht ueber Schueler oder Monat: ein
 * Befund blockiert genau die Rechnung, auf deren Positionen er sitzt. Damit
 * blockiert ein Befund aus einem anderen Monat oder von einem anderen Schueler
 * nichts, und es braucht keine zweite Definition der Rechnungsgruppe — die
 * `sessionIds` der Rechnung sind bereits die verbindliche Antwort darauf.
 *
 * Bewusst ohne Umgehung ("trotzdem senden"). Der Weg aus der Sperre fuehrt
 * ueber "Kalender pruefen": erledigen, wenn behoben, oder ignorieren, wenn der
 * Befund absichtlich so ist. Eine Taste, die die Pruefung ueberspringt, waere
 * genau die Taste, die im August gedrueckt worden waere.
 */

import { CANCELLATION_REASONS } from "@/lib/calendar-cancellation";
import { INTEGRITY_REASONS } from "@/lib/calendar-integrity";
import { IDENTITY_REASONS } from "@/lib/calendar-identity";

/** Alle Befundarten, die eine Auslieferung aufhalten. */
export const BLOCKING_ISSUE_REASONS: string[] = [
  ...INTEGRITY_REASONS,
  ...IDENTITY_REASONS,
  ...CANCELLATION_REASONS,
];

export type PreflightIssue = {
  /** CalendarSyncIssue.externalEventId — der stabile Schluessel des Befunds. */
  key: string;
  reason: string;
  title: string;
  /** Lektionen, auf die sich der Befund bezieht. */
  sessionIds: string[];
};

/**
 * Welche offenen Befunde sitzen auf den Lektionen dieser Rechnung?
 *
 * Ein Befund ohne `sessionIds` (Altbestand, unlesbares JSON) blockiert nichts:
 * ohne Bezug zu einer Position laesst sich nicht sagen, ob er diese Rechnung
 * betrifft, und eine Sperre auf Verdacht wuerde jede Auslieferung anhalten.
 */
export function blockingCalendarIssues(args: {
  openIssues: readonly PreflightIssue[];
  billedSessionIds: ReadonlySet<string>;
}): PreflightIssue[] {
  if (args.billedSessionIds.size === 0) return [];
  return args.openIssues.filter((issue) =>
    issue.sessionIds.some((id) => args.billedSessionIds.has(id))
  );
}

/** Die `sessionIds` aus CalendarSyncIssue.detailsJson — defensiv gelesen. */
export function sessionIdsFromIssueDetails(details: unknown): string[] {
  if (!details || typeof details !== "object") return [];
  const raw = (details as Record<string, unknown>).sessionIds;
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

/**
 * Meldetext fuer die gesperrte Auslieferung.
 *
 * Nennt die Befunde beim Namen und den Weg heraus — eine Sperre, die nur
 * "blockiert" sagt, laedt dazu ein, sie zu umgehen.
 */
export function preflightBlockMessage(
  issues: readonly PreflightIssue[],
  periodLabel: string
): string {
  const liste = issues.map((i) => `• ${i.title}`).join("\n");
  return (
    `Auslieferung gestoppt: ${issues.length} offene${issues.length === 1 ? "r" : ""} ` +
    `Kalender-Befund${issues.length === 1 ? "" : "e"} betrifft die Lektionen dieser Rechnung ` +
    `(${periodLabel}).\n${liste}\n` +
    // Bewusst ohne Aufzaehlung der Knoepfe: je nach Befundart sind es andere
    // (eine Absage wird storniert, eine Doppelbelegung im Kalender behoben).
    // Eine Liste hier waere fuer die Haelfte der Faelle falsch.
    `Bitte unter "Kalender prüfen" entscheiden — dort steht zu jedem Befund, was ` +
    `er bedeutet und welche Antworten es gibt. Danach kann die Rechnung raus.`
  );
}

/** Hinweis fuer den Entwurf: er darf entstehen, soll aber nicht unbemerkt bleiben. */
export function preflightWarningMessage(
  issues: readonly PreflightIssue[],
  periodLabel: string
): string {
  const liste = issues.map((i) => i.title).join(" · ");
  return (
    `Achtung: ${issues.length} offene${issues.length === 1 ? "r" : ""} ` +
    `Kalender-Befund${issues.length === 1 ? "" : "e"} betrifft ${periodLabel} — ` +
    `${liste}. Der Entwurf ist erstellt, versendet werden kann er erst nach der ` +
    `Entscheidung unter "Kalender prüfen".`
  );
}
