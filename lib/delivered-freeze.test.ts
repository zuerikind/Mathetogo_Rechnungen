import { describe, expect, it } from "vitest";
import {
  checkTariffEffectiveDate,
  decideFrozenWrite,
  earliestTariffDate,
  isFrozenMonth,
  zurichMidnight,
} from "./delivered-freeze";

// 29.09.2026: Juli und frueher gesperrt, August und September offen.
const now = new Date("2026-09-29T10:00:00Z");
const juli = new Date("2026-07-08T14:00:00Z");
const juliVerschoben = new Date("2026-07-09T15:30:00Z");
const august = new Date("2026-08-20T14:00:00Z");
const oktober = new Date("2026-10-02T13:00:00Z");

describe("isFrozenMonth", () => {
  it("freezes the month before last and everything older", () => {
    expect(isFrozenMonth({ year: 2026, month: 7 }, now)).toBe(true);
    expect(isFrozenMonth({ year: 2025, month: 12 }, now)).toBe(true);
    expect(isFrozenMonth({ year: 2026, month: 8 }, now)).toBe(false);
    expect(isFrozenMonth({ year: 2026, month: 9 }, now)).toBe(false);
  });

  it("works across the year boundary", () => {
    const januar = new Date("2027-01-05T10:00:00Z");
    expect(isFrozenMonth({ year: 2026, month: 11 }, januar)).toBe(true);
    expect(isFrozenMonth({ year: 2026, month: 12 }, januar)).toBe(false);
  });

  it("switches at Zurich midnight, not UTC", () => {
    // 01.10. 00:30 Zuerich = 30.09. 22:30 UTC — schon Oktober, August ist zu.
    expect(isFrozenMonth({ year: 2026, month: 8 }, new Date("2026-09-30T22:30:00Z"))).toBe(true);
  });
});

describe("decideFrozenWrite", () => {
  it("writes normally in open months", () => {
    const incoming = { studentId: "max", date: august, durationMin: 50, amountCHF: 65 };
    expect(decideFrozenWrite({ existing: null, incoming, now })).toEqual({ kind: "write" });
  });

  it("never creates a new lesson in a frozen month", () => {
    const incoming = { studentId: "max", date: juliVerschoben, durationMin: 50, amountCHF: 65 };
    expect(decideFrozenWrite({ existing: null, incoming, now })).toMatchObject({ kind: "freeze", isNew: true });
  });

  it("keeps a frozen lesson and reports the calendar change", () => {
    const existing = { studentId: "max", date: juli, durationMin: 50, amountCHF: 65 };
    const incoming = { studentId: "max", date: juliVerschoben, durationMin: 60, amountCHF: 78 };
    const d = decideFrozenWrite({ existing, incoming, now });
    expect(d.kind).toBe("freeze");
    if (d.kind === "freeze") expect(d.changes).toHaveLength(2);
  });

  it("does not let a frozen lesson move out into an open month", () => {
    const existing = { studentId: "max", date: juli, durationMin: 50, amountCHF: 65 };
    const incoming = { studentId: "max", date: oktober, durationMin: 50, amountCHF: 65 };
    expect(decideFrozenWrite({ existing, incoming, now }).kind).toBe("freeze");
  });

  it("an unchanged frozen lesson is frozen without a finding", () => {
    const existing = { studentId: "max", date: juli, durationMin: 50, amountCHF: 65 };
    expect(decideFrozenWrite({ existing, incoming: { ...existing }, now })).toEqual({
      kind: "freeze",
      isNew: false,
      changes: [],
    });
  });
});

describe("tariff window", () => {
  it("earliest date is the 1st of last month", () => {
    expect(earliestTariffDate(now)).toBe("2026-08-01");
    expect(earliestTariffDate(new Date("2027-01-10T10:00:00Z"))).toBe("2026-12-01");
  });

  it("rejects dates in frozen months", () => {
    expect(checkTariffEffectiveDate("2026-07-31", now).ok).toBe(false);
    expect(checkTariffEffectiveDate("2020-01-01", now).ok).toBe(false);
  });

  it("accepts last month, this month and the future, at Zurich midnight", () => {
    const r = checkTariffEffectiveDate("2026-08-01", now);
    expect(r).toEqual({ ok: true, effectiveFrom: new Date("2026-07-31T22:00:00Z") });
    expect(checkTariffEffectiveDate("2026-12-01", now)).toEqual({
      ok: true,
      effectiveFrom: new Date("2026-11-30T23:00:00Z"),
    });
  });

  it("rejects malformed and impossible dates", () => {
    expect(checkTariffEffectiveDate("2026-09-31", now).ok).toBe(false);
    expect(checkTariffEffectiveDate("", now).ok).toBe(false);
    expect(checkTariffEffectiveDate(undefined, now).ok).toBe(false);
  });

  it("zurichMidnight handles DST days", () => {
    expect(zurichMidnight(2026, 3, 29)).toEqual(new Date("2026-03-28T23:00:00Z"));
    expect(zurichMidnight(2026, 10, 25)).toEqual(new Date("2026-10-24T22:00:00Z"));
  });
});
