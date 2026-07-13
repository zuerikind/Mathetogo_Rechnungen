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

/** Ein Schüler-Abschnitt auf der Rechnung (Familienrechnung: einer pro Kind). */
export type InvoiceSection = {
  student: Pick<Student, "id" | "name" | "subject">;
  sessions: InvoiceSession[];
  subtotalCHF: number;
};

export type InvoicePayload = {
  student: Pick<Student, "id" | "name" | "email" | "subject" | "currency">;
  tutor: TutorProfileData;
  /** Alle Sessions der Rechnungsgruppe, in Abschnitts-Reihenfolge. */
  sessions: InvoiceSession[];
  /** Pro Schüler der Gruppe (Hauptschüler zuerst); Länge 1 bei Einzelrechnung. */
  sections: InvoiceSection[];
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
  const [student, children, existingInvoice, tutor] = await Promise.all([
    prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        name: true,
        email: true,
        subject: true,
        currency: true,
        billedToId: true,
        billedTo: { select: { name: true } },
      },
    }),
    prisma.student.findMany({
      where: { billedToId: studentId },
      select: { id: true, name: true, subject: true },
      orderBy: { name: "asc" },
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
  if (student.billedToId) {
    throw new Error(
      `${student.name} wird über die Rechnung von ${student.billedTo?.name ?? "einem anderen Schüler"} abgerechnet.`
    );
  }

  // Kinder mit bereits gesendeter/bezahlter Einzelrechnung für diesen Monat (z. B. vor der
  // Verknüpfung) bleiben draussen — sonst würden ihre Lektionen doppelt verrechnet.
  const childrenBilledSeparately =
    children.length > 0
      ? await prisma.invoice.findMany({
          where: {
            studentId: { in: children.map((c) => c.id) },
            year,
            month,
            NOT: { sentAt: null, paidAt: null },
          },
          select: { studentId: true },
        })
      : [];
  const excludedChildIds = new Set(childrenBilledSeparately.map((i) => i.studentId));

  const members = [
    { id: student.id, name: student.name, subject: student.subject },
    ...children.filter((c) => !excludedChildIds.has(c.id)),
  ];
  const memberIds = members.map((m) => m.id);

  const [groupSessions, subscriptions] = await Promise.all([
    prisma.session.findMany({
      where: { studentId: { in: memberIds }, year, month },
      orderBy: { date: "asc" },
      select: {
        id: true,
        studentId: true,
        date: true,
        durationMin: true,
        amountCHF: true,
        month: true,
        year: true,
      },
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

  const roundCents = (n: number) => Math.round(n * 100) / 100;
  const sections: InvoiceSection[] = members
    .map((m) => {
      const own = groupSessions.filter((s) => s.studentId === m.id);
      return {
        student: m,
        sessions: own,
        subtotalCHF: roundCents(own.reduce((acc, s) => acc + s.amountCHF, 0)),
      };
    })
    // Kinder ohne Lektionen im Monat erscheinen nicht auf der Rechnung.
    .filter((sec) => sec.student.id === student.id || sec.sessions.length > 0);

  const sessions = sections.flatMap((sec) => sec.sessions);
  const sessionsSubtotalCHF = roundCents(sessions.reduce((acc, s) => acc + s.amountCHF, 0));
  const subscriptionLines = members.flatMap((m) =>
    getSubscriptionInvoiceLines(
      subscriptions.filter((s) => s.studentId === m.id),
      year,
      month
    ).map((line) =>
      members.length > 1 ? { ...line, description: `${m.name} — ${line.description}` } : line
    )
  );
  const subscriptionTotalCHF = subscriptionLines.reduce((acc, l) => acc + l.amountCHF, 0);
  const totalCHF = roundCents(sessionsSubtotalCHF + subscriptionTotalCHF);
  const totalMinutes = sessions.reduce((acc, s) => acc + s.durationMin, 0);
  const stored = existingInvoice?.invoiceNumber?.trim();
  const provisional = `${year}-${String(month).padStart(2, "0")}-${getStudentInitials(student.name)}`;
  const invoiceNumber = stored && stored.length > 0 ? stored : provisional;

  return {
    student,
    tutor,
    sessions,
    sections,
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
  // Highest existing number + 1 (not count + 1): deleting an invoice must never
  // cause a number to be handed out twice.
  const rows = await prisma.invoice.findMany({
    where: { year, invoiceNumber: { startsWith: `${year}-` } },
    select: { invoiceNumber: true },
  });
  let max = 0;
  for (const row of rows) {
    const m = /^\d{4}-(\d{4})$/.exec(row.invoiceNumber.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${year}-${String(max + 1).padStart(4, "0")}`;
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
