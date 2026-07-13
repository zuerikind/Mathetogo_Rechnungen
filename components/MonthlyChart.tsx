"use client";

import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CHART_ADDITIONAL,
  CHART_ADDITIONAL_DIM,
  CHART_DANCE,
  CHART_DANCE_DIM,
  CHART_TEACHING,
  CHART_TEACHING_DIM,
  formatCHF,
} from "@/lib/ui-format";

export type ChartPoint = {
  month: number;
  label: string;
  income: number;
  danceIncome: number;
  additionalIncome: number;
  teachingIncome: number;
  sessions: number;
  hours: number;
  medianPerHour: number;
};

type Props = {
  data: ChartPoint[];
  avgMonths: number;
  selectedMonth: number | null;
  onMonthSelect: (month: number | null) => void;
  /** Optionales Monatsziel (nur Anzeige als Linie, verändert keine Werte). */
  goalCHF?: number | null;
};

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartPoint }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  if (d.income === 0) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg text-sm min-w-[160px]">
      <p className="font-semibold text-slate-900 mb-2">{d.label}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-slate-500">Einkommen</span>
          <span className="font-semibold text-slate-900 tabular-nums">{formatCHF(d.income)}</span>
        </div>
        {d.teachingIncome > 0 && (
          <div className="flex justify-between gap-4">
            <span className="text-slate-500">Nachhilfe & Abos</span>
            <span className="font-medium tabular-nums" style={{ color: CHART_TEACHING_DIM }}>
              {formatCHF(d.teachingIncome)}
            </span>
          </div>
        )}
        {d.danceIncome > 0 && (
          <div className="flex justify-between gap-4">
            <span className="text-slate-500">Tanz</span>
            <span className="font-medium tabular-nums" style={{ color: CHART_DANCE_DIM }}>
              {formatCHF(d.danceIncome)}
            </span>
          </div>
        )}
        {d.additionalIncome > 0 && (
          <div className="flex justify-between gap-4">
            <span className="text-slate-500">Zusatz</span>
            <span className="font-medium tabular-nums" style={{ color: CHART_ADDITIONAL_DIM }}>
              {formatCHF(d.additionalIncome)}
            </span>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <span className="text-gray-500">Sessions</span>
          <span className="font-medium text-slate-700">{d.sessions}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-slate-500">Stunden</span>
          <span className="font-medium text-slate-700">{d.hours.toFixed(1)}h</span>
        </div>
        {d.medianPerHour > 0 && (
          <div className="flex justify-between gap-4 border-t border-slate-100 pt-1 mt-1">
            <span className="text-slate-500">Median / Stunde</span>
            <span className="font-medium text-slate-700">{formatCHF(d.medianPerHour)}</span>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-400">Klick zum Filtern</p>
    </div>
  );
}

export function MonthlyChart({ data, avgMonths, selectedMonth, onMonthSelect, goalCHF }: Props) {
  const compact = useMediaQuery("(max-width: 639px)");
  const avg = avgMonths > 0
    ? data.reduce((s, d) => s + d.income, 0) / avgMonths
    : 0;

  const handleClick = (item: { payload?: ChartPoint }) => {
    const point = item.payload;
    if (!point?.month) return;
    onMonthSelect(selectedMonth === point.month ? null : point.month);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">Monatliches Einkommen</h3>
          {avg > 0 && (
            <p className="text-xs text-slate-500 mt-0.5">
              Durchschnitt: {formatCHF(avg)} / Monat
            </p>
          )}
        </div>
        {selectedMonth !== null && (
          <button
            onClick={() => onMonthSelect(null)}
            className="shrink-0 self-start text-xs text-slate-500 transition-colors hover:text-slate-800 sm:self-auto rounded-full border border-slate-200 px-2.5 py-0.5"
          >
            Filter zurücksetzen ✕
          </button>
        )}
      </div>

      <div className={`mt-4 w-full ${compact ? "h-52" : "h-72"}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            barCategoryGap={compact ? "28%" : "35%"}
            margin={{ top: 8, right: compact ? 4 : 16, left: compact ? 0 : 8, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: compact ? 9 : 11, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
              interval={compact ? "preserveStartEnd" : 0}
            />
            <YAxis
              tick={{ fontSize: compact ? 9 : 11, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v}`}
              width={compact ? 34 : 52}
            />
            {/* cursor=false: Recharts v3 tooltip band can draw a heavy border (looks like a black box) after bar clicks */}
            <Tooltip content={<CustomTooltip />} cursor={false} />
            {avg > 0 && (
              <ReferenceLine
                y={avg}
                stroke="#d1d5db"
                strokeDasharray="5 5"
                label={{
                  value: "Ø",
                  position: "insideTopRight",
                  fontSize: 10,
                  fill: "#9ca3af",
                  offset: 4,
                }}
              />
            )}
            {goalCHF != null && goalCHF > 0 && (
              <ReferenceLine
                y={goalCHF}
                stroke="#059669"
                strokeDasharray="6 4"
                label={{
                  value: "Ziel",
                  position: "insideTopLeft",
                  fontSize: 10,
                  fill: "#059669",
                  offset: 4,
                }}
              />
            )}
            <Bar
              dataKey="teachingIncome"
              radius={[5, 5, 0, 0]}
              onClick={handleClick}
              style={{ cursor: "pointer" }}
              stackId="income"
            >
              {data.map((d) => (
                <Cell
                  key={d.month}
                  fill={selectedMonth === d.month ? CHART_TEACHING : CHART_TEACHING_DIM}
                  opacity={selectedMonth !== null && selectedMonth !== d.month ? 0.35 : 1}
                />
              ))}
            </Bar>
            <Bar dataKey="danceIncome" stackId="income" onClick={handleClick} style={{ cursor: "pointer" }}>
              {data.map((d) => (
                <Cell
                  key={`dance-${d.month}`}
                  fill={selectedMonth === d.month ? CHART_DANCE : CHART_DANCE_DIM}
                  opacity={selectedMonth !== null && selectedMonth !== d.month ? 0.35 : 1}
                />
              ))}
            </Bar>
            <Bar
              dataKey="additionalIncome"
              stackId="income"
              radius={[5, 5, 0, 0]}
              onClick={handleClick}
              style={{ cursor: "pointer" }}
            >
              {data.map((d) => (
                <Cell
                  key={`additional-${d.month}`}
                  fill={selectedMonth === d.month ? CHART_ADDITIONAL : CHART_ADDITIONAL_DIM}
                  opacity={selectedMonth !== null && selectedMonth !== d.month ? 0.35 : 1}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CHART_TEACHING_DIM }} />
          Nachhilfe & Abos
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CHART_DANCE_DIM }} />
          Tanz
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CHART_ADDITIONAL_DIM }} />
          Zusatzeinkommen
        </span>
      </div>
    </div>
  );
}
