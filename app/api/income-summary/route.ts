import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  monthAdditionalEarningsTotal,
  ytdAdditionalEarningsTotal,
  type AdditionalEarningForIncome,
} from "@/lib/additional-earnings";
import { monthDanceEarningsTotal, ytdDanceEarningsTotal, type DanceEarningForIncome } from "@/lib/dance-earnings";
import {
  getEffectiveManualBaseline,
  manualBaselineAmountFor,
  manualBaselineMonths,
  manualBaselineTotalThrough,
  MANUAL_Q1_SELECT,
} from "@/lib/manual-revenue";
import { monthMiscEarningsTotal, ytdMiscEarningsTotal, type MiscEarningForIncome } from "@/lib/misc-earnings";
import {
  getFreshIncomeSummary,
  getStaleIncomeSummary,
  setIncomeSummary,
  type IncomeSummaryPayload,
} from "@/lib/income-summary-cache";
import { prisma } from "@/lib/prisma";
import { subscriptionProrationForMonth, type SubscriptionBillingInput } from "@/lib/subscription-billing";
import { ACTIVE_SESSION_WHERE } from "@/lib/calendar-cancellation";

function isMissingTableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2021"
  );
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

  const cached = getFreshIncomeSummary(year, month);
  if (cached) {
    return NextResponse.json({ ...cached, fromCache: true });
  }

  try {
    const [tutorRow, subscriptionRows, miscRows, danceRows, additionalRows] = await Promise.all([
      prisma.tutorProfile.findUnique({ where: { id: "default" }, select: MANUAL_Q1_SELECT }),
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
      prisma.danceEarning
        .findMany({
          where: { year },
          select: { year: true, month: true, amountCHF: true },
        })
        .catch((err) => {
          if (isMissingTableError(err)) return [];
          throw err;
        }),
      prisma.additionalEarning
        .findMany({
          where: { year },
          select: { year: true, month: true, amountCHF: true },
        })
        .catch((err) => {
          if (isMissingTableError(err)) return [];
          throw err;
        }),
    ]);

    const baseline = getEffectiveManualBaseline(tutorRow);
    // Alle drei Groessen teilen dieselbe Jahresprüfung (lib/manual-revenue) — genau
    // die fehlte beim Monatsbetrag und liess die 2026er-Q1-Summe in andere Jahre laufen.
    const baselineMonths = manualBaselineMonths(baseline, year);
    const baselineMonthAmount = manualBaselineAmountFor(baseline, year, month);
    // YTD = only through the selected month; planned future lessons don't count.
    const baselineYearTotal = manualBaselineTotalThrough(baseline, year, month);

    const [monthAgg, nonBaselineYearAgg] = await Promise.all([
      baselineMonths.has(month)
        ? Promise.resolve({ _sum: { amountCHF: 0 as number | null } })
        : prisma.session.aggregate({
            where: { year, month, ...ACTIVE_SESSION_WHERE },
            _sum: { amountCHF: true },
          }),
      prisma.session.aggregate({
        where: {
          ...ACTIVE_SESSION_WHERE,
          year,
          month: {
            lte: month,
            ...(baselineMonths.size > 0 ? { notIn: Array.from(baselineMonths) } : {}),
          },
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
    const danceEarnings: DanceEarningForIncome[] = danceRows.map((r) => ({
      year: r.year,
      month: r.month,
      amountCHF: r.amountCHF,
    }));
    const additionalEarnings: AdditionalEarningForIncome[] = additionalRows.map((r) => ({
      id: "",
      year: r.year,
      month: r.month,
      name: "",
      amountCHF: r.amountCHF,
    }));

    const sessionMonthIncome = baselineMonthAmount ?? (monthAgg._sum.amountCHF ?? 0);
    const sessionYtdIncome = baselineYearTotal + (nonBaselineYearAgg._sum.amountCHF ?? 0);
    const monthSubscription = baselineMonths.has(month)
      ? 0
      : subscriptionProrationForMonth(subscriptions, year, month);
    let ytdSubscription = 0;
    for (let m = 1; m <= month; m += 1) {
      if (baselineMonths.has(m)) continue;
      ytdSubscription += subscriptionProrationForMonth(subscriptions, year, m);
    }
    const monthMisc = monthMiscEarningsTotal(miscEarnings, year, month, {
      includeQ1Adjustment: !baselineMonths.has(month),
    });
    const ytdMisc = ytdMiscEarningsTotal(miscEarnings, year, {
      excludeQ1AdjustmentMonths: baselineMonths,
      throughMonth: month,
    });
    const monthDance = monthDanceEarningsTotal(danceEarnings, year, month);
    const ytdDance = ytdDanceEarningsTotal(danceEarnings, year, month);
    const monthAdditional = monthAdditionalEarningsTotal(additionalEarnings, year, month);
    const ytdAdditional = ytdAdditionalEarningsTotal(additionalEarnings, year, month);

    const value: IncomeSummaryPayload = {
      year,
      month,
      monthIncome:
        sessionMonthIncome + monthSubscription + monthMisc + monthDance + monthAdditional,
      ytdIncome: sessionYtdIncome + ytdSubscription + ytdMisc + ytdDance + ytdAdditional,
    };
    setIncomeSummary(year, month, value);
    return NextResponse.json(value);
  } catch {
    // If DB is temporarily unstable, serve stale cache instead of 500.
    const stale = getStaleIncomeSummary(year, month);
    if (stale) {
      return NextResponse.json({ ...stale, fromCache: true });
    }
    return NextResponse.json(
      { year, month, monthIncome: 0, ytdIncome: 0, error: "Database temporarily unavailable" },
      { status: 503 }
    );
  }
}
