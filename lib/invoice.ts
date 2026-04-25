import { Session, Student } from "@prisma/client";
import { prisma } from "@/lib/prisma";
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

const monthFormatter = new Intl.DateTimeFormat("de-CH", { month: "long" });
const dateFormatter = new Intl.DateTimeFormat("de-CH");

export function formatDate(date: Date): string {
  return dateFormatter.format(date);
}

const chfFormatter = new Intl.NumberFormat("de-CH", {
  style: "currency",
  currency: "CHF",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatAmount(amount: number): string {
  return chfFormatter.format(amount);
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}min`;
}

export function getPeriodLabel(month: number, year: number): string {
  const monthName = monthFormatter.format(new Date(year, month - 1, 1));
  return `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} ${year}`;
}

export function getInvoiceDueDate(year: number, month: number): Date {
  // "Mid next month": always the 15th of the month after invoice period.
  return new Date(year, month, 15);
}

export function getStudentInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

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
