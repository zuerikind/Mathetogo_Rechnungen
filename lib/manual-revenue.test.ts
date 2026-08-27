import { describe, expect, it } from "vitest";
import {
  getEffectiveManualBaseline,
  manualBaselineAmountFor,
  manualBaselineMonths,
  manualBaselineTotalThrough,
  MANUAL_BASELINE_YEAR,
  type ManualBaseline,
} from "./manual-revenue";

/**
 * Regression: die manuelle Q1-Summe lief in fremde Jahre.
 *
 * `baseline.entries` enthaelt IMMER die Monate 1–3. Der Endpunkt suchte den
 * Monatsbetrag ohne Jahresprüfung heraus — waehrend die Jahressumme daneben sehr
 * wohl auf `year === baseline.year` prüfte. Fuer Januar–Maerz eines anderen Jahres
 * zeigte die Monatskachel deshalb die 2026er-Summe statt der echten Lektionen,
 * und die beiden Zahlen widersprachen sich.
 */

const baseline: ManualBaseline = {
  year: 2026,
  entries: [
    { month: 1, amountCHF: 8501.8 },
    { month: 2, amountCHF: 4197.5 },
    { month: 3, amountCHF: 4624.0 },
  ],
};

describe("manualBaselineAmountFor", () => {
  it("Baseline-Monat im Baseline-Jahr -> manueller Betrag", () => {
    expect(manualBaselineAmountFor(baseline, 2026, 1)).toBe(8501.8);
    expect(manualBaselineAmountFor(baseline, 2026, 2)).toBe(4197.5);
    expect(manualBaselineAmountFor(baseline, 2026, 3)).toBe(4624.0);
  });

  it("derselbe Monat im VORjahr -> kein manueller Betrag", () => {
    expect(manualBaselineAmountFor(baseline, 2025, 1)).toBeNull();
    expect(manualBaselineAmountFor(baseline, 2025, 2)).toBeNull();
    expect(manualBaselineAmountFor(baseline, 2025, 3)).toBeNull();
  });

  it("derselbe Monat im FOLGEjahr -> kein manueller Betrag", () => {
    // Ab dem 01.01.2027 haette die Kopfzeile sonst 8'501.80 aus dem Januar 2026
    // gezeigt, statt der tatsaechlichen Lektionen des Januars 2027.
    expect(manualBaselineAmountFor(baseline, 2027, 1)).toBeNull();
    expect(manualBaselineAmountFor(baseline, 2027, 2)).toBeNull();
    expect(manualBaselineAmountFor(baseline, 2027, 3)).toBeNull();
  });

  it("Monat ausserhalb von Q1 -> nie ein manueller Betrag", () => {
    expect(manualBaselineAmountFor(baseline, 2026, 4)).toBeNull();
    expect(manualBaselineAmountFor(baseline, 2026, 12)).toBeNull();
  });

  it("folgt einem in den Einstellungen verschobenen Baseline-Jahr", () => {
    const verschoben: ManualBaseline = { ...baseline, year: 2027 };
    expect(manualBaselineAmountFor(verschoben, 2027, 2)).toBe(4197.5);
    expect(manualBaselineAmountFor(verschoben, 2026, 2)).toBeNull();
  });
});

describe("manualBaselineMonths", () => {
  it("nur im Baseline-Jahr belegt", () => {
    expect(Array.from(manualBaselineMonths(baseline, 2026)).sort()).toEqual([1, 2, 3]);
    expect(manualBaselineMonths(baseline, 2025).size).toBe(0);
    expect(manualBaselineMonths(baseline, 2027).size).toBe(0);
  });
});

describe("manualBaselineTotalThrough", () => {
  it("summiert nur bis zum gewaehlten Monat", () => {
    expect(manualBaselineTotalThrough(baseline, 2026, 1)).toBe(8501.8);
    expect(manualBaselineTotalThrough(baseline, 2026, 2)).toBeCloseTo(12699.3, 6);
    expect(manualBaselineTotalThrough(baseline, 2026, 12)).toBeCloseTo(17323.3, 6);
  });

  it("ausserhalb des Baseline-Jahres 0", () => {
    expect(manualBaselineTotalThrough(baseline, 2025, 12)).toBe(0);
    expect(manualBaselineTotalThrough(baseline, 2027, 12)).toBe(0);
  });
});

describe("Monatskachel und Jahressumme stimmen ueberein", () => {
  /** Was der Endpunkt aus den drei Helfern baut — dieselbe Reihenfolge wie dort. */
  const sessionIncome = (
    year: number,
    month: number,
    aggregatedSessionsForMonth: number,
    aggregatedSessionsThroughMonthExcludingBaseline: number
  ) => {
    const months = manualBaselineMonths(baseline, year);
    const monthAmount = manualBaselineAmountFor(baseline, year, month);
    return {
      monthIncome: monthAmount ?? (months.has(month) ? 0 : aggregatedSessionsForMonth),
      ytdIncome:
        manualBaselineTotalThrough(baseline, year, month) +
        aggregatedSessionsThroughMonthExcludingBaseline,
    };
  };

  it("Baseline-Jahr: Januar-Kachel und YTD nutzen beide die manuelle Summe", () => {
    const { monthIncome, ytdIncome } = sessionIncome(2026, 1, 999, 0);
    expect(monthIncome).toBe(8501.8);
    expect(ytdIncome).toBe(8501.8);
  });

  it("Fremdjahr: beide nutzen die echten Lektionen, ohne manuelle Summe", () => {
    // Regression: vorher monthIncome = 8501.80 (falsch), ytdIncome = 3000 (richtig).
    const { monthIncome, ytdIncome } = sessionIncome(2027, 1, 3000, 3000);
    expect(monthIncome).toBe(3000);
    expect(ytdIncome).toBe(3000);
  });
});

describe("getEffectiveManualBaseline", () => {
  it("Datei-Vorgaben, solange nicht alle drei Monate gespeichert sind", () => {
    const fromFile = getEffectiveManualBaseline({
      manualQ1Year: 2027,
      manualQ1M1Chf: 100,
      manualQ1M2Chf: null,
      manualQ1M3Chf: 300,
    });
    expect(fromFile.fromDatabase).toBe(false);
    expect(fromFile.year).toBe(MANUAL_BASELINE_YEAR);
  });

  it("gespeicherte Werte samt Jahr, sobald alle drei gesetzt sind", () => {
    const fromDb = getEffectiveManualBaseline({
      manualQ1Year: 2027,
      manualQ1M1Chf: 100,
      manualQ1M2Chf: 200,
      manualQ1M3Chf: 300,
    });
    expect(fromDb.fromDatabase).toBe(true);
    expect(fromDb.year).toBe(2027);
    // Und die Jahresprüfung folgt dem gespeicherten Jahr:
    expect(manualBaselineAmountFor(fromDb, 2027, 1)).toBe(100);
    expect(manualBaselineAmountFor(fromDb, 2026, 1)).toBeNull();
  });
});
