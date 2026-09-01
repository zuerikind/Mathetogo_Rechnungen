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
  /** Googles stabile Termin-Identitaet, sofern beim letzten Sync mitgeschrieben. */
  iCalUID?: string | null;
  /** Googles originalStartTime der Serieninstanz. */
  originalStartAt?: Date | null;
};

/** Welche Regel hat die Lektion wiedererkannt? Nur fuer Meldung und Fehlersuche. */
export type IdentityVia = "calEventId" | "appSessionId" | "iCalUID" | "sameStart";

export type IdentityResolution =
  /** Die Event-ID gehoert bereits zu einer Lektion — normaler Upsert, nichts zu tun. */
  | { kind: "linked"; sessionId: string }
  /** Kein Kandidat: heutiges Verhalten, eine neue Lektion entsteht. */
  | { kind: "new" }
  /** Genau ein Kandidat: dieselbe Lektion, nur mit neuer Kalender-ID. */
  | { kind: "replace"; session: IdentityCandidate; staleCalEventId: string; via: IdentityVia }
  /** Mehrere Kandidaten: nicht raten, nicht zusammenlegen — melden. */
  | { kind: "ambiguous"; sessions: IdentityCandidate[]; via: IdentityVia };

/** Der eingehende Google-Termin, so weit er fuer die Identitaet zaehlt. */
export type IncomingCalendarEvent = {
  calEventId: string;
  studentId: string;
  start: Date;
  /** Googles iCalUID — stabil, wenn derselbe Termin eine neue ID bekommt. */
  iCalUID?: string | null;
  /** Serien-Master der Instanz. */
  recurringEventId?: string | null;
  /** Googles originalStartTime; fehlt bei Einzelterminen. */
  originalStartAt?: Date | null;
  /**
   * Unsere eigene Session-ID, falls der Termin sie traegt
   * (`extendedProperties.private.mathetogoSessionId`).
   *
   * Heute schreibt nichts diesen Wert nach Google — der Sync liest den Kalender,
   * er veraendert ihn nicht. Die Stufe ist trotzdem da und wird zuerst geprueft:
   * sie ist die einzige Zuordnung, die nicht aus Indizien schliesst, und sobald
   * irgendwann jemand die Eigenschaft setzt, gilt sie sofort.
   */
  appSessionId?: string | null;
};

const sameInstant = (a: Date | null | undefined, b: Date | null | undefined): boolean =>
  a != null && b != null && a.getTime() === b.getTime();

/**
 * Gehoert dieser Kalendertermin zu einer Lektion, die es schon gibt?
 *
 * Die Reihenfolge ist die Aussage. Sie geht von "sicher" nach "erschlossen",
 * und die erste Stufe, die greift, entscheidet:
 *
 *   a) calEventId ist bereits verknuepft   — kein Zweifel moeglich
 *   b) der Termin traegt unsere Session-ID — von uns selbst gesetzt
 *   c) iCalUID + urspruengliche Startzeit  — Googles eigene stabile Identitaet
 *   d) gleicher Schueler, exakt gleiche Startzeit, alte ID im Kalender weg
 *   e) sonst: mehrdeutig oder neu
 *
 * Stufe (c) faengt, was (d) nicht kann: eine VERSCHOBENE Serieninstanz. Wird der
 * Termin vom 18.09. 15:00 auf 16:00 gezogen, behaelt Google iCalUID und
 * originalStartTime — die Lektion wird wiedererkannt und mitverschoben, statt
 * als Waise liegenzubleiben und daneben neu zu entstehen. Ueber (d) allein waere
 * das nicht moeglich, und Raten ist dort zu Recht verboten.
 *
 * Fuer JEDE Stufe gilt dieselbe Sperre: ein Kandidat, dessen alte `calEventId`
 * noch im Kalender steht, wird nie beansprucht. Sonst wuerde eine lebende
 * Verknuepfung gestohlen und ein echter Termin verloere seine Lektion.
 *
 * `googleEventIds` muss der VOLLSTAENDIGE Satz aller im Sync-Fenster gelieferten
 * Event-IDs sein — auch der nicht zugeordneten. Sonst gilt ein Termin, dessen
 * Titel gerade nicht passt, faelschlich als verschwunden.
 *
 * `claimedSessionIds` sind Lektionen, die in DIESEM Lauf bereits einem anderen
 * Termin zugeordnet wurden. Ohne diese Sperre koennten zwei Termine dieselbe
 * Zeile beanspruchen — die zweite Zuordnung wuerde die erste ueberschreiben und
 * eine echte Lektion verschwinden lassen.
 */
export function resolveCalendarIdentity(args: {
  calEventId: string;
  studentId: string;
  start: Date;
  iCalUID?: string | null;
  recurringEventId?: string | null;
  originalStartAt?: Date | null;
  appSessionId?: string | null;
  /** Bestehende Lektionen des Monats. */
  sessions: readonly IdentityCandidate[];
  googleEventIds: ReadonlySet<string>;
  claimedSessionIds?: ReadonlySet<string>;
}): IdentityResolution {
  const { calEventId, studentId, start, sessions, googleEventIds } = args;
  const claimed = args.claimedSessionIds ?? new Set<string>();

  // (a) Bereits verknuepft.
  const already = sessions.find((s) => s.calEventId === calEventId);
  if (already) return { kind: "linked", sessionId: already.id };

  /** Darf diese Zeile ueberhaupt beansprucht werden? Gilt auf jeder Stufe. */
  const beanspruchbar = (s: IdentityCandidate): boolean => {
    if (claimed.has(s.id)) return false;
    if (!s.calEventId) return false;
    if (s.calEventId.startsWith(MANUAL_PREFIX)) return false;
    // Die alte ID steht noch im Kalender → lebende Verknuepfung, Finger weg.
    if (googleEventIds.has(s.calEventId)) return false;
    return true;
  };

  const entscheide = (
    kandidaten: IdentityCandidate[],
    via: IdentityVia
  ): IdentityResolution | null => {
    if (kandidaten.length === 0) return null;
    if (kandidaten.length === 1) {
      return {
        kind: "replace",
        session: kandidaten[0],
        staleCalEventId: kandidaten[0].calEventId as string,
        via,
      };
    }
    return { kind: "ambiguous", sessions: kandidaten, via };
  };

  // (b) Der Termin nennt unsere eigene Session-ID.
  if (args.appSessionId) {
    const treffer = sessions.filter((s) => s.id === args.appSessionId && beanspruchbar(s));
    const res = entscheide(treffer, "appSessionId");
    if (res) return res;
  }

  // (c) Googles stabile Identitaet: iCalUID + urspruengliche Startzeit.
  //
  // Die urspruengliche Startzeit ist der Anker der Instanz. Fehlt sie (echter
  // Einzeltermin), zaehlt die Startzeit selbst — dann ist iCalUID allein schon
  // eindeutig, weil ein Einzeltermin nur eine Instanz hat.
  if (args.iCalUID) {
    const ankerNeu = args.originalStartAt ?? start;
    const treffer = sessions.filter((s) => {
      if (s.iCalUID !== args.iCalUID) return false;
      if (!beanspruchbar(s)) return false;
      const ankerAlt = s.originalStartAt ?? s.date;
      return sameInstant(ankerAlt, ankerNeu);
    });
    const res = entscheide(treffer, "iCalUID");
    if (res) return res;
  }

  // (d) Gleicher Schueler, exakt gleiche Startzeit.
  const gleicheZeit = sessions.filter(
    (s) => s.studentId === studentId && s.date.getTime() === start.getTime() && beanspruchbar(s)
  );
  return entscheide(gleicheZeit, "sameStart") ?? { kind: "new" };
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
