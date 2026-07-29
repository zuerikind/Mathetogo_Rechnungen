import { describe, expect, it } from "vitest";
import {
  diffInvoiceAgainstLive,
  type DiffInput,
  type DiffLiveSession,
  type DiffSnapshotSession,
} from "./invoice-diff";

const YEAR = 2026;
const MONTH = 6;

const snap = (over: Partial<DiffSnapshotSession> = {}): DiffSnapshotSession => ({
  id: "x1",
  studentId: "s-liam",
  date: "2026-06-03T08:30:00.000Z",
  durationMin: 60,
  amountCHF: 60,
  ...over,
});

const live = (over: Partial<DiffLiveSession> = {}): DiffLiveSession => ({
  id: "x1",
  studentId: "s-liam",
  date: new Date("2026-06-03T08:30:00.000Z"),
  durationMin: 60,
  amountCHF: 60,
  year: YEAR,
  month: MONTH,
  ...over,
});

function input(over: Partial<DiffInput> = {}): DiffInput {
  const snapshotSessions = over.snapshotSessions ?? [snap()];
  const liveList = over.liveInvoiceSessions === undefined ? [live()] : over.liveInvoiceSessions;
  const byId =
    over.liveSessionsById ?? new Map((liveList ?? []).map((s) => [s.id, s]));
  return {
    year: YEAR,
    month: MONTH,
    snapshotSessions,
    snapshotSessionIds: over.snapshotSessionIds ?? snapshotSessions.map((s) => s.id),
    snapshotSubscriptionLines: over.snapshotSubscriptionLines ?? [],
    snapshotTotalCHF: over.snapshotTotalCHF ?? 60,
    liveSessionsById: byId,
    liveInvoiceSessions: liveList,
    liveSubscriptionLines: over.liveSubscriptionLines ?? [],
    // Nicht ?? — ein explizit übergebenes null bedeutet "nicht mehr berechenbar".
    liveTotalCHF: over.liveTotalCHF === undefined ? 60 : over.liveTotalCHF,
    unbillableReason: over.unbillableReason,
    calendarDeletedSessionIds: over.calendarDeletedSessionIds,
  };
}

const types = (d: { changes: { type: string }[] }) => d.changes.map((c) => c.type);

describe("diffInvoiceAgainstLive", () => {
  it("meldet nichts, wenn sich nichts geändert hat", () => {
    expect(diffInvoiceAgainstLive(input()).changes).toEqual([]);
  });

  it("erkennt eine gelöschte Lektion", () => {
    const d = diffInvoiceAgainstLive(
      input({ liveSessionsById: new Map(), liveInvoiceSessions: [] })
    );
    expect(types(d)).toEqual(["session_removed"]);
    expect(d.changes[0].sessionIds).toEqual(["x1"]);
  });

  it("erkennt eine im Kalender gelöschte Lektion, deren DB-Zeile der Guard behalten hat", () => {
    // Der H3-Guard bewahrt die Zeile in ausgelieferten Monaten. Ein reiner
    // DB-Vergleich sähe hier nichts — die Löschung kommt aus dem Kalenderstatus.
    const d = diffInvoiceAgainstLive(
      input({
        liveInvoiceSessions: [live()],
        liveSessionsById: new Map([["x1", live()]]),
        calendarDeletedSessionIds: new Set(["x1"]),
      })
    );
    expect(types(d)).toEqual(["session_removed"]);
    expect(d.changes[0].sessionIds).toEqual(["x1"]);
    expect(d.changes[0].detail).toContain("im Kalender gelöscht");
  });

  it("meldet nichts, wenn der Kalenderstatus unklar blieb", () => {
    // Nicht im Sync-Fenster gefunden ist kein Löschnachweis: dann steht die ID
    // nicht in calendarDeletedSessionIds und es darf kein Befund entstehen.
    const d = diffInvoiceAgainstLive(
      input({
        liveInvoiceSessions: [live()],
        liveSessionsById: new Map([["x1", live()]]),
        calendarDeletedSessionIds: new Set<string>(),
      })
    );
    expect(d.changes).toEqual([]);
  });

  it("erkennt eine neu hinzugekommene Lektion", () => {
    const neu = live({ id: "x2", date: new Date("2026-06-20T08:30:00.000Z") });
    const d = diffInvoiceAgainstLive(
      input({
        liveInvoiceSessions: [live(), neu],
        liveSessionsById: new Map([
          ["x1", live()],
          ["x2", neu],
        ]),
      })
    );
    expect(types(d)).toEqual(["session_added"]);
    expect(d.changes[0].sessionIds).toEqual(["x2"]);
  });

  it("erkennt eine Datumsverschiebung innerhalb des Monats", () => {
    const moved = live({ date: new Date("2026-06-11T08:30:00.000Z") });
    const d = diffInvoiceAgainstLive(
      input({ liveInvoiceSessions: [moved], liveSessionsById: new Map([["x1", moved]]) })
    );
    expect(types(d)).toEqual(["session_date_changed"]);
    expect(d.changes[0].before).toBe("2026-06-03");
    expect(d.changes[0].after).toBe("2026-06-11");
  });

  it("erkennt eine Lektion, die in einen anderen Monat verschoben wurde", () => {
    // Wandert aus dem Monat der Rechnung heraus: liegt nicht mehr auf der Rechnung,
    // existiert aber weiter — darf nicht als "gelöscht" durchgehen.
    const moved = live({ date: new Date("2026-07-03T08:30:00.000Z"), year: 2026, month: 7 });
    const d = diffInvoiceAgainstLive(
      input({ liveInvoiceSessions: [], liveSessionsById: new Map([["x1", moved]]) })
    );
    expect(types(d)).toEqual(["session_moved_to_other_month"]);
    expect(d.changes[0].before).toBe("2026-06");
    expect(d.changes[0].after).toBe("2026-07");
    expect(types(d)).not.toContain("session_removed");
  });

  it("erkennt eine geänderte Schülerzuordnung", () => {
    const reassigned = live({ studentId: "s-mila" });
    const d = diffInvoiceAgainstLive(
      input({
        liveInvoiceSessions: [reassigned],
        liveSessionsById: new Map([["x1", reassigned]]),
      })
    );
    expect(types(d)).toContain("session_student_changed");
    expect(d.changes[0].before).toBe("s-liam");
    expect(d.changes[0].after).toBe("s-mila");
  });

  it("trennt Dauer-Änderung von Tarif-Änderung", () => {
    // Doppelte Dauer zum gleichen Ansatz: Dauer und Betrag ändern sich, der Tarif nicht.
    const longer = live({ durationMin: 120, amountCHF: 120 });
    const d = diffInvoiceAgainstLive(
      input({ liveInvoiceSessions: [longer], liveSessionsById: new Map([["x1", longer]]) })
    );
    expect(types(d)).toEqual(["session_duration_changed", "session_amount_changed"]);
    expect(types(d)).not.toContain("session_rate_changed");
  });

  it("erkennt eine Tarifänderung bei gleicher Dauer", () => {
    const pricier = live({ amountCHF: 90 });
    const d = diffInvoiceAgainstLive(
      input({ liveInvoiceSessions: [pricier], liveSessionsById: new Map([["x1", pricier]]) })
    );
    expect(types(d)).toEqual(["session_rate_changed", "session_amount_changed"]);
  });

  it("erkennt, wenn eine Lektion nicht mehr zu dieser Rechnung zählt", () => {
    // Session existiert unverändert im Monat, steht aber nicht mehr auf der Rechnung
    // (z. B. Schüler wurde in eine andere Familienrechnung verlinkt).
    const d = diffInvoiceAgainstLive(
      input({ liveInvoiceSessions: [], liveSessionsById: new Map([["x1", live()]]) })
    );
    expect(types(d)).toEqual(["billing_status_changed"]);
    expect(d.changes[0].sessionIds).toEqual(["x1"]);
  });

  it("meldet eine ganz entfallene Abrechenbarkeit", () => {
    const d = diffInvoiceAgainstLive(
      input({
        liveInvoiceSessions: null,
        liveTotalCHF: null,
        unbillableReason: "Liam wird über die Rechnung von Mila abgerechnet.",
      })
    );
    expect(types(d)).toContain("billing_status_changed");
    expect(d.totalAfterCHF).toBeNull();
    expect(d.changes.at(-1)?.detail).toContain("Mila");
  });

  it("erkennt geänderte, entfallene und neue Abo-Positionen", () => {
    const d = diffInvoiceAgainstLive(
      input({
        snapshotSubscriptionLines: [
          { id: "sub-1", description: "Abo A", amountCHF: 50 },
          { id: "sub-2", description: "Abo B", amountCHF: 20 },
        ],
        liveSubscriptionLines: [
          { id: "sub-1", description: "Abo A", amountCHF: 75 },
          { id: "sub-3", description: "Abo C", amountCHF: 10 },
        ],
      })
    );
    expect(types(d)).toEqual([
      "subscription_changed",
      "subscription_changed",
      "subscription_changed",
    ]);
    expect(d.changes[0].detail).toContain("50.00 → CHF 75.00");
    expect(d.changes[1].detail).toContain("entfallen");
    expect(d.changes[2].detail).toContain("Neue Abo-Position");
  });

  it("ignoriert Session-IDs, die schon beim Einfrieren fehlten", () => {
    const d = diffInvoiceAgainstLive(
      input({ snapshotSessionIds: ["x1", "war-schon-weg"] })
    );
    expect(d.changes).toEqual([]);
  });

  it("hält den Fingerabdruck stabil, aber unterscheidet verschiedene Abweichungen", () => {
    const a = diffInvoiceAgainstLive(
      input({ liveSessionsById: new Map(), liveInvoiceSessions: [] })
    );
    const b = diffInvoiceAgainstLive(
      input({ liveSessionsById: new Map(), liveInvoiceSessions: [] })
    );
    const shifted = live({ date: new Date("2026-06-11T08:30:00.000Z") });
    const c = diffInvoiceAgainstLive(
      input({ liveInvoiceSessions: [shifted], liveSessionsById: new Map([["x1", shifted]]) })
    );
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
    expect(diffInvoiceAgainstLive(input()).fingerprint).toBe("");
  });

  it("gibt die Beträge vorher/nachher mit", () => {
    const d = diffInvoiceAgainstLive(input({ snapshotTotalCHF: 60, liveTotalCHF: 120 }));
    expect(d.totalBeforeCHF).toBe(60);
    expect(d.totalAfterCHF).toBe(120);
  });
});
