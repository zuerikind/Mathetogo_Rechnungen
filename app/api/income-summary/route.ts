import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getEffectiveManualBaseline } from "@/lib/manual-revenue";
import { monthMiscEarningsTotal, ytdMiscEarningsTotal, type MiscEarningForIncome } from "@/lib/misc-earnings";
import { prisma } from "@/lib/prisma";
import { subscriptionProrationForMonth, type SubscriptionBillingInput } from "@/lib/subscription-billing";

type IncomeSummaryPayload = {
  year: number;
  month: number;
  monthIncome: number;
  ytdIncome: number;
  fromCache?: boolean;
};

const CACHE_TTL_MS = 20_000;
const summaryCache = new Map<string, { at: number; value: IncomeSummaryPayload }>();

function cacheKey(year: number, month: number) {
  return `${year}-${month}`;
}

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

  const key = cacheKey(year, month);
  const cached = summaryCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...cached.value, fromCache: true });
  }

  try {
    const [tutorRaw, subscriptionRows, miscRows] = await Promise.all([
      prisma.$queryRaw<
        {
          manualQ1Year: number | null;
          manualQ1M1Chf: number | null;
          manualQ1M2Chf: number | null;
          manualQ1M3Chf: number | null;
        }[]
      >`SELECT "manualQ1Year", "manualQ1M1Chf", "manualQ1M2Chf", "manualQ1M3Chf" FROM "TutorProfile" WHERE id = 'default' LIMIT 1`,
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
      }),
      prisma.miscEarning.findMany({
        where: { year },
        select: { year: true, month: true, amountCHF: true, source: true },
      }),
    ]);

    const baseline = getEffectiveManualBaseline(tutorRaw[0] ?? null);
    const baselineMonths =
      year === baseline.year ? new Set<number>(baseline.entries.map((e) => e.month)) : new Set<number>();
    const baselineMonthAmount = baseline.entries.find((e) => e.month === month)?.amountCHF ?? null;
    const baselineYearTotal =
      year === baseline.year ? baseline.entries.reduce((s, e) => s + e.amountCHF, 0) : 0;

    const [monthAgg, nonBaselineYearAgg] = await Promise.all([
      baselineMonths.has(month)
        ? Promise.resolve({ _sum: { amountCHF: 0 as number | null } })
        : prisma.session.aggregate({
            where: { year, month },
            _sum: { amountCHF: true },
          }),
      prisma.session.aggregate({
        where: {
          year,
          ...(baselineMonths.size > 0 ? { month: { notIn: Array.from(baselineMonths) } } : {}),
        },
        _sum: { amountCHF: true },
      }),
    ]);

    const subscriptions: SubscriptionBillingInput[] = subscriptionRows.map((s) => ({
      id: s.id,
      studentId: s.studentId,
      amountCHF: s.amountCHF,
      billingMethod: s.billingMethod,
      durationMonths: s.durationMonths,
      startMonth: s.startMonth,
      startYear: s.startYear,
    }));
    const miscEarnings: MiscEarningForIncome[] = miscRows.map((r) => ({
      year: r.year,
      month: r.month,
      amountCHF: r.amountCHF,
      source: r.source === "q1_adjustment" ? "q1_adjustment" : "manual",
    }));

    const sessionMonthIncome = baselineMonthAmount ?? (monthAgg._sum.amountCHF ?? 0);
    const sessionYtdIncome = baselineYearTotal + (nonBaselineYearAgg._sum.amountCHF ?? 0);
    const monthSubscription = baselineMonths.has(month)
      ? 0
      : subscriptionProrationForMonth(subscriptions, year, month);
    let ytdSubscription = 0;
    for (let m = 1; m <= 12; m += 1) {
      if (baselineMonths.has(m)) continue;
      ytdSubscription += subscriptionProrationForMonth(subscriptions, year, m);
    }
    const monthMisc = monthMiscEarningsTotal(miscEarnings, year, month, {
      includeQ1Adjustment: !baselineMonths.has(month),
    });
    const ytdMisc = ytdMiscEarningsTotal(miscEarnings, year, {
      excludeQ1AdjustmentMonths: baselineMonths,
    });

    const value: IncomeSummaryPayload = {
      year,
      month,
      monthIncome: sessionMonthIncome + monthSubscription + monthMisc,
      ytdIncome: sessionYtdIncome + ytdSubscription + ytdMisc,
    };
    summaryCache.set(key, { at: Date.now(), value });
    return NextResponse.json(value);
  } catch {
    // If DB is temporarily unstable, serve stale cache instead of 500.
    if (cached) {
      return NextResponse.json({ ...cached.value, fromCache: true });
    }
    return NextResponse.json(
      { year, month, monthIncome: 0, ytdIncome: 0, error: "Database temporarily unavailable" },
      { status: 503 }
    );
  }
}
