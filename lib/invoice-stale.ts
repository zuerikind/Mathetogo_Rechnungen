import "server-only";
import { prisma } from "@/lib/prisma";
import { DELIVERED_INVOICE_WHERE, isPrunableDraft } from "@/lib/invoice-delivery";
import { getSubscriptionInvoiceLines } from "@/lib/subscription-billing";
import { INVOICE_BUCKET, invoiceStoragePath, supabase } from "@/lib/supabase";
import { ACTIVE_SESSION_WHERE } from "@/lib/calendar-cancellation";

/** Live billable amount for a student/month (sessions + Rechnung-Abo, inkl. Familienrechnungs-Gruppe). */
export async function getBillableTotalCHF(
  studentId: string,
  year: number,
  month: number
): Promise<number> {
  const self = await prisma.student.findUnique({
    where: { id: studentId },
    select: { billedToId: true },
  });
  // Wird über die Familienrechnung eines anderen Schülers abgerechnet → eigene Rechnung ist stale.
  if (self?.billedToId) return 0;

  const children = await prisma.student.findMany({
    where: { billedToId: studentId },
    select: { id: true },
  });
  // Gleiches Ausschluss-Kriterium wie getInvoicePayload: Kinder mit eigener
  // AUSGELIEFERTER Rechnung für den Monat zählen nicht zur Familienrechnung.
  const childrenBilledSeparately =
    children.length > 0
      ? await prisma.invoice.findMany({
          where: {
            studentId: { in: children.map((c) => c.id) },
            year,
            month,
            ...DELIVERED_INVOICE_WHERE,
          },
          select: { studentId: true },
        })
      : [];
  const excluded = new Set(childrenBilledSeparately.map((i) => i.studentId));
  const memberIds = [studentId, ...children.filter((c) => !excluded.has(c.id)).map((c) => c.id)];

  const [sessions, subscriptions] = await Promise.all([
    prisma.session.findMany({
      // Stornierte zaehlen nicht als abrechenbar — sonst haelt eine abgesagte
      // Lektion eine leere Entwurfsrechnung am Leben.
      where: { studentId: { in: memberIds }, year, month, ...ACTIVE_SESSION_WHERE },
      select: { amountCHF: true },
    }),
    prisma.platformSubscription.findMany({
      where: { studentId: { in: memberIds } },
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
  return removeInvoiceWhenUnbillable(studentId, year, month, { includeSent: false });
}

/**
 * Deletes invoice + PDF when nothing is billable for the month.
 * By default skips sent/paid rows; set includeSent for mistaken sends (e.g. after session removed).
 */
export async function removeInvoiceWhenUnbillable(
  studentId: string,
  year: number,
  month: number,
  opts?: { includeSent?: boolean }
): Promise<boolean> {
  const billable = await getBillableTotalCHF(studentId, year, month);
  if (billable > 0) return false;

  const invoice = await prisma.invoice.findUnique({
    where: { studentId_month_year: { studentId, month, year } },
    select: { id: true, sentAt: true, paidAt: true, firstDownloadedAt: true },
  });
  if (!invoice) return false;
  // Bezahlt und heruntergeladen sind unantastbar; gesendet nur mit ausdruecklichem
  // includeSent. Die Bedingungen liegen unveraendert in lib/invoice-delivery.
  if (!isPrunableDraft(invoice, opts)) return false;

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
