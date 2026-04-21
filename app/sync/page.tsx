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
        {/* Month + Year Picker card */}
        <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">Kalender Sync</h2>
          <p className="mt-0.5 text-sm text-gray-500">Wähle Monat und Jahr aus, dann synchronisiere mit Google Kalender.</p>

          {/* Month + Year selector row */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {/* Month dropdown */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Monat</label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-800 shadow-sm outline-none transition focus:border-[#4A7FC1] focus:ring-2 focus:ring-[#4A7FC1]/20"
              >
                {monthOptions.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Year picker */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Jahr</label>
              <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 px-2 py-1.5 shadow-sm">
                <button
                  type="button"
                  onClick={() => setYear((y) => y - 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition hover:bg-white hover:text-[#4A7FC1]"
                >
                  ‹
                </button>
                <span className="min-w-[3.5rem] text-center text-sm font-semibold text-gray-800">{year}</span>
                <button
                  type="button"
                  onClick={() => setYear((y) => y + 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition hover:bg-white hover:text-[#4A7FC1]"
                >
                  ›
                </button>
              </div>
            </div>

            {/* Sync button — aligned to bottom of the row */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-transparent select-none">Sync</span>
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
          </div>
        </section>

        {/* Loading skeleton */}
        {loading ? (
          <div className="h-32 animate-pulse rounded-2xl border border-blue-100 bg-white" />
        ) : null}

        {/* Load error */}
        {loadError ? (
          <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
            {loadError}{" "}
            <button type="button" onClick={() => void loadData()} className="font-medium underline">
              Erneut versuchen
            </button>
          </div>
        ) : null}

        {/* Sync error */}
        {syncError ? (
          <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{syncError}</div>
        ) : null}

        {/* Results */}
        {result && !result.clientError && !loading && !loadError ? (
          <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
            {/* Summary pills */}
            <div className="mb-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
                ✓ {result.synced} synchronisiert
              </span>
              {result.skipped > 0 && (
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                  {result.skipped} übersprungen
                </span>
              )}
              {result.unmatched.length > 0 && (
                <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700">
                  ⚠ {result.unmatched.length} nicht zugeordnet
                </span>
              )}
            </div>

            {/* Synced sessions */}
            {sessions.length > 0 && (
              <div className="mb-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Stunden</p>
                <ul className="space-y-1">
                  {sessions.map((session) => (
                    <li key={session.id} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-700 odd:bg-gray-50">
                      <span className="text-green-500">✓</span>
                      <span className="font-medium">{session.student?.name ?? "Unbekannt"}</span>
                      <span className="ml-auto text-gray-400">
                        {new Date(session.date).toLocaleDateString("de-CH")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Unmatched events */}
            {result.unmatched.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Nicht zugeordnet</p>
                <ul className="space-y-1">
                  {result.unmatched.map((name) => (
                    <li key={name} className="flex items-center gap-2 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-700">
                      <span>⚠</span>
                      {name}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-gray-400">
                  Diese Kalender-Einträge konnten keinem Schüler zugeordnet werden. Prüfe den Namen im Kalender oder füge den Schüler hinzu.
                </p>
              </div>
            )}
          </section>
        ) : null}
      </div>
    </DashboardShell>
  );
}
