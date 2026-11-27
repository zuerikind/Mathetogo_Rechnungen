import { describe, expect, it } from "vitest";
import { buildYearCards } from "./invoice-year-cards";

const rows = [{ year: 2026, totalCHF: 100, count: 3 }];

describe("buildYearCards", () => {
  it("nimmt fuer das Bezugsjahr den Dashboard-Betrag", () => {
    expect(buildYearCards(rows, 2026, 900)[0]).toMatchObject({ year: 2026, totalCHF: 900, count: 3, isDashboardAligned: true });
  });
  it("ueberschreibt und ergaenzt nichts, solange der Betrag fehlt", () => {
    expect(buildYearCards(rows, 2026, null)[0]).toMatchObject({ totalCHF: 100, isDashboardAligned: false });
    expect(buildYearCards([], 2027, null).map((c) => c.year)).toEqual([2025, 2024]);
  });
  it("ergaenzt ein Jahr ohne Rechnungen", () => {
    expect(buildYearCards([], 2027, 50)[0]).toMatchObject({ year: 2027, totalCHF: 50, count: 0 });
  });
  it("zeigt ein Archivjahr nur einmal mit dem festen Betrag", () => {
    const cards = buildYearCards([{ year: 2025, totalCHF: 1, count: 1 }], 2025, 999);
    expect(cards.map((c) => c.year)).toEqual([2025, 2024]);
    expect(cards[0]).toMatchObject({ totalCHF: 55705.5, isFixed: true });
  });
});
