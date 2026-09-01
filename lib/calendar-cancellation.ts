/**
 * Wann darf der Sync eine Lektion von selbst absagen — und wann nie?
 *
 * Eine normale Absage im Kalender soll niemanden mehr beschaeftigen. Bisher
 * endete sie in einer Loeschvormerkung, die jemand von Hand bestaetigen musste;
 * bei elf Vormerkungen in einem Monat ist das keine Kontrolle mehr, sondern
 * Wegklicken. Also entscheidet der Sync selbst — aber nur dort, wo ein Irrtum
 * folgenlos bleibt.
 *
 * Drei Dinge machen das vertretbar:
 *
 *   1. Der Storno ist WEICH. Die Zeile bleibt vollstaendig stehen, sie faellt
 *      nur aus den Geldabfragen. Nichts wird geloescht, nichts ist verloren.
 *   2. Er ist UMKEHRBAR. Taucht der Termin wieder auf, hebt der naechste Sync
 *      den Storno von selbst auf.
 *   3. Er trifft NUR die Zukunft und nur Unfakturiertes. Was schon stattgefunden
 *      hat oder schon auf einer Rechnung steht, wird nie automatisch angefasst —
 *      dort entsteht ein blockierender Befund, und ein Mensch entscheidet.
 *
 * Zwei Beweislagen, sehr unterschiedlich stark:
 *
 *   "google_cancelled" — Google liefert den Termin ausdruecklich mit
 *     `status: "cancelled"` aus (`showDeleted: true`). Das ist eine Aussage
 *     ueber den Termin, kein Rueckschluss. Reicht allein.
 *
 *   "missing" — der Termin steht nicht in der Antwort. Das ist ein
 *     Rueckschluss, und er ist genau so viel wert wie die Vollstaendigkeit der
 *     Abfrage. Eine abgeschnittene Seitenkette, ein zu enges Zeitfenster, ein
 *     verschobener Termin: alles sieht identisch aus. Deshalb reicht Abwesenheit
 *     NIE allein — es braucht einen vollstaendigen Lauf UND eine Einzelabfrage,
 *     die die Loeschung bei Google bestaetigt.
 *
 * Rein, ohne Datenbank.
 */

/** Q1-Importe und handangelegte Lektionen haben keinen Google-Termin. */
const MANUAL_PREFIX = "manual-";

/**
 * Befundarten, die aus einer NICHT ausgefuehrten Automatik entstehen.
 *
 * Beide blockieren die Auslieferung: der Sync hat erkannt, dass sich etwas
 * geaendert hat, durfte es aber nicht anwenden. Genau dann darf keine Rechnung
 * rausgehen, bevor jemand hingeschaut hat.
 */
export const CANCELLATION_REASONS = [
  "cancel_needs_review",
  "reactivate_needs_review",
] as const;
export type CancellationIssueType = (typeof CANCELLATION_REASONS)[number];

export type CancellationEvidence = "google_cancelled" | "missing";

export type CancelReason = "google_cancelled" | "google_missing";

export type CancellationDecision =
  /** Automatisch soft-stornieren. */
  | { kind: "cancel"; reason: CancelReason }
  /**
   * Nicht anfassen, aber melden — der Befund blockiert die Auslieferung, bis
   * jemand entschieden hat.
   */
  | { kind: "review"; why: "past" | "billed" }
  /** Nichts tun, nichts melden. */
  | { kind: "skip"; why: "manual" | "already_cancelled" | "sync_incomplete" | "unconfirmed" };

export type CancellationSubject = {
  date: Date;
  calEventId: string | null;
  cancelledAt: Date | null;
};

export function isManualSession(calEventId: string | null): boolean {
  return calEventId === null || calEventId.startsWith(MANUAL_PREFIX);
}

/**
 * Darf diese Lektion automatisch abgesagt werden?
 *
 * Die Reihenfolge ist bewusst: die Ausschluesse kommen VOR der Beweiswuerdigung.
 * Eine bereits fakturierte Lektion wird nicht einmal dann angefasst, wenn Google
 * die Absage ausdruecklich meldet — dort ist das Dokument raus, und der
 * Sync korrigiert keine Rechnungen.
 */
export function decideCancellation(args: {
  session: CancellationSubject;
  evidence: CancellationEvidence;
  /** Steht der Monat dieses Schuelers auf einer ausgelieferten Rechnung? */
  billed: boolean;
  now: Date;
  /** Nur bei "missing": war die Kalenderabfrage nachweislich vollstaendig? */
  syncComplete?: boolean;
  /** Nur bei "missing": hat eine Einzelabfrage die Loeschung bestaetigt? */
  deletionConfirmed?: boolean;
}): CancellationDecision {
  const { session, evidence, billed, now } = args;

  if (session.cancelledAt) return { kind: "skip", why: "already_cancelled" };
  if (isManualSession(session.calEventId)) return { kind: "skip", why: "manual" };

  // Ausgeliefert schlaegt alles. Auch eine ausdrueckliche Google-Absage aendert
  // nichts an einer Rechnung, die beim Kunden liegt.
  if (billed) return { kind: "review", why: "billed" };
  // Vergangen: die Lektion hat stattgefunden oder eben nicht — das weiss der
  // Kalender von gestern nicht besser als der Mensch, der dabei war.
  if (session.date.getTime() <= now.getTime()) return { kind: "review", why: "past" };

  if (evidence === "google_cancelled") return { kind: "cancel", reason: "google_cancelled" };

  // Ab hier nur noch Abwesenheit — der schwache Beweis.
  if (args.syncComplete !== true) return { kind: "skip", why: "sync_incomplete" };
  if (args.deletionConfirmed !== true) return { kind: "skip", why: "unconfirmed" };
  return { kind: "cancel", reason: "google_missing" };
}

export type ReactivationDecision =
  | { kind: "reactivate" }
  | { kind: "review"; why: "past" | "billed" }
  | { kind: "skip"; why: "not_cancelled" };

/**
 * Der Termin ist wieder da — darf der Storno von selbst fallen?
 *
 * Nur in die Zukunft und nur unfakturiert. Damit gilt fuer die Reaktivierung
 * exakt derselbe Schnitt wie fuer die Stornierung, und das ist der Punkt: die
 * Automatik fasst genau den Bereich an, in dem ein Irrtum folgenlos bleibt.
 *
 * Eine vergangene Lektion faellt bewusst heraus, auch wenn sie noch auf keiner
 * Rechnung steht. Ob sie stattgefunden hat, weiss der Kalender von heute nicht
 * besser als der Mensch, der dabei war — und ein automatisch wieder
 * eingebuchter Betrag, den niemand angeordnet hat, ist genau die Art
 * Ueberraschung, die auf einer Rechnung nichts zu suchen hat. Sie wird
 * gemeldet, und der Entscheid ist ein Klick.
 */
export function decideReactivation(args: {
  session: { cancelledAt: Date | null; date: Date };
  billed: boolean;
  now: Date;
}): ReactivationDecision {
  if (!args.session.cancelledAt) return { kind: "skip", why: "not_cancelled" };
  // Ausgeliefert schlaegt alles: dort wuerde die Reaktivierung den Betrag gegen
  // den eingefrorenen Stand veraendern.
  if (args.billed) return { kind: "review", why: "billed" };
  if (args.session.date.getTime() <= args.now.getTime()) return { kind: "review", why: "past" };
  return { kind: "reactivate" };
}

/**
 * Prisma-Filter fuer "zaehlt zum Geld".
 *
 * Jede Abfrage, aus der ein Betrag entsteht, muss das mitfuehren — Rechnung,
 * Einkommensuebersicht, Auswertung, Monatsexport. Bewusst als eine Konstante:
 * die Varianten haben sich in diesem Projekt schon einmal auseinanderentwickelt
 * (siehe isDelivered in lib/invoice-delivery), und der Preis dafuer war hoch.
 */
export const ACTIVE_SESSION_WHERE = { cancelledAt: null } as const;

/** Spiegelt ACTIVE_SESSION_WHERE. */
export function isActiveSession(session: { cancelledAt: Date | null }): boolean {
  return session.cancelledAt === null;
}

/** Der Sync hat den Termin wieder gesehen: Vormerkung UND Storno fallen weg. */
export const CALENDAR_EVENT_ACTIVE_RESET = {
  cancelledAt: null,
  cancelReason: null,
} as const;

const dateLabel = (d: Date) =>
  d.toLocaleDateString("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

export function describeCancelReview(
  studentName: string,
  start: Date,
  why: "past" | "billed"
): string {
  return why === "billed"
    ? `${studentName} — Termin vom ${dateLabel(start)} im Kalender abgesagt, Rechnung ist aber schon ausgeliefert`
    : `${studentName} — Termin vom ${dateLabel(start)} im Kalender abgesagt, Lektion liegt in der Vergangenheit`;
}

export function describeReactivateReview(
  studentName: string,
  start: Date,
  why: "past" | "billed"
): string {
  return why === "billed"
    ? `${studentName} — Termin vom ${dateLabel(start)} ist wieder da, Rechnung ist aber schon ausgeliefert`
    : `${studentName} — Termin vom ${dateLabel(start)} ist wieder da, die Lektion liegt aber in der Vergangenheit`;
}
