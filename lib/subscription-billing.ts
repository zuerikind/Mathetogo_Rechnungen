import { getChargeMonths } from "@/lib/month-math";

/** Fields needed for invoice + analysis (client or server). */
export type SubscriptionBillingInput = {
  id: string;
  studentId: string;
  amountCHF: number;
  billingMethod: string;
  durationMonths: number;
  startMonth: number;
  startYear: number;
};

export type SubscriptionInvoiceLine = {
  id: string;
  description: string;
  amountCHF: number;
};

/**
 * Rechnung (invoice): bundle full contract amount on start month.
 * Input is CHF/month, so invoice amount is monthly amount * durationMonths.
 * Überweisung (direct): not billed on monthly invoices.
 */
export function getSubscriptionInvoiceLines(
  subs: SubscriptionBillingInput[],
  year: number,
  month: number
): SubscriptionInvoiceLine[] {
  const lines: SubscriptionInvoiceLine[] = [];
  for (const s of subs) {
    if (s.billingMethod !== "invoice") continue;
    if (s.startYear !== year || s.startMonth !== month) continue;
    const label =
      s.durationMonths === 6
        ? "Mathetogo Abonnement (6 Monate)"
        : "Mathetogo Abonnement (1 Monat)";
    lines.push({
      id: `sub-${s.id}`,
      description: label,
      amountCHF: s.amountCHF * s.durationMonths,
    });
  }
  return lines;
}

/** Analysis monthly CHF: use entered CHF/month for each covered month (invoice + Ueberweisung). */
export function subscriptionProrationForMonth(
  subs: SubscriptionBillingInput[],
  year: number,
  month: number
): number {
  let sum = 0;
  for (const s of subs) {
    const months = getChargeMonths(s.startMonth, s.startYear, s.durationMonths);
    if (!months.some((m) => m.year === year && m.month === month)) continue;
    sum += s.amountCHF;
  }
  return sum;
}

export function subscriptionProrationByStudentForMonth(
  subs: SubscriptionBillingInput[],
  year: number,
  month: number
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of subs) {
    const months = getChargeMonths(s.startMonth, s.startYear, s.durationMonths);
    if (!months.some((m) => m.year === year && m.month === month)) continue;
    const part = s.amountCHF;
    out[s.studentId] = (out[s.studentId] ?? 0) + part;
  }
  return out;
}

/** Total subscription contract value (monthly CHF * duration months). */
export function totalSubscriptionContractCHF(subs: SubscriptionBillingInput[]): number {
  return subs.reduce((acc, s) => acc + s.amountCHF * s.durationMonths, 0);
}

/** Proration sum across months 1..12 for a calendar year (analysis). */
export function subscriptionProrationYearTotal(subs: SubscriptionBillingInput[], year: number): number {
  let sum = 0;
  for (let m = 1; m <= 12; m++) {
    sum += subscriptionProrationForMonth(subs, year, m);
  }
  return sum;
}
