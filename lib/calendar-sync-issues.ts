/**
 * Nicht zugeordnete Kalendereintraege: was der Sync mit einem Befund tun soll.
 *
 * Rein, ohne DB — die IO-Seite liegt in app/api/sync und app/api/calendar-issues.
 * Erkannt werden die Faelle weiterhin von lib/sync-unmatched; hier geht es nur
 * darum, ob ein bereits entschiedener Fall wieder auftauchen darf.
 *
 * Unterschied der beiden Entscheide, der nicht verwischt werden darf:
 *
 *   "Erledigt" (resolved) — das Problem wurde angeschaut und behoben, etwa der
 *     Kalendertitel korrigiert oder der Schueler angelegt. Aussage ueber den
 *     Zustand, nicht ueber den Termin. Aendert sich der Termin danach materiell,
 *     ist es ein neuer Zustand und der Fall darf wieder gemeldet werden.
 *
 *   "Ignorieren" (ignored) — dieser Kalendereintrag ist absichtlich keine
 *     Nachhilfestunde (Zahnarzt, Ferien, Geburtstag). Aussage ueber den Termin
 *     selbst. Sie gilt fuer diese Event-ID dauerhaft; auch eine Verschiebung oder
 *     Umbenennung macht aus einem Zahnarzttermin keine Lektion.
 */

import type { CancellationIssueType } from "@/lib/calendar-cancellation";
import type { IdentityIssueType } from "@/lib/calendar-identity";
import type { IntegrityFindingType } from "@/lib/calendar-integrity";
import type { SyncUnmatchedReason } from "@/lib/sync-unmatched";

export type CalendarIssueStatusValue = "open" | "resolved" | "ignored";

/**
 * Alle Befundarten, die im Band «Kalender prüfen» landen.
 *
 * Die Integritaetsbefunde teilen sich Speicher und Entscheid-Workflow mit den
 * nicht zugeordneten Terminen, folgen aber einem anderen Lebenszyklus: siehe
 * integrityIssueStatus in lib/calendar-integrity. Dasselbe gilt fuer
 * `identity_ambiguous`; `identity_conflict` ist dagegen ein Ereignis und laeuft
 * ueber reconcileObservedIssue wie ein nicht zugeordneter Termin.
 */
export type CalendarIssueReason =
  | SyncUnmatchedReason
  | IntegrityFindingType
  | IdentityIssueType
  | CancellationIssueType;

/** Ein in diesem Lauf beobachteter, nicht zuordenbarer Termin. */
export type ObservedCalendarIssue = {
  externalEventId: string;
  /** Googles `updated` — Versionsmarke des Termins; null wenn Google nichts liefert. */
  externalUpdatedAt: Date | null;
  reason: CalendarIssueReason;
};

/** Der gespeicherte Stand desselben Termins, falls es ihn schon gibt. */
export type StoredCalendarIssue = {
  externalUpdatedAt: Date | null;
  status: CalendarIssueStatusValue;
  reason: string;
};

export type IssueReconciliation = {
  status: CalendarIssueStatusValue;
  /** true = ein bereits erledigter Fall wird wieder geoeffnet. */
  reopened: boolean;
};

function sameVersion(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.getTime() === b.getTime();
}

/**
 * Materiell geaendert = Google meldet eine andere Version des Termins, oder der
 * Grund der Nichtzuordnung ist ein anderer geworden (aus "kein Treffer" wurde
 * "mehrdeutig" — ein anderes Problem, auch wenn der Termin derselbe ist).
 */
export function hasMateriallyChanged(
  stored: StoredCalendarIssue,
  observed: ObservedCalendarIssue
): boolean {
  return !sameVersion(stored.externalUpdatedAt, observed.externalUpdatedAt) ||
    stored.reason !== observed.reason;
}

/** Welcher Status gilt nach diesem Sync-Lauf? */
export function reconcileObservedIssue(
  stored: StoredCalendarIssue | null,
  observed: ObservedCalendarIssue
): IssueReconciliation {
  if (!stored) return { status: "open", reopened: false };

  // Absichtlich kein Schuelertermin — bleibt weg, egal was sich am Termin aendert.
  if (stored.status === "ignored") return { status: "ignored", reopened: false };

  if (stored.status === "resolved") {
    return hasMateriallyChanged(stored, observed)
      ? { status: "open", reopened: true }
      : { status: "resolved", reopened: false };
  }

  return { status: "open", reopened: false };
}

/**
 * Offene Faelle, deren Termin in diesem Lauf zugeordnet werden konnte.
 *
 * Der Nutzer hat den Titel korrigiert und der Sync hat die Lektion angelegt —
 * der Befund ist damit erledigt, ohne dass jemand klicken muss. Bewusst nur fuer
 * Termine, die in DIESEM Lauf tatsaechlich gematcht haben: "nicht im Sync-Fenster
 * gesehen" ist kein Nachweis, dass das Problem weg ist.
 */
export function autoResolvedIssueEventIds(
  openIssueEventIds: readonly string[],
  matchedEventIds: ReadonlySet<string>
): string[] {
  return openIssueEventIds.filter((id) => matchedEventIds.has(id));
}

/** Google liefert `updated` als RFC3339-String; unbrauchbare Werte gelten als "keine Version". */
export function parseExternalUpdatedAt(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}
