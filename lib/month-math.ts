/**
 * Pure month arithmetic (no DB). Shared by invoice, subscriptions, and tests.
 */

export function addMonths(
  startMonth: number,
  startYear: number,
  offset: number
): { month: number; year: number } {
  const totalMonths = startMonth - 1 + offset;
  return {
    month: (totalMonths % 12) + 1,
    year: startYear + Math.floor(totalMonths / 12),
  };
}

const zurichYearMonthFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "2-digit",
});

/** Which billing month an instant belongs to, in Zurich time (server TZ on Vercel is UTC). */
export function zurichYearMonth(date: Date): { year: number; month: number } {
  const [year, month] = zurichYearMonthFormatter.format(date).split("-").map(Number);
  return { year, month };
}

export function getChargeMonths(
  startMonth: number,
  startYear: number,
  durationMonths: number
): Array<{ month: number; year: number }> {
  return Array.from({ length: durationMonths }, (_, i) =>
    addMonths(startMonth, startYear, i)
  );
}
