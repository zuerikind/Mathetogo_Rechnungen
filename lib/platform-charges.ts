import { prisma } from "@/lib/prisma";

/**
 * Advance a 1-indexed month by `offset` months, wrapping year correctly.
 * offset=0 returns the start month unchanged.
 *
 * Examples:
 *   addMonths(10, 2025, 3)  → { month: 1, year: 2026 }  (Oct + 3 = Jan)
 *   addMonths(12, 2025, 1)  → { month: 1, year: 2026 }  (Dec + 1 = Jan)
 *   addMonths(10, 2025, 0)  → { month: 10, year: 2025 } (identity)
 */
export function addMonths(
  startMonth: number,
  startYear: number,
  offset: number
): { month: number; year: number } {
  // Convert to 0-indexed for modular arithmetic
  const totalMonths = startMonth - 1 + offset;
  return {
    month: (totalMonths % 12) + 1,
    year: startYear + Math.floor(totalMonths / 12),
  };
}

/**
 * Generate the full sequence of { month, year } pairs for a subscription.
 *
 * Example: getChargeMonths(10, 2025, 6) →
 *   [{10,2025},{11,2025},{12,2025},{1,2026},{2,2026},{3,2026}]
 */
export function getChargeMonths(
  startMonth: number,
  startYear: number,
  durationMonths: number
): Array<{ month: number; year: number }> {
  return Array.from({ length: durationMonths }, (_, i) =>
    addMonths(startMonth, startYear, i)
  );
}

/**
 * Idempotent: creates a PlatformCharge row for (subscriptionId, month, year)
 * if it does not already exist. Safe to call multiple times — calling twice
 * produces exactly one row (the second call is a no-op via upsert update:{}).
 *
 * Called by Phase 3 inside getInvoicePayload for invoice-billed subscriptions.
 */
export async function ensureChargeForMonth(
  subscriptionId: string,
  month: number,
  year: number,
  amountCHF: number
): Promise<void> {
  await prisma.platformCharge.upsert({
    where: {
      subscriptionId_month_year: { subscriptionId, month, year },
    },
    update: {}, // no-op: row already exists, no changes needed
    create: { subscriptionId, month, year, amountCHF },
  });
}
