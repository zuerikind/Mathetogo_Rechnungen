"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCHF, TEAL } from "@/lib/ui-format";
import type { SessionWithStudent } from "@/lib/ui-types";

type StudentStat = {
  name: string;
  income: number;
  sessions: number;
  hours: number;
};

type Props = {
  sessions: SessionWithStudent[];
  onStudentSelect?: (name: string | null) => void;
  selectedStudent?: string | null;
};

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: StudentStat }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-xl text-sm min-w-[170px]">
      <p className="font-bold text-gray-900 mb-2">{d.name}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-gray-500">Einkommen</span>
          <span className="font-semibold text-[#4A7FC1]">{formatCHF(d.income)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-gray-500">Sessions</span>
          <span className="font-medium text-gray-700">{d.sessions}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-gray-500">Stunden</span>
          <span className="font-medium text-gray-700">{d.hours.toFixed(1)}h</span>
        </div>
        <div className="flex justify-between gap-4 border-t border-gray-100 pt-1">
          <span className="text-gray-500">Ø / Session</span>
          <span className="font-medium">{formatCHF(d.income / (d.sessions || 1))}</span>
        </div>
      </div>
    </div>
  );
}

export function StudentBreakdown({ sessions, onStudentSelect, selectedStudent }: Props) {
  const byStudent: StudentStat[] = Object.values(
    sessions.reduce(
      (acc, s) => {
        const name = s.student?.name ?? "Unbekannt";
        if (!acc[name]) acc[name] = { name, income: 0, sessions: 0, hours: 0 };
        acc[name].income += s.amountCHF;
        acc[name].sessions += 1;
        acc[name].hours += s.durationMin / 60;
        return acc;
      },
      {} as Record<string, StudentStat>
    )
  )
    .sort((a, b) => b.income - a.income)
    .slice(0, 15);

  if (byStudent.length === 0) {
    return (
      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm flex items-center justify-center h-40 text-sm text-gray-400">
        Keine Daten für diesen Zeitraum
      </div>
    );
  }

  const chartHeight = Math.max(200, byStudent.length * 38);

  const handleClick = (dataPoint: unknown) => {
    const d = dataPoint as StudentStat;
    if (!d?.name || !onStudentSelect) return;
    onStudentSelect(selectedStudent === d.name ? null : d.name);
  };

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Einkommen nach Schüler</h3>
          <p className="text-xs text-gray-400 mt-0.5">Top {byStudent.length} · Klick zum Filtern</p>
        </div>
        {selectedStudent && onStudentSelect && (
          <button
            onClick={() => onStudentSelect(null)}
            className="text-xs text-gray-400 hover:text-gray-700 border border-gray-200 rounded-full px-2.5 py-0.5"
          >
            {selectedStudent} ✕
          </button>
        )}
      </div>
      <div style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={byStudent}
            layout="vertical"
            barCategoryGap="20%"
            margin={{ top: 0, right: 60, left: 0, bottom: 0 }}
          >
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `CHF ${v}`}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 12, fill: "#374151" }}
              axisLine={false}
              tickLine={false}
              width={110}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(74,127,193,0.06)" }} />
            <Bar
              dataKey="income"
              radius={[0, 5, 5, 0]}
              onClick={handleClick}
              style={{ cursor: onStudentSelect ? "pointer" : "default" }}
              label={{
                position: "right",
                fontSize: 11,
                fill: "#6b7280",
                formatter: (label) => formatCHF(Number(label)),
              }}
            >
              {byStudent.map((d, i) => (
                <Cell
                  key={d.name}
                  fill={selectedStudent === d.name ? "#2B5FA0" : TEAL}
                  opacity={selectedStudent && selectedStudent !== d.name ? 0.35 : 1 - i * 0.04}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
