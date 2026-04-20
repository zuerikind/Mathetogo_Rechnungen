"use client";

type StatCardProps = {
  label: string;
  value: string;
  subValue?: string;
  trend?: number; // % change vs previous month
  trendLabel?: string;
};

export function StatCard({ label, value, subValue, trend, trendLabel }: StatCardProps) {
  const hasTrend = trend !== undefined && !isNaN(trend) && isFinite(trend);

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900">{value}</p>
      {subValue && (
        <p className="mt-1 text-sm text-gray-500">{subValue}</p>
      )}
      {hasTrend && (
        <div
          className={`mt-3 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            trend >= 0
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-600"
          }`}
        >
          <span>{trend >= 0 ? "▲" : "▼"}</span>
          <span>{Math.abs(trend).toFixed(1)}%</span>
          {trendLabel && <span className="font-normal text-gray-400">· {trendLabel}</span>}
        </div>
      )}
    </div>
  );
}
