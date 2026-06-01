import "server-only";
import { prisma } from "@/lib/prisma";
import { getSubscriptionInvoiceLines } from "@/lib/subscription-billing";
import { INVOICE_BUCKET, invoiceStoragePath, supabase } from "@/lib/supabase";

/** Live billable amount for a student/month (sessions + Rechnung-Abo). */
export async function getBillableTotalCHF(
  studentId: string,
  year: number,
  month: number
): Promise<number> {
  const [sessions, subscriptions] = await Promise.all([
    prisma.session.findMany({
      where: { studentId, year, month },
      select: { amountCHF: true },
    }),
    prisma.platformSubscription.findMany({
      where: { studentId },
      select: {
        id: true,
        studentId: true,
        amountCHF: true,
        billingMethod: true,
        durationMonths: true,
        startMonth: true,
        startYear: true,
      },
    }),
  ]);

  const sessionsTotal = sessions.reduce((acc, s) => acc + s.amountCHF, 0);
  const subscriptionTotal = getSubscriptionInvoiceLines(subscriptions, year, month).reduce(
    (acc, line) => acc + line.amountCHF,
    0
  );
  return Math.round((sessionsTotal + subscriptionTotal) * 100) / 100;
}

/**
 * Removes draft invoices (not sent/paid) when nothing is billable anymore.
 * Returns true if a row was deleted.
 */
export async function pruneStaleInvoiceIfUnbillable(
  studentId: string,
  year: number,
  month: number
): Promise<boolean> {
  const billable = await getBillableTotalCHF(studentId, year, month);
  if (billable > 0) return false;

  const invoice = await prisma.invoice.findUnique({
    where: { studentId_month_year: { studentId, month, year } },
    select: { id: true, sentAt: true, paidAt: true },
  });
  if (!invoice) return false;
  if (invoice.sentAt || invoice.paidAt) return false;

  await prisma.invoice.delete({ where: { id: invoice.id } });

  try {
    await supabase.storage
      .from(INVOICE_BUCKET)
      .remove([invoiceStoragePath(year, month, studentId)]);
  } catch {
    // Non-fatal if storage file is already gone.
  }

  return true;
}

/** Prune all draft invoices in scope that no longer have billable content. */
export async function pruneStaleInvoicesInScope(opts: {
  year?: number;
  month?: number;
  studentIds?: string[];
}): Promise<number> {
  const invoices = await prisma.invoice.findMany({
    where: {
      ...(opts.year !== undefined ? { year: opts.year } : {}),
      ...(opts.month !== undefined ? { month: opts.month } : {}),
      ...(opts.studentIds?.length ? { studentId: { in: opts.studentIds } } : {}),
      sentAt: null,
      paidAt: null,
    },
    select: { studentId: true, year: true, month: true },
  });

  let removed = 0;
  for (const inv of invoices) {
    const did = await pruneStaleInvoiceIfUnbillable(inv.studentId, inv.year, inv.month);
    if (did) removed += 1;
  }
  return removed;
}
