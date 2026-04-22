import { getChargeMonths, addMonths } from "@/lib/platform-charges";

export type ChargeStatus = "paid" | "unpaid" | "scheduled";

export type ChargeRow = {
  month: number;
  year: number;
  charge: MinimalCharge | null;
  status: ChargeStatus;
};

type MinimalCharge = { paidAt: string | null; month: number; year: number };
type MinimalSubscription = { startMonth: number; startYear: number; durationMonths: number };

/**
 * Classify a charge as paid, scheduled, or unpaid.
 * Pass now as a parameter so callers and tests can inject a reference date.
 */
export function chargeStatus(charge: MinimalCharge, now: Date = new Date()): ChargeStatus {
  if (charge.paidAt) return "paid";
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const isFuture =
    charge.year > currentYear ||
    (charge.year === currentYear && charge.month > currentMonth);
  return isFuture ? "scheduled" : "unpaid";
}

/**
 * Months remaining until the subscription ends (clamped to 0 if already expired).
 * end is exclusive: a 1-month subscription starting in April ends at May (0 months remaining from April).
 */
export function monthsRemaining(sub: MinimalSubscription, now: Date = new Date()): number {
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const end = addMonths(sub.startMonth, sub.startYear, sub.durationMonths);
  const diff = (end.year - currentYear) * 12 + (end.month - currentMonth);
  return Math.max(0, diff);
}

/**
 * Build the full expected row list for a subscription, merging actual charge
 * rows with expected months. Subscriptions with no charge rows will show all
 * months as "scheduled" or "unpaid" depending on whether they are in the future.
 */
export function buildChargeRows(
  sub: MinimalSubscription,
  charges: MinimalCharge[],
  now: Date = new Date()
): ChargeRow[] {
  const expectedMonths = getChargeMonths(sub.startMonth, sub.startYear, sub.durationMonths);
  const chargeMap = new Map(charges.map((c) => [`${c.year}-${c.month}`, c]));
  return expectedMonths.map(({ month, year }) => {
    const charge = chargeMap.get(`${year}-${month}`) ?? null;
    const synthetic: MinimalCharge = charge ?? { paidAt: null, month, year };
    return { month, year, charge, status: chargeStatus(synthetic, now) };
  });
}
