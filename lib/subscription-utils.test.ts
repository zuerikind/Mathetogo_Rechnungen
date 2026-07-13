import { describe, it, expect } from "vitest";
import { chargeStatus, isExpiredAt, monthsRemaining, buildChargeRows } from "./subscription-utils";

// Reference date for deterministic tests: 2026-04-01
const REF_DATE = new Date(2026, 3, 1); // month index 3 = April

describe("chargeStatus", () => {
  it("returns 'paid' when paidAt is set", () => {
    expect(
      chargeStatus({ paidAt: "2026-01-15T00:00:00Z", month: 1, year: 2026 }, REF_DATE)
    ).toBe("paid");
  });

  it("returns 'scheduled' for a far-future month (year=2099)", () => {
    expect(
      chargeStatus({ paidAt: null, month: 99, year: 2099 }, REF_DATE)
    ).toBe("scheduled");
  });

  it("returns 'unpaid' for a past month (Jan 2020)", () => {
    expect(
      chargeStatus({ paidAt: null, month: 1, year: 2020 }, REF_DATE)
    ).toBe("unpaid");
  });

  it("returns 'unpaid' for current month (April 2026)", () => {
    expect(
      chargeStatus({ paidAt: null, month: 4, year: 2026 }, REF_DATE)
    ).toBe("unpaid");
  });
});

describe("monthsRemaining", () => {
  it("returns 3 for a 6-month subscription starting Jan 2026 (ref: Apr 2026)", () => {
    // end = addMonths(1, 2026, 6) = July 2026; diff = (2026-2026)*12 + (7-4) = 3
    expect(
      monthsRemaining({ startMonth: 1, startYear: 2026, durationMonths: 6 }, REF_DATE)
    ).toBe(3);
  });

  it("returns 0 for an already-expired subscription (Jan 2025, 6 months)", () => {
    // end = July 2025, which is before Apr 2026 → clamped to 0
    expect(
      monthsRemaining({ startMonth: 1, startYear: 2025, durationMonths: 6 }, REF_DATE)
    ).toBe(0);
  });

  it("returns 1 for a 1-month subscription starting Apr 2026 (ref: Apr 2026)", () => {
    // end = addMonths(4, 2026, 1) = May 2026; diff = (2026-2026)*12 + (5-4) = 1
    expect(
      monthsRemaining({ startMonth: 4, startYear: 2026, durationMonths: 1 }, REF_DATE)
    ).toBe(1);
  });
});

describe("isExpiredAt", () => {
  const sub6 = { startMonth: 1, startYear: 2026, durationMonths: 6 }; // covers Jan–Jun 2026

  it("is not expired during the last covered month (Jun 2026)", () => {
    expect(isExpiredAt(sub6, { year: 2026, month: 6 })).toBe(false);
  });

  it("is expired the month after the last covered month (Jul 2026)", () => {
    expect(isExpiredAt(sub6, { year: 2026, month: 7 })).toBe(true);
  });

  it("handles year rollover: Oct 2026 + 6 months covers through Mar 2027", () => {
    const sub = { startMonth: 10, startYear: 2026, durationMonths: 6 };
    expect(isExpiredAt(sub, { year: 2027, month: 3 })).toBe(false);
    expect(isExpiredAt(sub, { year: 2027, month: 4 })).toBe(true);
  });

  it("a 1-month subscription expires after its single month", () => {
    const sub = { startMonth: 4, startYear: 2026, durationMonths: 1 };
    expect(isExpiredAt(sub, { year: 2026, month: 4 })).toBe(false);
    expect(isExpiredAt(sub, { year: 2026, month: 5 })).toBe(true);
  });
});

describe("buildChargeRows", () => {
  it("produces 1 row with status='scheduled' for a future month (May 2026)", () => {
    const rows = buildChargeRows(
      { startMonth: 5, startYear: 2026, durationMonths: 1 },
      [],
      REF_DATE
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ month: 5, year: 2026, status: "scheduled", charge: null });
  });

  it("produces 6 rows for a 6-month subscription with no actual charges", () => {
    const rows = buildChargeRows(
      { startMonth: 1, startYear: 2026, durationMonths: 6 },
      [],
      REF_DATE
    );
    expect(rows).toHaveLength(6);
  });

  it("marks every month as paid for Ueberweisung (direct)", () => {
    const rows = buildChargeRows(
      { startMonth: 1, startYear: 2026, durationMonths: 6, billingMethod: "direct" },
      [],
      REF_DATE
    );
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.status === "paid")).toBe(true);
  });
});
