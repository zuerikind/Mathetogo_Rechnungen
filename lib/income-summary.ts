import { subscriptionProrationForMonth, type SubscriptionBillingInput } from "@/lib/subscription-billing";
import {
  monthMiscEarningsTotal,
  type MiscEarningForIncome,
  ytdMiscEarningsTotal,
} from "@/lib/misc-earnings";
import { isManualBaselineSession, type SessionWithStudent } from "@/lib/ui-types";

function manualOverrideMonths(sessions: SessionWithStudent[]): Set<number> {
  const out = new Set<number>();
  for (const s of sessions) {
    if (isManualBaselineSession(s)) out.add(s.month);
  }
  return out;
}

export function computeMonthIncome(
  sessions: SessionWithStudent[],
  subscriptions: SubscriptionBillingInput[],
  miscEarnings: MiscEarningForIncome[],
  year: number,
  month: number
): number {
  const monthSessions = sessions.filter((s) => s.month === month);
  const sessionIncome = monthSessions.reduce((acc, s) => acc + s.amountCHF, 0);
  const hasManualOverride = monthSessions.some((s) => isManualBaselineSession(s));
  const subIncome = hasManualOverride ? 0 : subscriptionProrationForMonth(subscriptions, year, month);
  const miscIncome = monthMiscEarningsTotal(miscEarnings, year, month, {
    includeQ1Adjustment: !hasManualOverride,
  });
  return sessionIncome + subIncome + miscIncome;
}

export function computeYtdIncome(
  sessions: SessionWithStudent[],
  subscriptions: SubscriptionBillingInput[],
  miscEarnings: MiscEarningForIncome[],
  year: number
): number {
  const sessionIncome = sessions.reduce((acc, s) => acc + s.amountCHF, 0);
  const manualMonths = manualOverrideMonths(sessions);
  let subscriptionIncome = 0;
  for (let m = 1; m <= 12; m += 1) {
    if (manualMonths.has(m)) continue;
    subscriptionIncome += subscriptionProrationForMonth(subscriptions, year, m);
  }
  const miscIncome = ytdMiscEarningsTotal(miscEarnings, year, {
    excludeQ1AdjustmentMonths: manualMonths,
  });
  return sessionIncome + subscriptionIncome + miscIncome;
}
