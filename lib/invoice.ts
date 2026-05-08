import "server-only";
import { Session, Student } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  formatAmount,
  formatDate,
  formatDuration,
  getInvoiceDueDate,
  getPeriodLabel,
  getStudentInitials,
} from "@/lib/invoice-format";
import { getTutorProfile, TutorProfileData } from "@/lib/tutor-profile";
import { getSubscriptionInvoiceLines } from "@/lib/subscription-billing";

export type InvoiceSession = Pick<
  Session,
  "id" | "date" | "durationMin" | "amountCHF" | "month" | "year"
>;

export type InvoiceSubscriptionLine = {
  id: string;
  description: string;
  amountCHF: number;
};

export type InvoicePayload = {
  student: Pick<Student, "id" | "name" | "email" | "subject" | "currency">;
  tutor: TutorProfileData;
  sessions: InvoiceSession[];
  /** Nachhilfe-Sessions only (excludes Abo on invoice). */
  sessionsSubtotalCHF: number;
  /** Rechnung-Abo: full amount on Abo-Startmonat; Überweisung omitted. */
  subscriptionLines: InvoiceSubscriptionLine[];
  year: number;
  month: number;
  periodLabel: string;
  totalCHF: number;
  totalMinutes: number;
  invoiceNumber: string;
};

export { formatAmount, formatDate, formatDuration, getInvoiceDueDate, getPeriodLabel };

export async function getInvoicePayload(
  studentId: string,
  year: number,
  month: number
): Promise<InvoicePayload> {
  const [student, sessions, subscriptions, existingInvoice, tutor] = await Promise.all([
    prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        name: true,
        email: true,
        subject: true,
        currency: true,
      },
    }),
    prisma.session.findMany({
      where: { studentId, year, month },
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        durationMin: true,
        amountCHF: true,
        month: true,
        year: true,
      },
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
    prisma.invoice.findUnique({
      where: { studentId_month_year: { studentId, month, year } },
      select: { invoiceNumber: true },
    }),
    getTutorProfile(),
  ]);

  if (!student) {
    throw new Error("Schüler nicht gefunden");
  }

  const sessionsSubtotalCHF = sessions.reduce((acc, s) => acc + s.amountCHF, 0);
  const subscriptionLines = getSubscriptionInvoiceLines(subscriptions, year, month);
  const subscriptionTotalCHF = subscriptionLines.reduce((acc, l) => acc + l.amountCHF, 0);
  const totalCHF = sessionsSubtotalCHF + subscriptionTotalCHF;
  const totalMinutes = sessions.reduce((acc, s) => acc + s.durationMin, 0);
  const stored = existingInvoice?.invoiceNumber?.trim();
  const provisional = `${year}-${String(month).padStart(2, "0")}-${getStudentInitials(student.name)}`;
  const invoiceNumber = stored && stored.length > 0 ? stored : provisional;

  return {
    student,
    tutor,
    sessions,
    sessionsSubtotalCHF,
    subscriptionLines,
    year,
    month,
    periodLabel: getPeriodLabel(month, year),
    totalCHF,
    totalMinutes,
    invoiceNumber,
  };
}

export async function getNextInvoiceNumber(year: number): Promise<string> {
  const count = await prisma.invoice.count({ where: { year } });
  return `${year}-${String(count + 1).padStart(4, "0")}`;
}

/** Safe ASCII-ish basename for downloads, e.g. `aiyana_04_2026.pdf` */
export function getInvoicePdfDownloadBaseName(studentName: string, month: number, year: number): string {
  const mm = String(month).padStart(2, "0");
  const slug = studentName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
  const base = slug.length > 0 ? `${slug}_${mm}_${year}` : `rechnung_${mm}_${year}`;
  return `${base}.pdf`;
}
