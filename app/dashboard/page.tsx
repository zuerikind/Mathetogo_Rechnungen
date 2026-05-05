"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { useGlobalIncomeSummary } from "@/hooks/useGlobalIncomeSummary";
import { MonthlyChart } from "@/components/MonthlyChart";
import { SessionTable, type SubscriptionAnalysisTableRow } from "@/components/SessionTable";
import { StatCard } from "@/components/StatCard";
import { StudentBreakdown } from "@/components/StudentBreakdown";
import { SyncButton } from "@/components/SyncButton";
import {
  formatCHF,
  formatDuration,
  getCurrentMonthYear,
  monthOptions,
  normStudentDisplayName,
} from "@/lib/ui-format";
import { getChargeMonths } from "@/lib/month-math";
import {
  computeMonthIncome,
  computeYtdIncome,
} from "@/lib/income-summary";
import type { DanceEarningForIncome } from "@/lib/dance-earnings";
import { monthDanceEarningsTotal, ytdDanceEarningsTotal } from "@/lib/dance-earnings";
import type { MiscEarningForIncome } from "@/lib/misc-earnings";
import {
  subscriptionProrationByStudentForMonth,
  type SubscriptionBillingInput,
} from "@/lib/subscription-billing";
import {
  isManualBaselineSession,
  type SessionWithStudent,
  type SyncResponse,
} from "@/lib/ui-types";

type SubscriptionAnalyticsRow = SubscriptionBillingInput & {
  student?: { name: string; subject: string };
};
type SettingsIncomePayload = {
  miscEarnings?: MiscEarningForIncome[];
};

function calcStats(sessions: SessionWithStudent[]) {
  const income = sessions.reduce((s, r) => s + r.amountCHF, 0);
  const nonManual = sessions.filter((s) => !isManualBaselineSession(s));
  const minutes = nonManual.reduce((s, r) => s + r.durationMin, 0);
  const students = new Set(nonManual.map((s) => s.studentId)).size;
  return { income, minutes, hours: minutes / 60, students, avgPerHour: minutes === 0 ? 0 : (income / minutes) * 60 };
}

function trend(current: number, prev: number): number | undefined {
  if (prev === 0) return undefined;
  return ((current - prev) / prev) * 100;
}

function medianPerHour(rows: SessionWithStudent[]): number {
  const hourlyRates = rows
    .filter((r) => r.durationMin > 0)
    .map((r) => (r.amountCHF / r.durationMin) * 60)
    .sort((a, b) => a - b);

  if (hourlyRates.length === 0) return 0;
  const mid = Math.floor(hourlyRates.length / 2);
  return hourlyRates.length % 2 === 0
    ? (hourlyRates[mid - 1] + hourlyRates[mid]) / 2
    : hourlyRates[mid];
}

export default function DashboardPage() {
  const { monthIncome: globalMonthIncome, ytdIncome: globalYtdIncome, loading: globalIncomeLoading } =
    useGlobalIncomeSummary();
  const now = getCurrentMonthYear();

  // ── Diagram / KPI filter (independent) ──────────────────────────────
  const [month, setMonth] = useState(now.month);       // KPI month filter
  const [year, setYear] = useState(now.year);           // chart year

  // ── Sync target (independent) ────────────────────────────────────────
  const [syncMonth, setSyncMonth] = useState(now.month);
  const [syncYear, setSyncYear] = useState(now.year);

  // ── Data ─────────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<SessionWithStudent[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionAnalyticsRow[]>([]);
  const [miscEarnings, setMiscEarnings] = useState<MiscEarningForIncome[]>([]);
  const [danceEarnings, setDanceEarnings] = useState<DanceEarningForIncome[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);

  const availableYears = useMemo(() => { const y = now.year; return [y - 2, y - 1, y, y + 1]; }, [now.year]);

  const loadSessions = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true); else setRefreshing(true);
      setError("");
      const [res, subRes, settingsRes, danceRes] = await Promise.all([
        fetch(`/api/sessions?year=${year}`),
        fetch(`/api/subscriptions/analytics?year=${year}`),
        fetch(`/api/settings?miscYear=${year}`),
        fetch(`/api/dance-earnings?year=${year}`),
      ]);
      if (!res.ok) throw new Error();
      setSessions((await res.json()) as SessionWithStudent[]);
      if (subRes.ok) {
        const body = (await subRes.json()) as { subscriptions?: SubscriptionAnalyticsRow[] };
        setSubscriptions(Array.isArray(body.subscriptions) ? body.subscriptions : []);
      } else {
        setSubscriptions([]);
      }
      if (settingsRes.ok) {
        const settingsBody = (await settingsRes.json()) as SettingsIncomePayload;
        setMiscEarnings(Array.isArray(settingsBody.miscEarnings) ? settingsBody.miscEarnings : []);
      } else {
        setMiscEarnings([]);
      }
      if (danceRes.ok) {
        const danceBody = (await danceRes.json()) as { rows?: DanceEarningForIncome[] };
        setDanceEarnings(Array.isArray(danceBody.rows) ? danceBody.rows : []);
      } else {
        setDanceEarnings([]);
      }
    } catch {
      setError("Fehler beim Laden der Daten.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [year]);

  const isInitialLoad = useRef(true);
  useEffect(() => {
    const initial = isInitialLoad.current;
    isInitialLoad.current = false;
    void loadSessions(initial);
  }, [loadSessions]);
  useEffect(() => { setSelectedMonth(null); setSelectedStudent(null); }, [year]);

  const subscriptionBilling = useMemo<SubscriptionBillingInput[]>(
    () =>
      subscriptions.map((s) => ({
        id: s.id,
        studentId: s.studentId,
        amountCHF: s.amountCHF,
        billingMethod: s.billingMethod,
        durationMonths: s.durationMonths,
        startMonth: s.startMonth,
        startYear: s.startYear,
      })),
    [subscriptions]
  );

  const realSessions = useMemo(
    () => sessions.filter((s) => !isManualBaselineSession(s)),
    [sessions]
  );
  const manualOverrideMonths = useMemo(() => {
    const set = new Set<number>();
    for (const s of sessions) {
      if (isManualBaselineSession(s)) set.add(s.month);
    }
    return set;
  }, [sessions]);
  const isManualOverrideMonth = useCallback(
    (m: number) => manualOverrideMonths.has(m),
    [manualOverrideMonths]
  );
  const currentMonthSessions = useMemo(() => sessions.filter((s) => s.month === month), [sessions, month]);
  const currentMonthRealSessions = useMemo(
    () => realSessions.filter((s) => s.month === month),
    [realSessions, month]
  );
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevMonthSessions = useMemo(() => sessions.filter((s) => s.month === prevMonth), [sessions, prevMonth]);
  const currentStats = useMemo(() => {
    const base = calcStats(currentMonthSessions);
    const income = computeMonthIncome(currentMonthSessions, subscriptionBilling, miscEarnings, danceEarnings, year, month);
    return { ...base, income };
  }, [currentMonthSessions, subscriptionBilling, miscEarnings, danceEarnings, year, month]);
  const prevStats = useMemo(() => {
    const base = calcStats(prevMonthSessions);
    const income = computeMonthIncome(prevMonthSessions, subscriptionBilling, miscEarnings, danceEarnings, year, prevMonth);
    return { ...base, income };
  }, [prevMonthSessions, subscriptionBilling, miscEarnings, danceEarnings, year, prevMonth]);
  const ytdIncome = useMemo(
    () => computeYtdIncome(sessions, subscriptionBilling, miscEarnings, danceEarnings, year, month),
    [sessions, subscriptionBilling, miscEarnings, danceEarnings, year, month]
  );
  const monthDanceIncome = useMemo(
    () => monthDanceEarningsTotal(danceEarnings, year, month),
    [danceEarnings, year, month]
  );
  const ytdDanceIncome = useMemo(
    () => ytdDanceEarningsTotal(danceEarnings, year),
    [danceEarnings, year]
  );

  const chartData = useMemo(() =>
    monthOptions.map((m) => {
      const ms = sessions.filter((s) => s.month === m.value);
      const realMs = ms.filter((s) => !isManualBaselineSession(s));
      return {
        month: m.value,
        label: m.label.slice(0, 3),
        income: computeMonthIncome(sessions, subscriptionBilling, miscEarnings, danceEarnings, year, m.value),
        danceIncome: monthDanceEarningsTotal(danceEarnings, year, m.value),
        teachingIncome:
          computeMonthIncome(sessions, subscriptionBilling, miscEarnings, danceEarnings, year, m.value) -
          monthDanceEarningsTotal(danceEarnings, year, m.value),
        sessions: realMs.length,
        hours: realMs.reduce((s, r) => s + r.durationMin, 0) / 60,
        medianPerHour: medianPerHour(realMs),
      };
    }),
  [sessions, subscriptionBilling, miscEarnings, danceEarnings, year]);

  const breakdownSessions = useMemo(
    () =>
      selectedMonth !== null
        ? realSessions.filter((s) => s.month === selectedMonth)
        : currentMonthRealSessions,
    [realSessions, selectedMonth, currentMonthRealSessions]
  );

  const tableSessions = useMemo(() => {
    let s =
      selectedMonth !== null
        ? realSessions.filter((r) => r.month === selectedMonth)
        : currentMonthRealSessions;
    if (selectedStudent) {
      const target = normStudentDisplayName(selectedStudent);
      s = s.filter((r) => normStudentDisplayName(r.student?.name) === target);
    }
    return s;
  }, [realSessions, selectedMonth, currentMonthRealSessions, selectedStudent]);

  /**
   * Gleiche Logik wie Diagramm / Schüler-Balken: voller Monatsbetrag für jeden
   * Abo-Monat im gewählten Kalendermonat — Rechnung und Ueberweisung.
   */
  const tableSubscriptionAnalysisRows = useMemo(() => {
    const viewMonth = selectedMonth !== null ? selectedMonth : month;
    const subsScoped = selectedStudent
      ? subscriptions.filter(
          (s) => normStudentDisplayName(s.student?.name) === normStudentDisplayName(selectedStudent)
        )
      : subscriptions;
    if (isManualOverrideMonth(viewMonth)) {
      return [];
    }

    const rows: SubscriptionAnalysisTableRow[] = [];
    for (const raw of subsScoped) {
      const months = getChargeMonths(raw.startMonth, raw.startYear, raw.durationMonths);
      if (!months.some((m) => m.year === year && m.month === viewMonth)) continue;
      const part = raw.amountCHF;
      const label =
        raw.billingMethod === "direct"
          ? "Mathetogo Abonnement (Ueberweisung, Monatsbetrag)"
          : "Mathetogo Abonnement (Rechnung, Monatsbetrag)";
      rows.push({
        id: `sub-abo-${raw.id}-${year}-${viewMonth}`,
        date: new Date(year, viewMonth - 1, 1).toISOString(),
        studentName: normStudentDisplayName(raw.student?.name),
        studentSubject: raw.student?.subject ?? "",
        month: viewMonth,
        year,
        amountCHF: part,
        label,
      });
    }
    return rows;
  }, [subscriptions, selectedStudent, year, month, selectedMonth, isManualOverrideMonth]);

  const breakdownMonth = selectedMonth !== null ? selectedMonth : month;
  const subscriptionIncomeByName = useMemo(() => {
    if (isManualOverrideMonth(breakdownMonth)) {
      return {};
    }
    const byId = subscriptionProrationByStudentForMonth(
      subscriptionBilling,
      year,
      breakdownMonth
    );
    const idToName = new Map<string, string>();
    for (const s of subscriptions) {
      idToName.set(s.studentId, normStudentDisplayName(s.student?.name));
    }
    const names: Record<string, number> = {};
    for (const [studentId, amt] of Object.entries(byId)) {
      if (amt === 0) continue;
      const n = idToName.get(studentId) ?? "Unbekannt";
      names[n] = (names[n] ?? 0) + amt;
    }
    return names;
  }, [subscriptionBilling, subscriptions, year, breakdownMonth, isManualOverrideMonth]);

  const handleSynced = (result: SyncResponse) => {
    const parts = [`${result.synced} Sessions synchronisiert`];
    if (result.unmatched.length > 0) parts.push(`${result.unmatched.length} nicht zugeordnet: ${result.unmatched.join(", ")}`);
    setToast(parts.join(" · "));
    void loadSessions();
    setTimeout(() => setToast(""), 8000);
  };

  const selectClass =
    "rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 outline-none transition focus:border-[#4A7FC1] focus:ring-2 focus:ring-[#4A7FC1]/20";

  return (
    <DashboardShell
      monthIncome={globalMonthIncome}
      ytdIncome={globalYtdIncome}
      incomeLoading={globalIncomeLoading || loading || refreshing}
    >
      <div className="min-w-0 space-y-5">

        {/* Page header */}
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
          {refreshing && (
            <span className="h-4 w-4 rounded-full border-2 border-[#4A7FC1] border-t-transparent animate-spin" />
          )}
        </div>

        {/* Sync bar — has its own independent month + year */}
        <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Kalender synchronisieren</p>
          <div className="flex flex-wrap items-end gap-3 sm:gap-4">

            {/* Sync month */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Monat</label>
              <select
                value={syncMonth}
                onChange={(e) => setSyncMonth(Number(e.target.value))}
                className={selectClass}
              >
                {monthOptions.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            {/* Sync year */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Jahr</label>
              <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => setSyncYear((y) => y - 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition hover:bg-white hover:text-[#4A7FC1]"
                >
                  ‹
                </button>
                <span className="min-w-[3.5rem] text-center text-sm font-semibold text-gray-800">{syncYear}</span>
                <button
                  type="button"
                  onClick={() => setSyncYear((y) => y + 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition hover:bg-white hover:text-[#4A7FC1]"
                >
                  ›
                </button>
              </div>
            </div>

            {/* Sync button */}
            <div className="flex flex-col gap-1">
              <span className="select-none text-[10px] text-transparent">x</span>
              <SyncButton year={syncYear} month={syncMonth} onSynced={handleSynced} />
            </div>

            {toast && (
              <span className="max-w-full self-end break-words rounded-xl bg-[#EBF4FF] px-3 py-1.5 text-sm font-medium text-[#4A7FC1] sm:max-w-[min(100%,28rem)]">{toast}</span>
            )}
          </div>
        </div>

        {error ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <button onClick={() => void loadSessions()} className="underline font-medium">Erneut versuchen</button>
          </div>
        ) : loading ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl border border-blue-100 bg-white" />
            ))}
          </div>
        ) : (
          <>
            {/* KPI Cards — driven by `month` filter */}
            <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
              <div className="min-w-0">
                <StatCard label="Einkommen (Monat)" value={formatCHF(currentStats.income)} subValue={`${currentMonthRealSessions.length} Sessions`} trend={trend(currentStats.income, prevStats.income)} trendLabel="Vormonat" />
              </div>
              <div className="min-w-0">
                <StatCard label="Jahreseinkommen" value={formatCHF(ytdIncome)} subValue={`${realSessions.length} Sessions total`} accent="lilac" />
              </div>
              <div className="min-w-0">
                <StatCard label="Stunden (Monat)" value={`${currentStats.hours.toFixed(1)}h`} subValue={formatDuration(currentStats.minutes)} trend={trend(currentStats.hours, prevStats.hours)} trendLabel="Vormonat" />
              </div>
              <div className="min-w-0">
                <StatCard label="Aktive Schüler" value={String(currentStats.students)} subValue={`Ø ${formatCHF(currentStats.avgPerHour)} / h`} trend={trend(currentStats.students, prevStats.students)} trendLabel="Vormonat" accent="lilac" />
              </div>
              <div className="min-w-0">
                <StatCard
                  label="Dance Income"
                  value={formatCHF(monthDanceIncome)}
                  subValue={`YTD: ${formatCHF(ytdDanceIncome)}`}
                  accent="rose"
                />
              </div>
            </section>

            {/* Charts — year + month filters together */}
            <section className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <h2 className="text-sm font-semibold text-gray-700">Jahresübersicht</h2>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {/* Month filter */}
                  <select
                    value={month}
                    onChange={(e) => { setMonth(Number(e.target.value)); setSelectedMonth(null); }}
                    className={selectClass}
                  >
                    {monthOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>

                  {/* Divider */}
                  <span className="text-gray-200">|</span>

                  {/* Year buttons */}
                  {availableYears.map((y) => (
                    <button
                      key={y}
                      onClick={() => setYear(y)}
                      className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                        year === y
                          ? "bg-[#4A7FC1] text-white shadow-sm"
                          : "border border-gray-200 bg-gray-50 text-gray-600 hover:border-[#4A7FC1] hover:text-[#4A7FC1]"
                      }`}
                    >
                      {y}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="min-w-0">
                  <MonthlyChart data={chartData} selectedMonth={selectedMonth} onMonthSelect={setSelectedMonth} />
                </div>
                <div className="min-w-0">
                  <StudentBreakdown
                    sessions={breakdownSessions}
                    subscriptionIncomeByName={subscriptionIncomeByName}
                    selectedStudent={selectedStudent}
                    onStudentSelect={setSelectedStudent}
                  />
                </div>
              </div>
            </section>

            {/* Sessions table */}
            <section className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="min-w-0 text-sm font-semibold text-gray-900">
                  Sessions
                  {selectedMonth !== null && (
                    <span className="ml-1.5 font-normal text-[#4A7FC1]">
                      · {monthOptions.find((m) => m.value === selectedMonth)?.label}
                    </span>
                  )}
                  {selectedStudent && (
                    <span className="ml-1.5 font-normal text-[#4A7FC1]">
                      · {normStudentDisplayName(selectedStudent)}
                    </span>
                  )}
                </h2>
                {(selectedMonth !== null || selectedStudent) && (
                  <button
                    onClick={() => { setSelectedMonth(null); setSelectedStudent(null); }}
                    className="shrink-0 self-start rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-400 transition hover:border-gray-300 hover:text-gray-600 sm:self-auto"
                  >
                    Filter zurücksetzen ✕
                  </button>
                )}
              </div>
              <SessionTable
                sessions={tableSessions}
                studentFilter={selectedStudent ?? undefined}
                subscriptionAnalysisRows={tableSubscriptionAnalysisRows}
              />
            </section>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
