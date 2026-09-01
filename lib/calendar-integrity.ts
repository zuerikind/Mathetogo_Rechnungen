/**
 * Integritaetspruefung Kalender ↔ Lektionen — reine Erkennung, kein Eingriff.
 *
 * Dreimal ist dasselbe passiert (Leo, Elenor, Luca): ein Kalendertermin bekam
 * eine neue Event-ID — Einzeltermin wurde Serie, oder der Termin wurde geloescht
 * und neu angelegt. Der Sync erkennt eine Lektion nur an `calEventId`, fand also
 * nichts und legte eine ZWEITE Zeile an. Die alte blieb liegen und wurde
 * mitfakturiert.
 *
 * Keine der bestehenden Sicherungen konnte das melden:
 *   — die Waisen-Erkennung laeuft nur mit pruneOrphans und nimmt ausgelieferte
 *     Monate aus (dort darf nichts geloescht werden — zu Recht),
 *   — `events.get(<Serien-Master>)` antwortet "confirmed", der Fall galt also
 *     nicht einmal als geloescht,
 *   — die Abweichungserkennung sieht nur, was sich NACH dem Einfrieren aendert;
 *     bei Leo und Elenor stand das Duplikat schon im Snapshot.
 *
 * Deshalb hier die Trennung, die gefehlt hat: **Erkennung ist unabhaengig von
 * Mutation.** Ausgelieferte Monate bleiben unantastbar, werden aber geprueft.
 * Dieses Modul kennt keine Datenbank und loescht nichts — es beschreibt nur,
 * was nicht zusammenpasst.
 */

export type IntegrityFindingType = "session_orphan" | "duplicate_slot";

/** Zum Filtern gespeicherter Befunde — dieselben Werte wie IntegrityFindingType. */
export const INTEGRITY_REASONS: IntegrityFindingType[] = ["session_orphan", "duplicate_slot"];

export function isIntegrityReason(reason: string): reason is IntegrityFindingType {
  return (INTEGRITY_REASONS as string[]).includes(reason);
}

/** Die Felder einer Lektion, die fuer die Pruefung reichen. */
export type IntegritySession = {
  id: string;
  studentId: string;
  studentName: string;
  date: Date;
  durationMin: number;
  amountCHF: number;
  calEventId: string | null;
};

export type IntegrityFinding = {
  type: IntegrityFindingType;
  /** Stabiler Schluessel; wird zu CalendarSyncIssue.externalEventId. */
  key: string;
  studentId: string;
  studentName: string;
  startAt: Date;
  /** Betroffene Lektionen — bei einer Doppelbelegung alle des Zeitpunkts. */
  sessionIds: string[];
  /**
   * Was fuer diesen Befund insgesamt verrechnet ist.
   *
   * Bewusst die Summe und nicht "der Betrag zu viel": welche der doppelten
   * Zeilen die richtige ist, entscheidet der Mensch — eine Sortierung nach ID
   * waere geraten, und geraten wird hier nicht.
   */
  amountCHF: number;
  /** Dauer und Betrag je betroffener Lektion, in derselben Reihenfolge wie sessionIds. */
  parts: { durationMin: number; amountCHF: number }[];
  /** Steht fuer diesen Monat eine ausgelieferte Rechnung? Nur Kennzeichnung. */
  monthDelivered: boolean;
  /** Alte Kalender-ID — nur zur Fehlersuche, nicht fuer die normale Anzeige. */
  staleCalEventId: string | null;
};

/** Q1-Importe haben nie einen Google-Termin und sind deshalb keine Waisen. */
const MANUAL_PREFIX = "manual-";

const roundCents = (n: number) => Math.round(n * 100) / 100;

function slotKey(studentId: string, date: Date): string {
  return `${studentId}|${date.getTime()}`;
}

/**
 * Lektionen, zu denen es im Sync-Fenster keinen Kalendertermin mehr gibt.
 *
 * Bewusst ohne Ruecksicht darauf, ob der Monat ausgeliefert ist: geloescht wird
 * hier nichts, gemeldet schon. Genau dieser Fall — alte Zeile bleibt, neue kommt
 * dazu — hat Leo, Elenor und Luca je 78.00, 78.00 und 15.00 zu viel berechnet.
 *
 * Faengt auch den heikelsten Fall: wird ein Termin VERSCHOBEN und neu angelegt,
 * bleibt die Waise an einem anderen Datum liegen. Dann gibt es keine doppelte
 * Startzeit, und nur diese Pruefung sieht sie noch.
 */
export function findOrphanSessions(
  sessions: readonly IntegritySession[],
  googleEventIds: ReadonlySet<string>
): IntegritySession[] {
  return sessions.filter((s) => {
    if (!s.calEventId) return false;
    if (s.calEventId.startsWith(MANUAL_PREFIX)) return false;
    return !googleEventIds.has(s.calEventId);
  });
}

/**
 * Mehr als eine Lektion desselben Schuelers zur exakt selben Startzeit.
 *
 * Niemand hat zweimal gleichzeitig Unterricht — eine solche Gruppe ist immer ein
 * Fehler, unabhaengig davon, woher die Zeilen stammen.
 */
export function findDuplicateSlots(
  sessions: readonly IntegritySession[]
): IntegritySession[][] {
  const groups = new Map<string, IntegritySession[]>();
  for (const s of sessions) {
    const key = slotKey(s.studentId, s.date);
    const group = groups.get(key);
    if (group) group.push(s);
    else groups.set(key, [s]);
  }
  return Array.from(groups.values())
    .filter((group) => group.length > 1)
    .map((group) => [...group].sort((a, b) => a.id.localeCompare(b.id)));
}

/**
 * Beide Pruefungen als Befundliste.
 *
 * Eine Zeile kann in beiden auftauchen (Leo: die alte Zeile ist Waise UND
 * verdoppelt den Slot). Das bleibt bewusst so: die eine Meldung sagt "diese
 * Lektion hat keinen Termin mehr", die andere "hier wird doppelt verrechnet" —
 * zwei verschiedene Fragen an den Nutzer.
 */
export function findCalendarIntegrityIssues(input: {
  sessions: readonly IntegritySession[];
  googleEventIds: ReadonlySet<string>;
  /** Schueler, deren Monatsrechnung ausgeliefert ist — nur fuer das Kennzeichen. */
  deliveredStudentIds?: ReadonlySet<string>;
}): IntegrityFinding[] {
  const { sessions, googleEventIds } = input;
  const delivered = input.deliveredStudentIds ?? new Set<string>();
  const findings: IntegrityFinding[] = [];

  for (const s of findOrphanSessions(sessions, googleEventIds)) {
    findings.push({
      type: "session_orphan",
      key: `orphan:${s.calEventId}`,
      studentId: s.studentId,
      studentName: s.studentName,
      startAt: s.date,
      sessionIds: [s.id],
      amountCHF: roundCents(s.amountCHF),
      parts: [{ durationMin: s.durationMin, amountCHF: roundCents(s.amountCHF) }],
      monthDelivered: delivered.has(s.studentId),
      staleCalEventId: s.calEventId,
    });
  }

  for (const group of findDuplicateSlots(sessions)) {
    const first = group[0];
    findings.push({
      type: "duplicate_slot",
      key: `dup:${first.studentId}:${first.date.toISOString()}`,
      studentId: first.studentId,
      studentName: first.studentName,
      startAt: first.date,
      sessionIds: group.map((s) => s.id),
      amountCHF: roundCents(group.reduce((sum, s) => sum + s.amountCHF, 0)),
      parts: group.map((s) => ({
        durationMin: s.durationMin,
        amountCHF: roundCents(s.amountCHF),
      })),
      monthDelivered: delivered.has(first.studentId),
      staleCalEventId: null,
    });
  }

  return findings.sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime() || a.key.localeCompare(b.key)
  );
}

/**
 * Ein Integritaetsbefund ist ein ZUSTAND, kein Ereignis.
 *
 * Deshalb anders als bei nicht zugeordneten Terminen: solange der Befund besteht,
 * bleibt er offen — ein voreiliges "Erledigt" darf ihn nicht dauerhaft
 * verstecken, sonst waere die Blindheit zurueck, die das alles verursacht hat.
 * "Ignorieren" bleibt bestehen: das ist die ausdrueckliche Aussage "so gewollt".
 */
export function integrityIssueStatus(
  storedStatus: "open" | "resolved" | "ignored" | null
): "open" | "ignored" {
  return storedStatus === "ignored" ? "ignored" : "open";
}

/** Offene Befunde, die es nicht mehr gibt — sie werden automatisch erledigt. */
export function integrityIssuesToClose(
  openKeys: readonly string[],
  currentKeys: ReadonlySet<string>
): string[] {
  return openKeys.filter((key) => !currentKeys.has(key));
}

/** Kurzer Titel fuer die Uebersicht — ohne rohe IDs. */
export function describeIntegrityFinding(finding: IntegrityFinding): string {
  const when = finding.startAt.toLocaleDateString("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return finding.type === "session_orphan"
    ? `${finding.studentName} — Lektion vom ${when} hat keinen Kalendertermin mehr`
    : `${finding.studentName} — zwei Lektionen am ${when} zur selben Zeit`;
}
