"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { useGlobalIncomeSummary } from "@/hooks/useGlobalIncomeSummary";
import { SyncButton } from "@/components/SyncButton";
import { getCurrentMonthYear, monthOptions } from "@/lib/ui-format";
import {
  formatUnmatchedHeadline,
  unmatchedActionHint,
  type SyncUnmatchedEvent,
} from "@/lib/sync-unmatched";
import type { SessionWithStudent, SyncResponse } from "@/lib/ui-types";

const REASON_META: Record<
  SyncUnmatchedEvent["reason"],
  { label: string; pill: string; row: string }
> = {
  no_match: {
    label: "Unbekannter Name",
    pill: "bg-orange-50 text-orange-800 border-orange-100",
    row: "bg-orange-50/80 text-orange-950 border-orange-100",
  },
  ambiguous: {
    label: "Mehrdeutiger Name",
    pill: "bg-amber-50 text-amber-900 border-amber-100",
    row: "bg-amber-50/80 text-amber-950 border-amber-100",
  },
  inactive_match: {
    label: "Deaktivierter Schüler",
    pill: "bg-slate-100 text-slate-700 border-slate-200",
    row: "bg-slate-50 text-slate-800 border-slate-200",
  },
};

export default function SyncPage() {
  const { monthIncome, ytdIncome, loading: incomeLoading } = useGlobalIncomeSummary();
  const [month, setMonth] = useState(1);
  const [year, setYear] = useState(() => getCurrentMonthYear().year);

  useEffect(() => {
    const now = getCurrentMonthYear();
    setMonth(now.month);
    setYear(now.year);
  }, []);
  const [result, setResult] = useState<SyncResponse | null>(null);
  const [sessions, setSessions] = useState<SessionWithStudent[]>([]);

  const [loading, setLoading] = useState(false);
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
      await yearRes.json();
      setSessions(monthRows);
    } catch {
      setLoadError("Fehler beim Laden.");
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  const unmatchedByReason = useMemo(() => {
    const items = result?.unmatched ?? [];
    return {
      no_match: items.filter((u) => u.reason === "no_match"),
      ambiguous: items.filter((u) => u.reason === "ambiguous"),
      inactive_match: items.filter((u) => u.reason === "inactive_match"),
    };
  }, [result]);

  return (
    <DashboardShell monthIncome={monthIncome} ytdIncome={ytdIncome} incomeLoading={incomeLoading}>
      <div className="min-w-0 space-y-4">
        {/* Month + Year Picker card */}
        <section className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="text-base font-semibold text-gray-900">Kalender Sync</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Wähle Monat und Jahr aus, dann synchronisiere manuell mit Google Kalender.
          </p>

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
          <section className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
            {/* Summary pills */}
            <div className="mb-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
                ✓ {result.synced} synchronisiert
              </span>
              {(result.removed ?? 0) > 0 && (
                <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                  {result.removed} entfernt (nicht mehr im Kalender)
                </span>
              )}
              {result.skipped > 0 && (
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                  {result.skipped} übersprungen
                </span>
              )}
              {result.unmatched.length > 0 && (
                <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700">
                  ⚠ {result.unmatched.length} ohne Schülerzuordnung
                </span>
              )}
            </div>

            {/* Synced sessions */}
            {sessions.length > 0 && (
              <div className="mb-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Stunden</p>
                <ul className="space-y-1">
                  {sessions.map((session) => (
                    <li
                      key={session.id}
                      className="flex flex-col gap-1 rounded-lg px-3 py-2 text-sm text-gray-700 odd:bg-gray-50 sm:flex-row sm:items-center sm:gap-2"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 text-green-500">✓</span>
                        <span className="min-w-0 font-medium break-words">
                          {session.student?.name ?? "Unbekannt"}
                        </span>
                      </span>
                      <span className="shrink-0 text-gray-400 sm:ml-auto">
                        {new Date(session.date).toLocaleDateString("de-CH")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Unmatched events — categorized */}
            {result.unmatched.length > 0 && (
              <div className="space-y-4 border-t border-gray-100 pt-4">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Kalendereinträge ohne Zuordnung</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Diese Termine wurden nicht als Nachhilfestunde übernommen. Datum hilft dir, sie im Google-Kalender
                    zu finden.
                  </p>
                </div>

                {(["no_match", "ambiguous", "inactive_match"] as const).map((reason) => {
                  const list = unmatchedByReason[reason];
                  if (list.length === 0) return null;
                  const meta = REASON_META[reason];
                  return (
                    <div key={reason}>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${meta.pill}`}
                        >
                          {meta.label}
                        </span>
                        <span className="text-xs text-gray-400">{list.length}</span>
                      </div>
                      <ul className="space-y-2">
                        {list.map((item, idx) => (
                          <li
                            key={`${item.start}-${item.title}-${idx}`}
                            className={`rounded-xl border px-3 py-2.5 text-sm ${meta.row}`}
                          >
                            <p className="font-medium leading-snug">{formatUnmatchedHeadline(item)}</p>
                            <p className="mt-1 text-xs opacity-80">{unmatchedActionHint(item)}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}
      </div>
    </DashboardShell>
  );
}
