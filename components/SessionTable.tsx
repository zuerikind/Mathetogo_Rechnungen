"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCHF, formatDate, formatDuration, monthOptions } from "@/lib/ui-format";
import type { SessionWithStudent } from "@/lib/ui-types";

type Props = { sessions: SessionWithStudent[]; studentFilter?: string };

export function SessionTable({ sessions, studentFilter: externalStudentFilter }: Props) {
  const [sortDesc, setSortDesc] = useState(true);
  const [studentFilter, setStudentFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState<number | "all">("all");
  const [page, setPage] = useState(1);
  const perPage = 20;

  useEffect(() => {
    setPage(1);
  }, [sessions]);

  const activeStudentFilter = externalStudentFilter ?? studentFilter;

  const filtered = useMemo(() => {
    const rows = sessions.filter((s) => {
      const name = s.student?.name ?? "";
      const subject = s.student?.subject ?? s.notes ?? "";
      const byStudent = name.toLowerCase().includes(activeStudentFilter.toLowerCase());
      const bySubject = subject.toLowerCase().includes(subjectFilter.toLowerCase());
      const byMonth = monthFilter === "all" || s.month === monthFilter;
      return byStudent && bySubject && byMonth;
    });
    return [...rows].sort((a, b) => {
      const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
      return sortDesc ? -diff : diff;
    });
  }, [sessions, sortDesc, activeStudentFilter, subjectFilter, monthFilter]);

  const totalCHF = filtered.reduce((s, r) => s + r.amountCHF, 0);
  const totalMin = filtered.reduce((s, r) => s + r.durationMin, 0);
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-4">
        <select
          value={monthFilter}
          onChange={(e) => { setMonthFilter(e.target.value === "all" ? "all" : Number(e.target.value)); setPage(1); }}
          className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0F6E56]"
        >
          <option value="all">Alle Monate</option>
          {monthOptions.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>

        {!externalStudentFilter && (
          <input
            placeholder="Schüler suchen..."
            value={studentFilter}
            onChange={(e) => { setStudentFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0F6E56]"
          />
        )}

        <input
          placeholder="Fach filtern..."
          value={subjectFilter}
          onChange={(e) => {
            setSubjectFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0F6E56]"
        />

        <button
          type="button"
          onClick={() => setSortDesc((p) => !p)}
          className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
        >
          Datum {sortDesc ? "↓ Neueste" : "↑ Älteste"}
        </button>

        <div className="ml-auto flex items-center gap-3 text-sm text-gray-500">
          <span><span className="font-semibold text-gray-800">{filtered.length}</span> Sessions</span>
          <span className="text-gray-300">|</span>
          <span><span className="font-semibold text-gray-800">{formatDuration(totalMin)}</span></span>
          <span className="text-gray-300">|</span>
          <span className="font-bold text-[#0F6E56]">{formatCHF(totalCHF)}</span>
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
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400 text-right">Betrag</th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">
                  Keine Sessions gefunden
                </td>
              </tr>
            ) : (
              paginated.map((s, i) => (
                <tr
                  key={s.id}
                  className={`border-b border-gray-50 transition-colors hover:bg-gray-50 ${i % 2 === 0 ? "" : "bg-gray-50/40"}`}
                >
                  <td className="px-4 py-3 text-gray-600">{formatDate(s.date)}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{s.student?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-500">{s.student?.subject ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDuration(s.durationMin)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-[#0F6E56]">
                      {formatCHF(s.amountCHF)}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50">
                <td colSpan={3} className="px-4 py-3 text-xs font-semibold uppercase text-gray-400">Total</td>
                <td className="px-4 py-3 text-sm font-semibold text-gray-700">{formatDuration(totalMin)}</td>
                <td className="px-4 py-3 text-right text-sm font-bold text-[#0F6E56]">{formatCHF(totalCHF)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm text-gray-500">
          <span>Seite {page} von {pages}</span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-gray-50"
            >
              ← Zurück
            </button>
            <button
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-gray-50"
            >
              Weiter →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
