"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { MonthlyChart } from "@/components/MonthlyChart";
import { SessionTable } from "@/components/SessionTable";
import { StatCard } from "@/components/StatCard";
import { StudentBreakdown } from "@/components/StudentBreakdown";
import { SyncButton } from "@/components/SyncButton";
import { formatCHF, formatDuration, getCurrentMonthYear, monthOptions } from "@/lib/ui-format";
import type { SessionWithStudent, SyncResponse } from "@/lib/ui-types";

function calcStats(sessions: SessionWithStudent[]) {
  const income = sessions.reduce((s, r) => s + r.amountCHF, 0);
  const minutes = sessions.reduce((s, r) => s + r.durationMin, 0);
  const students = new Set(sessions.map((s) => s.studentId)).size;
  return { income, minutes, hours: minutes / 60, students, avgPerHour: minutes === 0 ? 0 : (income / minutes) * 60 };
}

function trend(current: number, prev: number): number | undefined {
  if (prev === 0) return undefined;
  return ((current - prev) / prev) * 100;
}

export default function DashboardPage() {
  const now = getCurrentMonthYear();

  // ── Diagram / KPI filter (independent) ──────────────────────────────
  const [month, setMonth] = useState(now.month);       // KPI month filter
  const [year, setYear] = useState(now.year);           // chart year

  // ── Sync target (independent) ────────────────────────────────────────
  const [syncMonth, setSyncMonth] = useState(now.month);
  const [syncYear, setSyncYear] = useState(now.year);

  // ── Data ─────────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<SessionWithStudent[]>([]);
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
      const res = await fetch(`/api/sessions?year=${year}`);
      if (!res.ok) throw new Error();
      setSessions((await res.json()) as SessionWithStudent[]);
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

  const currentMonthSessions = useMemo(() => sessions.filter((s) => s.month === month), [sessions, month]);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevMonthSessions = useMemo(() => sessions.filter((s) => s.month === prevMonth), [sessions, prevMonth]);
  const currentStats = useMemo(() => calcStats(currentMonthSessions), [currentMonthSessions]);
  const prevStats = useMemo(() => calcStats(prevMonthSessions), [prevMonthSessions]);
  const ytdIncome = useMemo(() => sessions.reduce((s, r) => s + r.amountCHF, 0), [sessions]);

  const chartData = useMemo(() =>
    monthOptions.map((m) => {
      const ms = sessions.filter((s) => s.month === m.value);
      return {
        month: m.value,
        label: m.label.slice(0, 3),
        income: ms.reduce((s, r) => s + r.amountCHF, 0),
        sessions: ms.length,
        hours: ms.reduce((s, r) => s + r.durationMin, 0) / 60,
      };
    }),
  [sessions]);

  const breakdownSessions = useMemo(
    () => (selectedMonth !== null ? sessions.filter((s) => s.month === selectedMonth) : currentMonthSessions),
    [sessions, selectedMonth, currentMonthSessions]
  );

  const tableSessions = useMemo(() => {
    let s = selectedMonth !== null ? sessions.filter((r) => r.month === selectedMonth) : currentMonthSessions;
    if (selectedStudent) s = s.filter((r) => r.student?.name === selectedStudent);
    return s;
  }, [sessions, selectedMonth, currentMonthSessions, selectedStudent]);

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
    <DashboardShell monthIncome={currentStats.income} ytdIncome={ytdIncome}>
      <div className="space-y-5">

        {/* Page header */}
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
          {refreshing && (
            <span className="h-4 w-4 rounded-full border-2 border-[#4A7FC1] border-t-transparent animate-spin" />
          )}
        </div>

        {/* Sync bar — has its own independent month + year */}
        <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Kalender synchronisieren</p>
          <div className="flex flex-wrap items-end gap-3">

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
              <span className="rounded-xl bg-[#EBF4FF] px-3 py-1.5 text-sm text-[#4A7FC1] font-medium self-end">{toast}</span>
            )}
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between">
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
            <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard label="Einkommen (Monat)" value={formatCHF(currentStats.income)} subValue={`${currentMonthSessions.length} Sessions`} trend={trend(currentStats.income, prevStats.income)} trendLabel="Vormonat" />
              <StatCard label="Jahreseinkommen" value={formatCHF(ytdIncome)} subValue={`${sessions.length} Sessions total`} accent="lilac" />
              <StatCard label="Stunden (Monat)" value={`${currentStats.hours.toFixed(1)}h`} subValue={formatDuration(currentStats.minutes)} trend={trend(currentStats.hours, prevStats.hours)} trendLabel="Vormonat" />
              <StatCard label="Aktive Schüler" value={String(currentStats.students)} subValue={`Ø ${formatCHF(currentStats.avgPerHour)} / h`} trend={trend(currentStats.students, prevStats.students)} trendLabel="Vormonat" accent="lilac" />
            </section>

            {/* Charts — year + month filters together */}
            <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-gray-700">Jahresübersicht</h2>
                <div className="flex flex-wrap items-center gap-2">
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
                <MonthlyChart data={chartData} selectedMonth={selectedMonth} onMonthSelect={setSelectedMonth} />
                <StudentBreakdown sessions={breakdownSessions} selectedStudent={selectedStudent} onStudentSelect={setSelectedStudent} />
              </div>
            </section>

            {/* Sessions table */}
            <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-900">
                  Sessions
                  {selectedMonth !== null && (
                    <span className="ml-1.5 font-normal text-[#4A7FC1]">
                      · {monthOptions.find((m) => m.value === selectedMonth)?.label}
                    </span>
                  )}
                  {selectedStudent && (
                    <span className="ml-1.5 font-normal text-[#4A7FC1]">· {selectedStudent}</span>
                  )}
                </h2>
                {(selectedMonth !== null || selectedStudent) && (
                  <button
                    onClick={() => { setSelectedMonth(null); setSelectedStudent(null); }}
                    className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-400 transition hover:border-gray-300 hover:text-gray-600"
                  >
                    Filter zurücksetzen ✕
                  </button>
                )}
              </div>
              <SessionTable sessions={tableSessions} studentFilter={selectedStudent ?? undefined} />
            </section>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
