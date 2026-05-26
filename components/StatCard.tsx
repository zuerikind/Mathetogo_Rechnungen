"use client";

type StatCardProps = {
  label: string;
  value: string;
  subValue?: string;
  trend?: number;
  trendLabel?: string;
  /** Semantic color — matches chart categories where applicable */
  accent?: "blue" | "lilac" | "rose" | "green" | "sky" | "violet";
  compact?: boolean;
};

type Theme = {
  card: string;
  label: string;
  value: string;
  sub: string;
  trendUp: string;
  trendDown: string;
};

const themes: Record<NonNullable<StatCardProps["accent"]>, Theme> = {
  /** Nachhilfe / Monatseinkommen — Markenblau */
  blue: {
    card: "border-[#C7DDF5] bg-[#EBF4FF]",
    label: "text-[#3568A8]/75",
    value: "text-[#3568A8]",
    sub: "text-[#3568A8]/65",
    trendUp: "bg-white/70 text-[#3568A8]",
    trendDown: "bg-white/70 text-red-700",
  },
  /** Jahres-KPI / Kumuliert — Indigo */
  lilac: {
    card: "border-indigo-200 bg-indigo-50",
    label: "text-indigo-600/80",
    value: "text-indigo-700",
    sub: "text-indigo-600/70",
    trendUp: "bg-white/70 text-indigo-700",
    trendDown: "bg-white/70 text-red-700",
  },
  /** Dance — Rose */
  rose: {
    card: "border-rose-200 bg-rose-50",
    label: "text-rose-600/80",
    value: "text-rose-700",
    sub: "text-rose-600/70",
    trendUp: "bg-white/70 text-rose-700",
    trendDown: "bg-white/70 text-red-700",
  },
  /** Ersparnis — Smaragd */
  green: {
    card: "border-emerald-200 bg-emerald-50",
    label: "text-emerald-700/80",
    value: "text-emerald-800",
    sub: "text-emerald-700/70",
    trendUp: "bg-white/70 text-emerald-800",
    trendDown: "bg-white/70 text-red-700",
  },
  /** Stunden / Zeit — Cyan */
  sky: {
    card: "border-cyan-200 bg-cyan-50",
    label: "text-cyan-700/80",
    value: "text-cyan-800",
    sub: "text-cyan-700/70",
    trendUp: "bg-white/70 text-cyan-800",
    trendDown: "bg-white/70 text-red-700",
  },
  /** Schüler — Violett */
  violet: {
    card: "border-violet-200 bg-violet-50",
    label: "text-violet-600/80",
    value: "text-violet-700",
    sub: "text-violet-600/70",
    trendUp: "bg-white/70 text-violet-700",
    trendDown: "bg-white/70 text-red-700",
  },
};

export function StatCard({
  label,
  value,
  subValue,
  trend,
  trendLabel,
  accent = "blue",
  compact = false,
}: StatCardProps) {
  const hasTrend = trend !== undefined && !isNaN(trend) && isFinite(trend);
  const t = themes[accent];

  const pad = compact ? "p-3.5 rounded-xl" : "p-5 rounded-2xl";
  const labelCls = compact
    ? `text-[10px] font-semibold uppercase tracking-wider ${t.label}`
    : `text-xs font-semibold uppercase tracking-widest ${t.label}`;
  const valueCls = compact
    ? `mt-1.5 break-words text-base font-bold tabular-nums leading-tight tracking-tight sm:text-lg sm:whitespace-nowrap md:text-xl ${t.value}`
    : `mt-2 break-words text-lg font-bold tabular-nums leading-tight tracking-tight sm:text-xl sm:whitespace-nowrap md:text-2xl ${t.value}`;
  const subCls = compact ? `mt-0.5 text-xs ${t.sub}` : `mt-1 text-sm ${t.sub}`;
  const trendWrap = compact ? "mt-2 min-h-[1.25rem]" : "mt-3 min-h-6";
  const trendPill = compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-0.5 text-xs";

  return (
    <div
      className={`min-w-0 h-full border ${t.card} ${pad} shadow-sm transition-shadow hover:shadow-md flex flex-col`}
    >
      <p className={labelCls}>{label}</p>
      <p className={valueCls}>{value}</p>
      {subValue && <p className={subCls}>{subValue}</p>}
      <div className={trendWrap}>
        {hasTrend && (
          <div
            className={`inline-flex items-center gap-1 rounded-md font-medium ${trendPill} ${
              trend >= 0 ? t.trendUp : t.trendDown
            }`}
          >
            <span>{trend >= 0 ? "▲" : "▼"}</span>
            <span>{Math.abs(trend).toFixed(1)}%</span>
            {trendLabel && (
              <span className={`font-normal opacity-70`}>· {trendLabel}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
