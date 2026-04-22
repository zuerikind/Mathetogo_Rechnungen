import { describe, it, expect } from "vitest";
import { addMonths, getChargeMonths, ensureChargeForMonth } from "@/lib/platform-charges";

describe("addMonths", () => {
  it("returns the same month when offset is 0", () => {
    expect(addMonths(10, 2025, 0)).toEqual({ month: 10, year: 2025 });
  });

  it("advances within the same year", () => {
    expect(addMonths(10, 2025, 2)).toEqual({ month: 12, year: 2025 });
  });

  it("wraps to January of next year (Oct + 3)", () => {
    expect(addMonths(10, 2025, 3)).toEqual({ month: 1, year: 2026 });
  });

  it("wraps across year boundary (Oct + 5 = Mar next year)", () => {
    expect(addMonths(10, 2025, 5)).toEqual({ month: 3, year: 2026 });
  });

  it("wraps from December + 1", () => {
    expect(addMonths(12, 2025, 1)).toEqual({ month: 1, year: 2026 });
  });

  it("spans Jan through Dec of same year", () => {
    expect(addMonths(1, 2025, 11)).toEqual({ month: 12, year: 2025 });
  });
});

describe("getChargeMonths", () => {
  it("returns 6 months spanning a year boundary for Oct start", () => {
    expect(getChargeMonths(10, 2025, 6)).toEqual([
      { month: 10, year: 2025 },
      { month: 11, year: 2025 },
      { month: 12, year: 2025 },
      { month: 1, year: 2026 },
      { month: 2, year: 2026 },
      { month: 3, year: 2026 },
    ]);
  });

  it("returns a single-element array for duration 1", () => {
    expect(getChargeMonths(1, 2026, 1)).toEqual([{ month: 1, year: 2026 }]);
  });
});

describe("ensureChargeForMonth", () => {
  it("is exported as a function", () => {
    expect(typeof ensureChargeForMonth).toBe("function");
  });
});
