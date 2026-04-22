import { describe, it, expect } from "vitest";
import { chargeStatus, monthsRemaining, buildChargeRows } from "./subscription-utils";

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
});
