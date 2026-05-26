"use client";

import { useEffect, useMemo, useState } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCHF, normStudentDisplayName, CHART_TEACHING, CHART_TEACHING_DIM } from "@/lib/ui-format";
import type { SessionWithStudent } from "@/lib/ui-types";

type StudentStat = {
  name: string;
  income: number;
  sessions: number;
  hours: number;
};

type Props = {
  sessions: SessionWithStudent[];
  /** Analysis: prorated Abo-Anteil pro Schülername (Kalendermonat der Ansicht). */
  subscriptionIncomeByName?: Record<string, number>;
  onStudentSelect?: (name: string | null) => void;
  selectedStudent?: string | null;
};

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: StudentStat }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-lg text-sm min-w-[170px]">
      <p className="font-semibold text-slate-900 mb-2">{d.name}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-slate-500">Einkommen</span>
          <span className="font-semibold text-slate-900 tabular-nums">{formatCHF(d.income)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-slate-500">Sessions</span>
          <span className="font-medium text-slate-700">{d.sessions}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-slate-500">Stunden</span>
          <span className="font-medium text-slate-700">{d.hours.toFixed(1)}h</span>
        </div>
        <div className="flex justify-between gap-4 border-t border-slate-100 pt-1">
          <span className="text-slate-500">Ø / Session</span>
          <span className="font-medium">
            {d.sessions > 0 ? formatCHF(d.income / d.sessions) : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

export function StudentBreakdown({
  sessions,
  subscriptionIncomeByName = {},
  onStudentSelect,
  selectedStudent,
}: Props) {
  const compact = useMediaQuery("(max-width: 639px)");
  const [showAllStudents, setShowAllStudents] = useState(false);

  const rankedStudents: StudentStat[] = useMemo(() => {
    const acc = sessions.reduce(
      (map, s) => {
        const name = normStudentDisplayName(s.student?.name);
        if (!map[name]) map[name] = { name, income: 0, sessions: 0, hours: 0 };
        map[name].income += s.amountCHF;
        map[name].sessions += 1;
        map[name].hours += s.durationMin / 60;
        return map;
      },
      {} as Record<string, StudentStat>
    );
    for (const [nameKey, extra] of Object.entries(subscriptionIncomeByName)) {
      if (extra === 0) continue;
      const name = normStudentDisplayName(nameKey);
      if (!acc[name]) acc[name] = { name, income: 0, sessions: 0, hours: 0 };
      acc[name].income += extra;
    }
    return Object.values(acc).sort((a, b) => b.income - a.income);
  }, [sessions, subscriptionIncomeByName]);

  useEffect(() => {
    setShowAllStudents(false);
  }, [sessions]);

  const collapsedStudents = useMemo(() => {
    const top = rankedStudents.slice(0, 10);
    if (!selectedStudent) return top;
    const sel = normStudentDisplayName(selectedStudent);
    const row = rankedStudents.find((r) => r.name === sel);
    if (!row || top.some((r) => r.name === sel)) return top;
    return [...rankedStudents.slice(0, 9), row];
  }, [rankedStudents, selectedStudent]);

  const byStudent = showAllStudents ? rankedStudents : collapsedStudents;

  const selectedNorm = selectedStudent ? normStudentDisplayName(selectedStudent) : null;

  if (rankedStudents.length === 0 && Object.keys(subscriptionIncomeByName).length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 shadow-sm flex items-center justify-center h-40 text-sm text-slate-500">
        Keine Daten für diesen Zeitraum
      </div>
    );
  }

  const chartHeight = Math.max(200, byStudent.length * 38);
  const canExpand = rankedStudents.length > 10;

  const handleClick = (dataPoint: unknown) => {
    const d = dataPoint as StudentStat;
    if (!d?.name || !onStudentSelect) return;
    const sel = selectedStudent ? normStudentDisplayName(selectedStudent) : null;
    onStudentSelect(sel === d.name ? null : d.name);
  };

  const chartMargin = compact
    ? { top: 4, right: 8, left: 0, bottom: 4 }
    : { top: 8, right: 168, left: 4, bottom: 8 };
  const yAxisWidth = compact ? 76 : 118;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">Einkommen nach Schüler</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {showAllStudents
              ? `Alle ${rankedStudents.length} · Klick zum Filtern`
              : `Top ${Math.min(10, rankedStudents.length)} · Klick zum Filtern`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto sm:justify-end">
          {canExpand && (
            <button
              type="button"
              onClick={() => setShowAllStudents((v) => !v)}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
            >
              {showAllStudents ? "Weniger anzeigen" : "Alle anzeigen"}
            </button>
          )}
          {selectedStudent && onStudentSelect && (
            <button
              onClick={() => onStudentSelect(null)}
              className="max-w-full shrink-0 truncate rounded-full border border-gray-200 px-2.5 py-0.5 text-xs text-gray-400 hover:text-gray-700"
              title={selectedStudent}
            >
              {compact && selectedStudent.length > 18
                ? `${selectedStudent.slice(0, 17)}… ✕`
                : `${selectedStudent} ✕`}
            </button>
          )}
        </div>
      </div>
      <div className="min-w-0 overflow-x-auto overflow-y-visible" style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={compact ? 260 : undefined}>
          <BarChart
            data={byStudent}
            layout="vertical"
            barCategoryGap="20%"
            margin={chartMargin}
          >
            <XAxis
              type="number"
              tick={{ fontSize: compact ? 9 : 10, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => (compact ? `${v}` : `CHF ${v}`)}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: compact ? 10 : 11, fill: "#374151" }}
              axisLine={false}
              tickLine={false}
              width={yAxisWidth}
              tickFormatter={(v: string) =>
                compact && v.length > 10 ? `${v.slice(0, 9)}…` : v
              }
            />
            <Tooltip content={<CustomTooltip />} cursor={false} />
            <Bar
              dataKey="income"
              radius={[0, 5, 5, 0]}
              onClick={handleClick}
              style={{ cursor: onStudentSelect ? "pointer" : "default" }}
              label={
                compact
                  ? false
                  : {
                      position: "right",
                      fontSize: 10,
                      fill: "#6b7280",
                      offset: 10,
                      formatter: (label: unknown) => formatCHF(Number(label)),
                    }
              }
            >
              {byStudent.map((d, i) => (
                <Cell
                  key={d.name}
                  fill={selectedNorm === d.name ? CHART_TEACHING : CHART_TEACHING_DIM}
                  opacity={selectedNorm && selectedNorm !== d.name ? 0.4 : Math.max(0.72, 1 - i * 0.025)}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
