import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getEffectiveManualBaseline, mergeManualBaselineSessions } from "@/lib/manual-revenue";
import { prisma } from "@/lib/prisma";
import { getSubscriptionInvoiceLines } from "@/lib/subscription-billing";
import { MANUAL_BASELINE_STUDENT_ID } from "@/lib/ui-types";

export async function GET(req: NextRequest) {
  const authSession = await auth();
  if (!authSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const year = searchParams.get("year");
  const month = searchParams.get("month");
  const studentId = searchParams.get("studentId");
  const status = searchParams.get("status");

  const invoices = await prisma.invoice.findMany({
    where: {
      ...(year ? { year: Number(year) } : {}),
      ...(month ? { month: Number(month) } : {}),
      ...(studentId ? { studentId } : {}),
      ...(status === "paid"
        ? { paidAt: { not: null } }
        : status === "sent"
          ? { sentAt: { not: null }, paidAt: null }
        : status === "created"
          ? { sentAt: null, paidAt: null, pdfPath: { not: null } }
          : status === "pending"
            ? { sentAt: null, paidAt: null, pdfPath: null }
            : {}),
    },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          subject: true,
        },
      },
    },
    orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
  });

  // For pending/all views, also expose month/student combos that have sessions
  // but no generated invoice yet, so the invoice tab is useful before first create.
  if (status === "sent" || status === "created") {
    return NextResponse.json(invoices);
  }

  const sessionRowsRaw = await prisma.session.findMany({
    where: {
      ...(year ? { year: Number(year) } : {}),
      ...(month ? { month: Number(month) } : {}),
      ...(studentId ? { studentId } : {}),
    },
    select: {
      id: true,
      studentId: true,
      year: true,
      month: true,
      amountCHF: true,
      notes: true,
      date: true,
      durationMin: true,
      calEventId: true,
      createdAt: true,
      student: {
        select: {
          id: true,
          name: true,
          subject: true,
        },
      },
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  let tutorRow: {
    manualQ1Year: number | null;
    manualQ1M1Chf: number | null;
    manualQ1M2Chf: number | null;
    manualQ1M3Chf: number | null;
  } | null = null;
  try {
    const rows = await prisma.$queryRaw<
      {
        manualQ1Year: number | null;
        manualQ1M1Chf: number | null;
        manualQ1M2Chf: number | null;
        manualQ1M3Chf: number | null;
      }[]
    >`SELECT "manualQ1Year", "manualQ1M1Chf", "manualQ1M2Chf", "manualQ1M3Chf" FROM "TutorProfile" WHERE id = 'default' LIMIT 1`;
    tutorRow = rows[0] ?? null;
  } catch {
    tutorRow = null;
  }

  const baseline = getEffectiveManualBaseline(tutorRow);
  const sessionRows = mergeManualBaselineSessions(sessionRowsRaw, { studentId, year, month }, {
    year: baseline.year,
    entries: baseline.entries,
  });

  const existingKeys = new Set(invoices.map((i) => `${i.studentId}-${i.year}-${i.month}`));
  const virtualMap = new Map<
    string,
    {
      id: string;
      studentId: string;
      year: number;
      month: number;
      totalCHF: number;
      sessionIds: string;
      sentAt: null;
      paidAt: null;
      pdfPath: null;
      invoiceNumber: null;
      isVirtual: true;
      student: { id: string; name: string; subject: string };
    }
  >();

  for (const row of sessionRows) {
    if (row.studentId === MANUAL_BASELINE_STUDENT_ID) continue;
    const key = `${row.studentId}-${row.year}-${row.month}`;
    if (existingKeys.has(key)) continue;
    if (!virtualMap.has(key)) {
      virtualMap.set(key, {
        id: `virtual-${key}`,
        studentId: row.studentId,
        year: row.year,
        month: row.month,
        totalCHF: 0,
        sessionIds: "[]",
        sentAt: null,
        paidAt: null,
        pdfPath: null,
        invoiceNumber: null,
        isVirtual: true,
        student: {
          id: row.student.id,
          name: row.student.name,
          subject: row.student.subject,
        },
      });
    }
    const current = virtualMap.get(key);
    if (current) {
      current.totalCHF += row.amountCHF;
      current.sessionIds = JSON.stringify([
        ...JSON.parse(current.sessionIds),
        row.id,
      ]);
    }
  }

  const studentIdsForSubs = Array.from(new Set(sessionRows.map((r) => r.studentId)));
  if (studentIdsForSubs.length > 0) {
    const platformSubs = await prisma.platformSubscription.findMany({
      where: { studentId: { in: studentIdsForSubs } },
      select: {
        id: true,
        studentId: true,
        amountCHF: true,
        billingMethod: true,
        durationMonths: true,
        startMonth: true,
        startYear: true,
      },
    });
    for (const v of Array.from(virtualMap.values())) {
      const lines = getSubscriptionInvoiceLines(
        platformSubs.filter((s) => s.studentId === v.studentId),
        v.year,
        v.month
      );
      v.totalCHF += lines.reduce((acc, l) => acc + l.amountCHF, 0);
    }
  }

  const realRows = invoices.map((invoice) => ({ ...invoice, isVirtual: false as const }));
  const virtualRows = Array.from(virtualMap.values());

  const merged = [...realRows, ...virtualRows].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    if (a.month !== b.month) return b.month - a.month;
    return a.student.name.localeCompare(b.student.name, "de-CH");
  });

  return NextResponse.json(merged);
}
