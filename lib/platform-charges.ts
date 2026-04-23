import { prisma } from "@/lib/prisma";
import { addMonths, getChargeMonths } from "@/lib/month-math";

export { addMonths, getChargeMonths };

/**
 * Idempotent: creates a PlatformCharge row for (subscriptionId, month, year)
 * if it does not already exist. Safe to call multiple times — calling twice
 * produces exactly one row (the second call is a no-op via upsert update:{}).
 * (Optional tracking; invoice totals use `lib/subscription-billing` + `getInvoicePayload`.)
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
