"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { SyncButton } from "@/components/SyncButton";
import { getCurrentMonthYear, monthOptions } from "@/lib/ui-format";
import type { SessionWithStudent, SyncResponse } from "@/lib/ui-types";

export default function SyncPage() {
  const now = getCurrentMonthYear();
  const [month, setMonth] = useState(now.month);
  const [year, setYear] = useState(now.year);
  const [result, setResult] = useState<SyncResponse | null>(null);
  const [sessions, setSessions] = useState<SessionWithStudent[]>([]);

  const [monthIncome, setMonthIncome] = useState(0);
  const [ytdIncome, setYtdIncome] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [syncError, setSyncError] = useState("");

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError("");
      const [monthRes, yearRes] = await Promise.all([
        fetch(`/api/sessions?year=${year}&month=${month}`),
        fetch(`/api/sessions?year=${year}`),
      ]);
      if (!monthRes.ok || !yearRes.ok) throw new Error("Laden fehlgeschlagen");
      const monthRows = (await monthRes.json()) as SessionWithStudent[];
      const yearRows = (await yearRes.json()) as SessionWithStudent[];
      setSessions(monthRows);
      setMonthIncome(monthRows.reduce((acc, s) => acc + s.amountCHF, 0));
      setYtdIncome(yearRows.reduce((acc, s) => acc + s.amountCHF, 0));
    } catch {
      setLoadError("Fehler beim Laden.");
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <DashboardShell monthIncome={monthIncome} ytdIncome={ytdIncome}>
      <div className="space-y-4">
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-gray-900">Calendar Sync</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {[year - 1, year, year + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <SyncButton
              year={year}
              month={month}
              onSynced={(syncResult) => {
                setResult(syncResult);
                setSyncError(syncResult.clientError ?? "");
                void loadData();
              }}
            />
          </div>
        </section>

        {loading ? <div className="h-32 animate-pulse rounded-lg border border-gray-200 bg-white" /> : null}
        {loadError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {loadError}{" "}
            <button type="button" onClick={() => void loadData()} className="underline">
              Retry
            </button>
          </div>
        ) : null}
        {syncError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{syncError}</div>
        ) : null}

        {result && !result.clientError && !loading && !loadError ? (
          <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-medium text-gray-700">Results</h3>
            <div>
              <p className="mb-1 text-sm font-medium text-gray-900">Synced sessions</p>
              <ul className="space-y-1 text-sm text-gray-700">
                {sessions.map((session) => (
                  <li key={session.id} className="flex items-center gap-2">
                    <span className="text-green-600">✓</span>
                    {session.student?.name ?? "Unbekannt"} ({new Date(session.date).toLocaleDateString("de-CH")})
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-gray-900">Unmatched events</p>
              <ul className="space-y-1 text-sm text-orange-700">
                {result.unmatched.map((name) => (
                  <li key={name} className="flex items-center gap-2">
                    <span>⚠</span>
                    {name}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-orange-700">
                These calendar events didn&apos;t match any student. Fix by renaming the event or adding the student.
              </p>
            </div>
          </section>
        ) : null}
      </div>
    </DashboardShell>
  );
}
