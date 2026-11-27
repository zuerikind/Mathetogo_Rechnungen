/** Jahreskarten auf /invoices. */

/** Archiv: feste Jahres-Verdienste (nicht aus der Tabelle berechnet). */
export const FIXED_YEAR_EARNINGS_CHF: Readonly<Record<number, number>> = {
  2024: 16534.25,
  2025: 55705.5,
};

export type YearEarnings = { year: number; totalCHF: number; count: number };
export type YearCard = {
  year: number;
  totalCHF: number;
  count: number | null;
  isFixed: boolean;
  isDashboardAligned: boolean;
};

/**
 * Jahre aus der Tabelle plus feste Archiv-Jahre (nie doppelt). `referenceYtd` ist der Jahresbetrag wie im
 * Dashboard fuer genau `referenceYear`; null = noch nicht geladen, dann wird nichts ueberschrieben oder ergaenzt
 * (sonst stuende kurz 0 oder der Betrag eines anderen Jahres da).
 */
export function buildYearCards(
  earnings: YearEarnings[],
  referenceYear: number,
  referenceYtd: number | null
): YearCard[] {
  const cards: YearCard[] = earnings
    .filter((e) => FIXED_YEAR_EARNINGS_CHF[e.year] === undefined)
    .map((e) => ({ ...e, isFixed: false, isDashboardAligned: false }));
  if (referenceYtd !== null && FIXED_YEAR_EARNINGS_CHF[referenceYear] === undefined) {
    const card = cards.find((c) => c.year === referenceYear);
    if (card) Object.assign(card, { totalCHF: referenceYtd, isDashboardAligned: true });
    else cards.push({ year: referenceYear, totalCHF: referenceYtd, count: 0, isFixed: false, isDashboardAligned: true });
  }
  for (const [year, totalCHF] of Object.entries(FIXED_YEAR_EARNINGS_CHF)) {
    cards.push({ year: Number(year), totalCHF, count: null, isFixed: true, isDashboardAligned: false });
  }
  return cards.sort((a, b) => b.year - a.year);
}
