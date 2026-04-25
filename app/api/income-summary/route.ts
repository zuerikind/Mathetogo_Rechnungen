import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { computeMonthIncome, computeYtdIncome } from "@/lib/income-summary";
import { getEffectiveManualBaseline, mergeManualBaselineSessions } from "@/lib/manual-revenue";
import type { MiscEarningForIncome } from "@/lib/misc-earnings";
import { prisma } from "@/lib/prisma";
import type { SubscriptionBillingInput } from "@/lib/subscription-billing";
import type { SessionWithStudent } from "@/lib/ui-types";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const yParam = req.nextUrl.searchParams.get("year");
  const mParam = req.nextUrl.searchParams.get("month");
  const yearParsed = Number(yParam);
  const year =
    Number.isFinite(yearParsed) && yearParsed >= 2000 && yearParsed <= 2100
      ? Math.floor(yearParsed)
      : now.getFullYear();
  const monthParsed = Number(mParam);
  const month =
    Number.isFinite(monthParsed) && monthParsed >= 1 && monthParsed <= 12
      ? Math.floor(monthParsed)
      : now.getMonth() + 1;

  const [dbSessions, subscriptionRows] = await Promise.all([
    prisma.session.findMany({
      where: { year },
      select: {
        id: true,
        studentId: true,
        date: true,
        durationMin: true,
        amountCHF: true,
        month: true,
        year: true,
        notes: true,
      },
      orderBy: { date: "desc" },
    }),
    prisma.platformSubscription.findMany({
      select: {
        id: true,
        studentId: true,
        amountCHF: true,
        billingMethod: true,
        durationMonths: true,
        startMonth: true,
        startYear: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

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
  const sessionLikes = dbSessions.map((s) => ({
    id: s.id,
    studentId: s.studentId,
    date: s.date,
    durationMin: s.durationMin,
    amountCHF: s.amountCHF,
    calEventId: null,
    month: s.month,
    year: s.year,
    notes: s.notes,
    createdAt: s.date,
    student: null,
  }));

  const merged = mergeManualBaselineSessions(sessionLikes, { studentId: null, year: String(year), month: null }, {
    year: baseline.year,
    entries: baseline.entries,
  });

  const forIncome: SessionWithStudent[] = merged.map((s) => ({
    id: s.id,
    studentId: s.studentId,
    date: s.date.toISOString(),
    durationMin: s.durationMin,
    amountCHF: s.amountCHF,
    month: s.month,
    year: s.year,
    notes: s.notes,
    student: s.student ?? undefined,
  }));

  const subscriptions: SubscriptionBillingInput[] = subscriptionRows.map((s) => ({
    id: s.id,
    studentId: s.studentId,
    amountCHF: s.amountCHF,
    billingMethod: s.billingMethod,
    durationMonths: s.durationMonths,
    startMonth: s.startMonth,
    startYear: s.startYear,
  }));

  let miscEarnings: MiscEarningForIncome[] = [];
  try {
    const miscRows = await prisma.miscEarning.findMany({
      where: { year },
      select: { year: true, month: true, amountCHF: true, source: true },
    });
    miscEarnings = miscRows.map((r) => ({
      year: r.year,
      month: r.month,
      amountCHF: r.amountCHF,
      source: r.source === "q1_adjustment" ? "q1_adjustment" : "manual",
    }));
  } catch {
    miscEarnings = [];
  }

  const monthIncome = computeMonthIncome(forIncome, subscriptions, miscEarnings, year, month);
  const ytdIncome = computeYtdIncome(forIncome, subscriptions, miscEarnings, year);

  return NextResponse.json({ year, month, monthIncome, ytdIncome });
}
