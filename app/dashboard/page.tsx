"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [month, setMonth] = useState(now.month);
  const [year, setYear] = useState(now.year);
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

  const activeMonthLabel = monthOptions.find((m) => m.value === (selectedMonth ?? month))?.label;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-6 space-y-5">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-6">
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <nav className="hidden sm:flex items-center gap-1 text-sm">
              {[
                { href: "/students", label: "Schüler" },
                { href: "/invoices", label: "Rechnungen" },
                { href: "/sync", label: "Sync" },
              ].map((item) => (
                <a key={item.href} href={item.href} className="px-3 py-1.5 rounded-lg text-gray-600 hover:bg-white hover:text-gray-900 font-medium transition-colors">
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <select value={month} onChange={(e) => { setMonth(Number(e.target.value)); setSelectedMonth(null); }} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-[#0F6E56]">
              {monthOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </div>

        {/* Sync bar */}
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm flex flex-wrap items-center gap-3">
          <SyncButton year={year} month={month} onSynced={handleSynced} />
          {toast && <span className="rounded-lg bg-teal-50 px-3 py-1.5 text-sm text-[#0F6E56] font-medium">{toast}</span>}
        </div>

        {error ? (
          <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => void loadSessions()} className="underline font-medium">Erneut versuchen</button>
          </div>
        ) : loading ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-100" />)}
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard label="Einkommen (Monat)" value={formatCHF(currentStats.income)} subValue={`${currentMonthSessions.length} Sessions`} trend={trend(currentStats.income, prevStats.income)} trendLabel="Vormonat" />
              <StatCard label="Jahreseinkommen" value={formatCHF(ytdIncome)} subValue={`${sessions.length} Sessions total`} />
              <StatCard label="Stunden (Monat)" value={`${currentStats.hours.toFixed(1)}h`} subValue={formatDuration(currentStats.minutes)} trend={trend(currentStats.hours, prevStats.hours)} trendLabel="Vormonat" />
              <StatCard label="Aktive Schüler" value={String(currentStats.students)} subValue={`Ø ${formatCHF(currentStats.avgPerHour)} / h`} trend={trend(currentStats.students, prevStats.students)} trendLabel="Vormonat" />
            </section>

            {/* Charts */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-gray-700">Jahresübersicht</h2>
                  {refreshing && <span className="h-3.5 w-3.5 rounded-full border-2 border-[#0F6E56] border-t-transparent animate-spin" />}
                </div>
                <div className="flex items-center gap-2">
                  {availableYears.map((y) => (
                    <button
                      key={y}
                      onClick={() => setYear(y)}
                      className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${year === y ? "bg-[#0F6E56] text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-[#0F6E56] hover:text-[#0F6E56]"}`}
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
            </div>

            {/* Sessions table */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">
                  Sessions
                  {selectedMonth !== null && <span className="ml-1.5 text-[#0F6E56]">· {monthOptions.find((m) => m.value === selectedMonth)?.label}</span>}
                  {selectedStudent && <span className="ml-1.5 text-[#0F6E56]">· {selectedStudent}</span>}
                </h2>
                {(selectedMonth !== null || selectedStudent) && (
                  <button onClick={() => { setSelectedMonth(null); setSelectedStudent(null); }} className="text-xs text-gray-400 hover:text-gray-700 border border-gray-200 rounded-full px-3 py-1">
                    Alle Filter zurücksetzen ✕
                  </button>
                )}
              </div>
              <SessionTable sessions={tableSessions} studentFilter={selectedStudent ?? undefined} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
