import { describe, expect, it } from "vitest";
import { rateAtDate } from "./rate-history";

const d = (s: string) => new Date(`${s}T00:00:00`);

describe("rateAtDate", () => {
  it("falls back to current rate without history", () => {
    expect(rateAtDate([], 1.2, d("2026-07-01"))).toBe(1.2);
  });

  it("uses the rate effective on the lesson date, not the newest", () => {
    const history = [
      { ratePerMin: 1.1, effectiveFrom: new Date(0) },
      { ratePerMin: 1.2, effectiveFrom: d("2026-08-01") },
    ];
    expect(rateAtDate(history, 1.2, d("2026-07-15"))).toBe(1.1);
    expect(rateAtDate(history, 1.2, d("2026-08-01"))).toBe(1.2);
    expect(rateAtDate(history, 1.2, d("2026-09-10"))).toBe(1.2);
  });

  it("a correction only sticks once later entries are dropped", () => {
    // Vorfall 10.07.2026: erst 1.20 ab 01.07. gesetzt, dann 1.30 ab 01.06. korrigiert.
    // Der rueckwirkende Eintrag hebt den spaeteren nicht auf.
    const broken = [
      { ratePerMin: 1.3, effectiveFrom: new Date(0) },
      { ratePerMin: 1.2, effectiveFrom: d("2026-07-01") },
      { ratePerMin: 1.3, effectiveFrom: d("2026-06-01") },
    ];
    expect(rateAtDate(broken, 1.3, d("2026-08-01"))).toBe(1.2);

    // Was der PATCH-Endpunkt heute tut: alles ab dem Stichtag ersetzen.
    const corrected = [
      ...broken.filter((h) => h.effectiveFrom < d("2026-06-01")),
      { ratePerMin: 1.3, effectiveFrom: d("2026-06-01") },
    ];
    expect(rateAtDate(corrected, 1.3, d("2026-08-01"))).toBe(1.3);
  });

  it("ignores entries that start after the lesson date", () => {
    const history = [{ ratePerMin: 2, effectiveFrom: d("2026-08-01") }];
    expect(rateAtDate(history, 1.2, d("2026-07-15"))).toBe(1.2);
  });
});
