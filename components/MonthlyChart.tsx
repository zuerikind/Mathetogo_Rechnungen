"use client";

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
import { formatCHF, TEAL, BLUE_BG } from "@/lib/ui-format";

export type ChartPoint = {
  month: number;
  label: string;
  income: number;
  sessions: number;
  hours: number;
};

type Props = {
  data: ChartPoint[];
  selectedMonth: number | null;
  onMonthSelect: (month: number | null) => void;
};

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartPoint }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  if (d.income === 0) return null;
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-xl text-sm min-w-[160px]">
      <p className="font-bold text-gray-900 mb-2">{d.label}</p>
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
        {d.sessions > 0 && (
          <div className="flex justify-between gap-4 border-t border-gray-100 pt-1 mt-1">
            <span className="text-gray-500">Ø / Session</span>
            <span className="font-medium text-gray-700">{formatCHF(d.income / d.sessions)}</span>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-gray-400">Klick zum Filtern</p>
    </div>
  );
}

export function MonthlyChart({ data, selectedMonth, onMonthSelect }: Props) {
  const activeBars = data.filter((d) => d.income > 0);
  const avg = activeBars.length > 0
    ? activeBars.reduce((s, d) => s + d.income, 0) / activeBars.length
    : 0;

  const handleClick = (item: { payload?: ChartPoint }) => {
    const point = item.payload;
    if (!point?.month) return;
    onMonthSelect(selectedMonth === point.month ? null : point.month);
  };

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Monatliches Einkommen</h3>
          {avg > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">
              Durchschnitt: {formatCHF(avg)} / Monat
            </p>
          )}
        </div>
        {selectedMonth !== null && (
          <button
            onClick={() => onMonthSelect(null)}
            className="text-xs text-gray-400 hover:text-gray-700 transition-colors border border-gray-200 rounded-full px-2.5 py-0.5"
          >
            Filter zurücksetzen ✕
          </button>
        )}
      </div>

      <div className="h-72 w-full mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barCategoryGap="35%" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v}`}
              width={52}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(74,127,193,0.06)" }} />
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
            <Bar
              dataKey="income"
              radius={[5, 5, 0, 0]}
              onClick={handleClick}
              style={{ cursor: "pointer" }}
            >
              {data.map((d) => (
                <Cell
                  key={d.month}
                  fill={selectedMonth === d.month ? "#0a5240" : TEAL}
                  opacity={selectedMonth !== null && selectedMonth !== d.month ? 0.35 : 1}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
