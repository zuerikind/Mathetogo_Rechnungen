"use client";

import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CHART_CUMULATIVE,
  CHART_EXPENSE_DIM,
  CHART_SAVINGS,
  CHART_SAVINGS_DIM,
  CHART_SAVINGS_NEG,
  formatCHF,
} from "@/lib/ui-format";

export type SavingsPoint = {
  month: number;
  label: string;
  income: number;
  expense: number;
  savings: number;
  cumulativeSavings: number;
};

type Props = {
  data: SavingsPoint[];
  selectedMonth: number | null;
  onMonthSelect: (month: number | null) => void;
};

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: SavingsPoint }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  if (d.income === 0 && d.expense === 0) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg text-sm min-w-[180px]">
      <p className="font-semibold text-slate-900 mb-2">{d.label}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-slate-500">Einkommen</span>
          <span className="font-medium tabular-nums text-slate-800">{formatCHF(d.income)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-slate-500">Ausgaben</span>
          <span className="font-medium tabular-nums" style={{ color: CHART_EXPENSE_DIM }}>
            {formatCHF(d.expense)}
          </span>
        </div>
        <div className="flex justify-between gap-4 border-t border-slate-100 pt-1 mt-1">
          <span className="text-slate-500">Gespart</span>
          <span
            className="font-semibold tabular-nums"
            style={{ color: d.savings >= 0 ? CHART_SAVINGS : CHART_SAVINGS_NEG }}
          >
            {formatCHF(d.savings)}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-slate-500">Kumuliert</span>
          <span className="font-medium tabular-nums text-slate-800">{formatCHF(d.cumulativeSavings)}</span>
        </div>
      </div>
    </div>
  );
}

export function SavingsChart({ data, selectedMonth, onMonthSelect }: Props) {
  const compact = useMediaQuery("(max-width: 639px)");
  const hasData = data.some((d) => d.income > 0 || d.expense > 0);

  const handleClick = (item: { payload?: SavingsPoint }) => {
    const point = item.payload;
    if (!point?.month) return;
    onMonthSelect(selectedMonth === point.month ? null : point.month);
  };

  if (!hasData) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Ersparnis im Verlauf</h3>
        <p className="mt-4 text-sm text-slate-500">
          Noch keine Ausgaben erfasst. Trage Monatsausgaben unter Einstellungen ein, um die Entwicklung zu sehen.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">Ersparnis im Verlauf</h3>
          <p className="text-xs text-slate-500 mt-0.5">Monatlich gespart und kumuliert (Einkommen − Ausgaben)</p>
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

      <div className={`mt-4 w-full ${compact ? "h-52" : "h-64"}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            barCategoryGap={compact ? "28%" : "35%"}
            margin={{ top: 8, right: compact ? 8 : 24, left: compact ? 0 : 8, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: compact ? 9 : 11, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
              interval={compact ? "preserveStartEnd" : 0}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: compact ? 9 : 11, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v}`}
              width={compact ? 34 : 52}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: compact ? 9 : 11, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v}`}
              width={compact ? 34 : 48}
            />
            <Tooltip content={<CustomTooltip />} cursor={false} />
            <ReferenceLine yAxisId="left" y={0} stroke="#cbd5e1" strokeWidth={1} />
            <Bar
              yAxisId="left"
              dataKey="savings"
              radius={[4, 4, 0, 0]}
              onClick={handleClick}
              style={{ cursor: "pointer" }}
            >
              {data.map((d) => (
                <Cell
                  key={d.month}
                  fill={
                    selectedMonth === d.month
                      ? d.savings >= 0
                        ? CHART_SAVINGS
                        : CHART_SAVINGS_NEG
                      : d.savings >= 0
                        ? CHART_SAVINGS_DIM
                        : CHART_SAVINGS_NEG
                  }
                  opacity={selectedMonth !== null && selectedMonth !== d.month ? 0.35 : 1}
                />
              ))}
            </Bar>
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="cumulativeSavings"
              stroke={CHART_CUMULATIVE}
              strokeWidth={2}
              dot={{ r: 3, fill: CHART_CUMULATIVE, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CHART_SAVINGS_DIM }} />
          Gespart (Monat)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ backgroundColor: CHART_CUMULATIVE }} />
          Kumuliert (Jahr)
        </span>
      </div>
    </div>
  );
}
