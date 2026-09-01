/**
 * Kalender-Identitaetswechsel — dieselbe Lektion, neue Google-Event-ID.
 *
 * Stage 1 (lib/calendar-integrity) erkennt den Schaden, nachdem er entstanden
 * ist: die alte Zeile bleibt als Waise liegen, die neue kommt daneben, beide
 * werden fakturiert. Dieses Modul verhindert die zweite Zeile.
 *
 * Der Ausloeser ist immer derselbe: Google vergibt eine neue ID, ohne dass sich
 * am Termin etwas geaendert haette — ein Einzeltermin wird zur Serie, eine Serie
 * wird geloescht und neu angelegt, ein Termin wandert in einen anderen Kalender.
 * Der Sync erkennt eine Lektion nur an `calEventId`, findet nichts und legt an.
 *
 * Wiedererkannt wird ausschliesslich ueber einen EXAKTEN Zusammenfall:
 * derselbe Schueler, dieselbe Startzeit auf die Millisekunde, und die alte ID
 * ist im gesamten Sync-Fenster nicht mehr vorhanden. Alles andere waere geraten.
 *
 * Bewusst NICHT erkannt (und das ist die wichtigere Haelfte):
 *   — verschobene Lektionen. Alte Zeile 15:00, neuer Termin 16:00 desselben
 *     Schuelers: das kann eine Verschiebung sein oder eine Absage plus eine
 *     Zusatzstunde. Wer hier zusammenlegt, verliert im zweiten Fall eine
 *     bezahlte Lektion. Die alte Zeile bleibt Waise und wird gemeldet.
 *   — Faelle mit mehr als einem Kandidaten. Kein automatischer Zusammenschluss,
 *     stattdessen ein Befund im Band "Kalender pruefen".
 *   — Faelle, in denen die alte ID noch existiert. Dann sind es zwei echte
 *     Kalendertermine, auch wenn sie zur selben Zeit stehen.
 *
 * Rein, ohne Datenbank: dieses Modul entscheidet, es schreibt nicht.
 */

/** Q1-Importe hatten nie einen Google-Termin — sie sind nie Ersatzkandidat. */
const MANUAL_PREFIX = "manual-";

const roundCents = (n: number) => Math.round(n * 100) / 100;

export const IDENTITY_REASONS = ["identity_ambiguous", "identity_conflict"] as const;
export type IdentityIssueType = (typeof IDENTITY_REASONS)[number];

export function isIdentityReason(reason: string): reason is IdentityIssueType {
  return (IDENTITY_REASONS as readonly string[]).includes(reason);
}

/** Die Felder einer bestehenden Lektion, die fuer den Abgleich reichen. */
export type IdentityCandidate = {
  id: string;
  studentId: string;
  date: Date;
  durationMin: number;
  amountCHF: number;
  calEventId: string | null;
};

export type IdentityResolution =
  /** Die Event-ID gehoert bereits zu einer Lektion — normaler Upsert, nichts zu tun. */
  | { kind: "linked"; sessionId: string }
  /** Kein Kandidat: heutiges Verhalten, eine neue Lektion entsteht. */
  | { kind: "new" }
  /** Genau ein Kandidat: dieselbe Lektion, nur mit neuer Kalender-ID. */
  | { kind: "replace"; session: IdentityCandidate; staleCalEventId: string }
  /** Mehrere Kandidaten: nicht raten, nicht zusammenlegen — melden. */
  | { kind: "ambiguous"; sessions: IdentityCandidate[] };

/**
 * Gehoert dieser neue Kalendertermin zu einer Lektion, die es schon gibt?
 *
 * `googleEventIds` muss der VOLLSTAENDIGE Satz aller im Sync-Fenster gelieferten
 * Event-IDs sein — auch der nicht zugeordneten. Sonst gilt ein Termin, dessen
 * Titel gerade nicht passt, faelschlich als verschwunden, und seine Lektion
 * wuerde an einen fremden Termin gehaengt.
 *
 * `claimedSessionIds` sind Lektionen, die in DIESEM Lauf bereits einem anderen
 * neuen Termin zugeordnet wurden. Ohne diese Sperre koennten zwei neue Termine
 * dieselbe Zeile beanspruchen — die zweite Zuordnung wuerde die erste
 * ueberschreiben und eine echte Lektion verschwinden lassen.
 */
export function resolveCalendarIdentity(args: {
  calEventId: string;
  studentId: string;
  start: Date;
  /** Bestehende Lektionen des Monats. */
  sessions: readonly IdentityCandidate[];
  googleEventIds: ReadonlySet<string>;
  claimedSessionIds?: ReadonlySet<string>;
}): IdentityResolution {
  const { calEventId, studentId, start, sessions, googleEventIds } = args;
  const claimed = args.claimedSessionIds ?? new Set<string>();

  const already = sessions.find((s) => s.calEventId === calEventId);
  if (already) return { kind: "linked", sessionId: already.id };

  const candidates = sessions.filter((s) => {
    if (s.studentId !== studentId) return false;
    if (s.date.getTime() !== start.getTime()) return false;
    if (!s.calEventId) return false;
    if (s.calEventId.startsWith(MANUAL_PREFIX)) return false;
    // Die alte ID existiert noch → zwei echte Termine, keine Ersetzung.
    if (googleEventIds.has(s.calEventId)) return false;
    if (claimed.has(s.id)) return false;
    return true;
  });

  if (candidates.length === 0) return { kind: "new" };
  if (candidates.length === 1) {
    return {
      kind: "replace",
      session: candidates[0],
      staleCalEventId: candidates[0].calEventId as string,
    };
  }
  return { kind: "ambiguous", sessions: candidates };
}

export type PreservedField = {
  field: "durationMin" | "amountCHF";
  historic: number;
  incoming: number;
};

export type IdentityReplacementPlan = {
  /**
   * Duerfen Dauer, Betrag, Datum, Schueler und Notiz mitgezogen werden?
   *
   * Im nicht ausgelieferten Monat ja: die Ersetzung soll sich verhalten, als
   * haette Google die alte ID behalten. Im ausgelieferten Monat nein.
   */
  updateEditableFields: boolean;
  /**
   * Felder, deren historischer Wert vom eingehenden Termin abweicht und die
   * deshalb NICHT geschrieben werden. Leer = die Ersetzung ist deckungsgleich.
   */
  preserved: PreservedField[];
};

/**
 * Was darf eine Identitaetsersetzung anfassen?
 *
 * Die technische Verknuepfung (`calEventId`) wird immer repariert — ohne sie
 * bliebe die Lektion fuer immer eine Waise und liefe bei jedem Sync erneut als
 * Loeschkandidat mit. Sie traegt keine finanzielle Aussage.
 *
 * Die finanzielle Bedeutung dagegen ist im ausgelieferten Monat unveraenderlich.
 * Steht Luca mit 60 Minuten zu CHF 90 auf einer versandten Rechnung und liefert
 * Google jetzt 50 Minuten, dann ist das PDF beim Kunden trotzdem ueber 90 —
 * eine spaetere Kalenderfassung darf die Finanzgeschichte nicht umschreiben.
 * Die Abweichung wird gemeldet, nicht geschrieben; korrigiert wird ueber eine
 * Neuausstellung.
 */
export function identityReplacementPlan(args: {
  existing: { durationMin: number; amountCHF: number };
  incoming: { durationMin: number; amountCHF: number };
  monthDelivered: boolean;
}): IdentityReplacementPlan {
  if (!args.monthDelivered) return { updateEditableFields: true, preserved: [] };

  const preserved: PreservedField[] = [];
  if (args.existing.durationMin !== args.incoming.durationMin) {
    preserved.push({
      field: "durationMin",
      historic: args.existing.durationMin,
      incoming: args.incoming.durationMin,
    });
  }
  if (roundCents(args.existing.amountCHF) !== roundCents(args.incoming.amountCHF)) {
    preserved.push({
      field: "amountCHF",
      historic: roundCents(args.existing.amountCHF),
      incoming: roundCents(args.incoming.amountCHF),
    });
  }
  return { updateEditableFields: false, preserved };
}

const dateLabel = (d: Date) =>
  d.toLocaleDateString("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

/** Stabiler Schluessel — wird zu CalendarSyncIssue.externalEventId. */
export function identityIssueKey(type: IdentityIssueType, ref: string): string {
  return `${type}:${ref}`;
}

export function describeAmbiguousIdentity(
  studentName: string,
  start: Date,
  count: number
): string {
  return `${studentName} — neuer Kalendertermin am ${dateLabel(start)}: ${count} Lektionen kommen als dieselbe in Frage`;
}

export function describeIdentityConflict(
  studentName: string,
  start: Date,
  preserved: readonly PreservedField[]
): string {
  const felder = preserved
    .map((p) =>
      p.field === "durationMin"
        ? `Dauer ${p.historic} statt ${p.incoming} Min.`
        : `Betrag CHF ${p.historic.toFixed(2)} statt CHF ${p.incoming.toFixed(2)}`
    )
    .join(", ");
  return `${studentName} — Kalendertermin vom ${dateLabel(start)} neu verknüpft, Rechnung bleibt wie ausgeliefert (${felder})`;
}
