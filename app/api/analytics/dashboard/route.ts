import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * Read-only Datenquelle für die Dashboard-Analysen.
 * Ausschliesslich findMany/groupBy — es wird nichts geschrieben, geprunt oder aktualisiert.
 */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const since = new Date(Date.now() - 370 * 86_400_000);

  const [students, sessions, invoices, extents, monthCoverage] = await Promise.all([
    prisma.student.findMany({
      select: { id: true, name: true, active: true, ratePerMin: true, billedToId: true },
    }),
    prisma.session.findMany({
      where: { date: { gte: since } },
      select: {
        id: true,
        studentId: true,
        date: true,
        durationMin: true,
        amountCHF: true,
        notes: true,
      },
      orderBy: { date: "asc" },
    }),
    prisma.invoice.findMany({
      where: { NOT: { sentAt: null, paidAt: null } },
      select: {
        id: true,
        studentId: true,
        year: true,
        month: true,
        totalCHF: true,
        sentAt: true,
        paidAt: true,
        student: { select: { name: true } },
      },
    }),
    prisma.session.groupBy({
      by: ["studentId"],
      _min: { date: true },
      _max: { date: true },
      _count: { _all: true },
    }),
    prisma.session.groupBy({
      by: ["year", "month"],
      _count: { _all: true },
      _sum: { amountCHF: true },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    }),
  ]);

  return NextResponse.json({
    students,
    sessions,
    invoices: invoices.map((i) => ({
      id: i.id,
      studentId: i.studentId,
      year: i.year,
      month: i.month,
      totalCHF: i.totalCHF,
      sentAt: i.sentAt,
      paidAt: i.paidAt,
      studentName: i.student.name,
    })),
    extents: extents.map((e) => ({
      studentId: e.studentId,
      firstSession: e._min.date,
      lastSession: e._max.date,
      sessionCount: e._count._all,
    })),
    monthCoverage: monthCoverage.map((c) => ({
      year: c.year,
      month: c.month,
      sessionCount: c._count._all,
      amountCHF: c._sum.amountCHF ?? 0,
    })),
  });
}
