import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { invoiceDueDayNumber, zurichDayNumber } from "@/lib/dashboard-analytics";
import { formatFaelligkeit } from "@/lib/reminder-tokens";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const yearRaw = req.nextUrl.searchParams.get("year");
  const monthRaw = req.nextUrl.searchParams.get("month");
  const hasQuery = yearRaw !== null || monthRaw !== null;

  let year: number | null = null;
  let month: number | null = null;
  if (hasQuery) {
    year = Number(yearRaw);
    month = Number(monthRaw);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json(
        { error: "Parameter 'year' muss eine ganze Zahl zwischen 2000 und 2100 sein." },
        { status: 400 }
      );
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json(
        { error: "Parameter 'month' muss eine ganze Zahl zwischen 1 und 12 sein." },
        { status: 400 }
      );
    }
  }

  // Auswahlbare Perioden: die 12 jüngsten Monate mit irgendeiner Rechnung.
  const periodGroups = await prisma.invoice.groupBy({
    by: ["year", "month"],
    orderBy: [{ year: "desc" }, { month: "desc" }],
    take: 12,
  });
  const periods = periodGroups.map((p) => ({ year: p.year, month: p.month }));

  let invoices: {
    invoiceId: string;
    studentName: string;
    invoiceNumber: string;
    totalCHF: number;
    year: number;
    month: number;
    dueDate: string;
    daysOverdue: number;
  }[] = [];

  if (year !== null && month !== null) {
    // Gesendet, aber nicht bezahlt (schliesst Entwürfe aus: sentAt = null). Kein Status-Feld im Schema.
    const rows = await prisma.invoice.findMany({
      where: { year, month, sentAt: { not: null }, paidAt: null },
      select: {
        id: true,
        invoiceNumber: true,
        totalCHF: true,
        year: true,
        month: true,
        student: { select: { name: true } },
      },
    });

    const daysOverdue = zurichDayNumber(new Date()) - invoiceDueDayNumber(year, month);
    const dueDate = formatFaelligkeit(year, month);

    invoices = rows
      .map((r) => ({
        invoiceId: r.id,
        studentName: r.student.name,
        invoiceNumber: r.invoiceNumber,
        totalCHF: r.totalCHF,
        year: r.year,
        month: r.month,
        dueDate,
        daysOverdue,
      }))
      // Am längsten überfällig zuerst; bei Gleichstand alphabetisch für stabile Reihenfolge.
      .sort((a, b) => b.daysOverdue - a.daysOverdue || a.studentName.localeCompare(b.studentName));
  }

  return NextResponse.json({ periods, invoices });
}
