/**
 * Vergleich eines eingefrorenen Rechnungsstands (Snapshot) mit dem heutigen Stand.
 *
 * Reine Logik, kein DB-Zugriff — die IO-Seite liegt in lib/invoice-change-detection.ts.
 * Erkennen und sichtbar machen, mehr nicht: hier wird nichts neu berechnet und keine
 * Revision vorgeschlagen. Die Entscheidung trifft der Nutzer (P7).
 */

export type InvoiceChangeType =
  | "session_removed"
  | "session_added"
  | "session_date_changed"
  | "session_duration_changed"
  | "session_amount_changed"
  | "session_rate_changed"
  | "session_student_changed"
  | "session_moved_to_other_month"
  | "billing_status_changed"
  | "subscription_changed";

export type InvoiceChange = {
  type: InvoiceChangeType;
  /** Betroffene Session-IDs; leer bei Abo-/Status-Änderungen ohne Session-Bezug. */
  sessionIds: string[];
  before: string | null;
  after: string | null;
  /** Lesbare Beschreibung für das Change Log und die Anzeige. */
  detail: string;
};

/** Ein Snapshot-Eintrag, so wie er eingefroren wurde. */
export type DiffSnapshotSession = {
  id: string;
  studentId: string;
  /** ISO-String aus dem Snapshot. */
  date: string;
  durationMin: number;
  amountCHF: number;
};

/** Der heutige Zustand einer Session — unabhängig davon, ob sie noch zur Rechnung zählt. */
export type DiffLiveSession = {
  id: string;
  studentId: string;
  date: Date;
  durationMin: number;
  amountCHF: number;
  year: number;
  month: number;
};

export type DiffSubscriptionLine = { id: string; description: string; amountCHF: number };

export type DiffInput = {
  /** Jahr/Monat der Rechnung — Referenz für "in anderen Monat verschoben". */
  year: number;
  month: number;
  /** Sessions laut Snapshot. */
  snapshotSessions: DiffSnapshotSession[];
  /** Session-IDs laut Snapshot, auch solche ohne auffindbare Session. */
  snapshotSessionIds: string[];
  snapshotSubscriptionLines: DiffSubscriptionLine[];
  snapshotTotalCHF: number;
  /**
   * Heutiger Zustand ALLER Snapshot-Sessions, per ID nachgeschlagen — ohne Filter
   * auf Monat oder Schüler. Nur so lässt sich "gelöscht" von "verschoben" und
   * "anderem Schüler zugeordnet" unterscheiden.
   */
  liveSessionsById: Map<string, DiffLiveSession>;
  /**
   * Sessions, die heute auf dieser Rechnung stehen würden (Abrechnungsgruppe,
   * Monat). null, wenn die Rechnung heute gar nicht mehr berechenbar ist —
   * z. B. weil der Schüler inzwischen über eine Familienrechnung läuft.
   */
  liveInvoiceSessions: DiffLiveSession[] | null;
  liveSubscriptionLines: DiffSubscriptionLine[];
  liveTotalCHF: number | null;
  /** Grund, falls die Rechnung heute nicht mehr berechenbar ist. */
  unbillableReason?: string | null;
};

export type InvoiceDiff = {
  changes: InvoiceChange[];
  totalBeforeCHF: number;
  totalAfterCHF: number | null;
  /** Stabiler Fingerabdruck der Abweichung — verhindert doppelte Log-Einträge bei jedem Sync. */
  fingerprint: string;
};

const CENT = 0.005;
const money = (n: number) => `CHF ${n.toFixed(2)}`;
const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
/** CHF pro Minute, auf Rappen-Ebene vergleichbar gemacht. */
const rateOf = (amountCHF: number, durationMin: number) =>
  durationMin > 0 ? amountCHF / durationMin : 0;

export function diffInvoiceAgainstLive(input: DiffInput): InvoiceDiff {
  const changes: InvoiceChange[] = [];
  const {
    year,
    month,
    snapshotSessions,
    snapshotSessionIds,
    liveSessionsById,
    liveInvoiceSessions,
    snapshotSubscriptionLines,
    liveSubscriptionLines,
    snapshotTotalCHF,
    liveTotalCHF,
  } = input;

  const push = (
    type: InvoiceChangeType,
    sessionIds: string[],
    before: string | null,
    after: string | null,
    detail: string
  ) => changes.push({ type, sessionIds, before, after, detail });

  const snapshotById = new Map(snapshotSessions.map((s) => [s.id, s]));
  // Session-IDs aus dem Snapshot, zu denen schon beim Einfrieren keine Session mehr
  // existierte, sind kein neuer Befund — sie standen bereits als fehlend im Snapshot.
  const knownIds = new Set(snapshotSessions.map((s) => s.id));

  for (const id of snapshotSessionIds) {
    const snap = snapshotById.get(id);
    if (!snap) continue;
    const live = liveSessionsById.get(id);

    if (!live) {
      push(
        "session_removed",
        [id],
        `${day(snap.date)}, ${snap.durationMin} Min, ${money(snap.amountCHF)}`,
        null,
        `Lektion vom ${day(snap.date)} wurde gelöscht.`
      );
      continue;
    }

    // Zuordnung zu einem anderen Schüler — vor allen anderen Feldern prüfen, weil
    // dann auch Betrag und Tarif zu einem anderen Schüler gehören.
    if (live.studentId !== snap.studentId) {
      push(
        "session_student_changed",
        [id],
        snap.studentId,
        live.studentId,
        `Lektion vom ${day(snap.date)} ist jetzt einem anderen Schüler zugeordnet.`
      );
    }

    if (live.year !== year || live.month !== month) {
      push(
        "session_moved_to_other_month",
        [id],
        `${year}-${String(month).padStart(2, "0")}`,
        `${live.year}-${String(live.month).padStart(2, "0")}`,
        `Lektion vom ${day(snap.date)} liegt jetzt im Monat ${live.month}/${live.year}.`
      );
    } else if (day(live.date) !== day(snap.date)) {
      // Datumswechsel innerhalb des Monats; ein Monatswechsel ist oben schon erfasst.
      push(
        "session_date_changed",
        [id],
        day(snap.date),
        day(live.date),
        `Lektion verschoben: ${day(snap.date)} → ${day(live.date)}.`
      );
    }

    if (live.durationMin !== snap.durationMin) {
      push(
        "session_duration_changed",
        [id],
        `${snap.durationMin} Min`,
        `${live.durationMin} Min`,
        `Dauer der Lektion vom ${day(snap.date)}: ${snap.durationMin} → ${live.durationMin} Min.`
      );
    }

    const rateBefore = rateOf(snap.amountCHF, snap.durationMin);
    const rateAfter = rateOf(live.amountCHF, live.durationMin);
    // Tarifwechsel getrennt vom Betrag: eine reine Dauer-Änderung verschiebt den
    // Betrag, ohne dass der Ansatz pro Minute sich ändert.
    if (Math.abs(rateBefore - rateAfter) > 0.0001) {
      push(
        "session_rate_changed",
        [id],
        `${rateBefore.toFixed(2)} CHF/Min`,
        `${rateAfter.toFixed(2)} CHF/Min`,
        `Tarif der Lektion vom ${day(snap.date)}: ${rateBefore.toFixed(2)} → ${rateAfter.toFixed(2)} CHF/Min.`
      );
    }

    if (Math.abs(live.amountCHF - snap.amountCHF) > CENT) {
      push(
        "session_amount_changed",
        [id],
        money(snap.amountCHF),
        money(live.amountCHF),
        `Betrag der Lektion vom ${day(snap.date)}: ${money(snap.amountCHF)} → ${money(live.amountCHF)}.`
      );
    }
  }

  if (liveInvoiceSessions === null) {
    // Die Rechnung ist heute nicht mehr berechenbar (z. B. Schüler läuft jetzt über
    // eine Familienrechnung). Das ist die stärkste Form von "Status geändert".
    push(
      "billing_status_changed",
      [],
      "abrechenbar",
      "nicht mehr abrechenbar",
      input.unbillableReason ?? "Diese Rechnung ist nicht mehr eigenständig abrechenbar."
    );
  } else {
    const liveIds = new Set(liveInvoiceSessions.map((s) => s.id));

    for (const live of liveInvoiceSessions) {
      if (knownIds.has(live.id)) continue;
      push(
        "session_added",
        [live.id],
        null,
        `${day(live.date)}, ${live.durationMin} Min, ${money(live.amountCHF)}`,
        `Neue Lektion vom ${day(live.date)} zählt jetzt zu diesem Monat.`
      );
    }

    // Session existiert noch, liegt im Monat, gehört aber nicht mehr zu dieser
    // Rechnung — etwa weil die Familienverknüpfung des Schülers geändert wurde.
    for (const snap of snapshotSessions) {
      const live = liveSessionsById.get(snap.id);
      if (!live || liveIds.has(snap.id)) continue;
      if (live.year !== year || live.month !== month) continue;
      if (live.studentId !== snap.studentId) continue;
      push(
        "billing_status_changed",
        [snap.id],
        "auf dieser Rechnung",
        "nicht mehr auf dieser Rechnung",
        `Lektion vom ${day(snap.date)} zählt nicht mehr zu dieser Rechnung (Abrechnungszuordnung geändert).`
      );
    }
  }

  const subsBefore = new Map(snapshotSubscriptionLines.map((l) => [l.id, l]));
  const subsAfter = new Map(liveSubscriptionLines.map((l) => [l.id, l]));
  for (const [id, before] of Array.from(subsBefore.entries())) {
    const after = subsAfter.get(id);
    if (!after) {
      push("subscription_changed", [], `${before.description}: ${money(before.amountCHF)}`, null,
        `Abo-Position entfallen: ${before.description}.`);
    } else if (Math.abs(after.amountCHF - before.amountCHF) > CENT) {
      push("subscription_changed", [], money(before.amountCHF), money(after.amountCHF),
        `Abo-Betrag geändert: ${before.description} ${money(before.amountCHF)} → ${money(after.amountCHF)}.`);
    }
  }
  for (const [id, after] of Array.from(subsAfter.entries())) {
    if (subsBefore.has(id)) continue;
    push("subscription_changed", [], null, `${after.description}: ${money(after.amountCHF)}`,
      `Neue Abo-Position: ${after.description}.`);
  }

  return {
    changes,
    totalBeforeCHF: snapshotTotalCHF,
    totalAfterCHF: liveTotalCHF,
    fingerprint: buildFingerprint(changes),
  };
}

/**
 * Fingerabdruck über Art und betroffene Sessions inkl. der konkreten Werte.
 * Gleicht sich der Kalender wieder an, ändert sich der Fingerabdruck — nur so
 * bleibt ein zweiter Log-Eintrag aus, solange die Abweichung dieselbe ist.
 */
export function buildFingerprint(changes: InvoiceChange[]): string {
  return changes
    .map((c) => `${c.type}:${[...c.sessionIds].sort().join("+")}:${c.before ?? ""}>${c.after ?? ""}`)
    .sort()
    .join("|");
}
