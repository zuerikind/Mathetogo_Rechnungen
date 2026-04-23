"use client";

type StatCardProps = {
  label: string;
  value: string;
  subValue?: string;
  trend?: number;
  trendLabel?: string;
  accent?: "blue" | "lilac";
};

export function StatCard({ label, value, subValue, trend, trendLabel, accent = "blue" }: StatCardProps) {
  const hasTrend = trend !== undefined && !isNaN(trend) && isFinite(trend);
  const accentBg = accent === "blue" ? "bg-[#EBF4FF]" : "bg-[#F3F0FF]";
  const accentText = accent === "blue" ? "text-[#4A7FC1]" : "text-[#7B6CB5]";
  const accentBorder = accent === "blue" ? "border-[#C7DDF5]" : "border-[#D9D3F0]";

  return (
    <div className={`min-w-0 h-full rounded-2xl border ${accentBorder} ${accentBg} p-5 transition-shadow hover:shadow-md flex flex-col`}>
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">{label}</p>
      <p
        className={`mt-2 break-words text-lg font-bold tabular-nums leading-tight tracking-tight sm:text-xl sm:whitespace-nowrap md:text-2xl ${accentText}`}
      >
        {value}
      </p>
      {subValue && <p className="mt-1 text-sm text-gray-500">{subValue}</p>}
      <div className="mt-3 min-h-6">
        {hasTrend && (
          <div className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            trend >= 0 ? "bg-blue-50 text-blue-600" : "bg-rose-50 text-rose-500"
          }`}>
            <span>{trend >= 0 ? "▲" : "▼"}</span>
            <span>{Math.abs(trend).toFixed(1)}%</span>
            {trendLabel && <span className="font-normal text-gray-400">· {trendLabel}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
