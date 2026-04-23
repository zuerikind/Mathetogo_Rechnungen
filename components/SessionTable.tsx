"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCHF, formatDate, formatDuration, monthOptions, normStudentDisplayName } from "@/lib/ui-format";
import type { SessionWithStudent } from "@/lib/ui-types";

/** Monatsbetrag Abo — gleiche Logik wie Dashboard-Diagramm (CHF/Monat). */
export type SubscriptionAnalysisTableRow = {
  id: string;
  date: string;
  studentName: string;
  studentSubject: string;
  month: number;
  year: number;
  amountCHF: number;
  label: string;
};

type Props = {
  sessions: SessionWithStudent[];
  studentFilter?: string;
  subscriptionAnalysisRows?: SubscriptionAnalysisTableRow[];
};

type Row =
  | { kind: "session"; s: SessionWithStudent }
  | { kind: "sub"; r: SubscriptionAnalysisTableRow };

export function SessionTable({
  sessions,
  studentFilter: externalStudentFilter,
  subscriptionAnalysisRows = [],
}: Props) {
  const [sortDesc, setSortDesc] = useState(true);
  const [studentFilter, setStudentFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState<number | "all">("all");
  const [page, setPage] = useState(1);
  const perPage = 20;

  useEffect(() => {
    setPage(1);
  }, [sessions, subscriptionAnalysisRows]);

  const activeStudentFilter = externalStudentFilter ?? studentFilter;

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      const name = s.student?.name ?? "";
      const subject = s.student?.subject ?? s.notes ?? "";
      const byStudent = name.toLowerCase().includes(activeStudentFilter.toLowerCase());
      const bySubject = subject.toLowerCase().includes(subjectFilter.toLowerCase());
      const byMonth = monthFilter === "all" || s.month === monthFilter;
      return byStudent && bySubject && byMonth;
    });
  }, [sessions, activeStudentFilter, subjectFilter, monthFilter]);

  const filteredSubs = useMemo(() => {
    const q = subjectFilter.toLowerCase().trim();
    return subscriptionAnalysisRows.filter((r) => {
      const byStudent = r.studentName.toLowerCase().includes(activeStudentFilter.toLowerCase());
      const bySubject =
        !q ||
        r.studentSubject.toLowerCase().includes(q) ||
        r.label.toLowerCase().includes(q);
      const byMonth = monthFilter === "all" || r.month === monthFilter;
      return byStudent && bySubject && byMonth;
    });
  }, [subscriptionAnalysisRows, activeStudentFilter, subjectFilter, monthFilter]);

  const combined = useMemo(() => {
    const rows: Row[] = [
      ...filteredSessions.map((s) => ({ kind: "session" as const, s })),
      ...filteredSubs.map((r) => ({ kind: "sub" as const, r })),
    ];
    rows.sort((a, b) => {
      const ta = a.kind === "session" ? new Date(a.s.date).getTime() : new Date(a.r.date).getTime();
      const tb = b.kind === "session" ? new Date(b.s.date).getTime() : new Date(b.r.date).getTime();
      const diff = ta - tb;
      return sortDesc ? -diff : diff;
    });
    return rows;
  }, [filteredSessions, filteredSubs, sortDesc]);

  const totalCHF = useMemo(() => {
    const fromSessions = filteredSessions.reduce((acc, r) => acc + r.amountCHF, 0);
    const fromSubs = filteredSubs.reduce((acc, r) => acc + r.amountCHF, 0);
    return fromSessions + fromSubs;
  }, [filteredSessions, filteredSubs]);

  const totalMin = filteredSessions.reduce((s, r) => s + r.durationMin, 0);
  const pages = Math.max(1, Math.ceil(combined.length / perPage));
  const paginated = combined.slice((page - 1) * perPage, page * perPage);

  const subSum = filteredSubs.reduce((a, r) => a + r.amountCHF, 0);

  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
      {/* Filters */}
      <div className="flex flex-col gap-3 border-b border-gray-100 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 sm:p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <select
            value={monthFilter}
            onChange={(e) => {
              setMonthFilter(e.target.value === "all" ? "all" : Number(e.target.value));
              setPage(1);
            }}
            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#4A7FC1]"
          >
            <option value="all">Alle Monate</option>
            {monthOptions.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>

          {!externalStudentFilter && (
            <input
              placeholder="Schüler suchen..."
              value={studentFilter}
              onChange={(e) => {
                setStudentFilter(e.target.value);
                setPage(1);
              }}
              className="min-w-[8rem] flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#4A7FC1] sm:min-w-[10rem] sm:flex-none"
            />
          )}

          <input
            placeholder="Fach filtern..."
            value={subjectFilter}
            onChange={(e) => {
              setSubjectFilter(e.target.value);
              setPage(1);
            }}
            className="min-w-[8rem] flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#4A7FC1] sm:min-w-[9rem] sm:flex-none"
          />

          <button
            type="button"
            onClick={() => setSortDesc((p) => !p)}
            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
          >
            Datum {sortDesc ? "↓ Neueste" : "↑ Älteste"}
          </button>
        </div>

        <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 pt-3 text-sm text-gray-500 sm:ml-auto sm:w-auto sm:border-t-0 sm:pt-0">
          <span>
            <span className="font-semibold text-gray-800">{filteredSessions.length}</span> Lektionen
            {filteredSubs.length > 0 && (
              <span className="font-semibold text-gray-800">
                {" "}
                · {filteredSubs.length} Abo-Zeile{filteredSubs.length === 1 ? "" : "n"} ({formatCHF(subSum)})
              </span>
            )}
          </span>
          <span className="hidden text-gray-300 sm:inline">|</span>
          <span>
            <span className="font-semibold text-gray-800">{formatDuration(totalMin)}</span>
          </span>
          <span className="hidden text-gray-300 sm:inline">|</span>
          <span className="font-bold text-[#4A7FC1]">{formatCHF(totalCHF)}</span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left">
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Datum</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Schüler</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Fach</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Dauer</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">Betrag</th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">
                  Keine Eintraege gefunden
                </td>
              </tr>
            ) : (
              paginated.map((row, i) =>
                row.kind === "session" ? (
                  <tr
                    key={row.s.id}
                    className={`border-b border-gray-50 transition-colors hover:bg-gray-50 ${i % 2 === 0 ? "" : "bg-gray-50/40"}`}
                  >
                    <td className="px-4 py-3 text-gray-600">{formatDate(row.s.date)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {normStudentDisplayName(row.s.student?.name)}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{row.s.student?.subject ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDuration(row.s.durationMin)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-[#4A7FC1]">
                        {formatCHF(row.s.amountCHF)}
                      </span>
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={row.r.id}
                    className={`border-b border-gray-50 bg-[#EBF4FF]/50 transition-colors hover:bg-[#EBF4FF]/80 ${i % 2 === 0 ? "" : "bg-[#E3EEF9]/60"}`}
                  >
                    <td className="px-4 py-3 text-gray-600">{formatDate(row.r.date)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{row.r.studentName}</td>
                    <td className="px-4 py-3 text-gray-600">{row.r.label}</td>
                    <td className="px-4 py-3 text-gray-400">—</td>
                    <td className="px-4 py-3 text-right">
                      <span className="rounded-full border border-[#4A7FC1]/30 bg-white px-2.5 py-1 text-xs font-semibold text-[#2B5FA0]">
                        {formatCHF(row.r.amountCHF)}
                      </span>
                    </td>
                  </tr>
                )
              )
            )}
          </tbody>
          {combined.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50">
                <td colSpan={3} className="px-4 py-3 text-xs font-semibold uppercase text-gray-400">
                  Total
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-gray-700">{formatDuration(totalMin)}</td>
                <td className="px-4 py-3 text-right text-sm font-bold text-[#4A7FC1]">{formatCHF(totalCHF)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex flex-col gap-2 border-t border-gray-100 px-3 py-3 text-sm text-gray-500 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <span>
            Seite {page} von {pages}
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40"
            >
              ← Zurück
            </button>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40"
            >
              Weiter →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
