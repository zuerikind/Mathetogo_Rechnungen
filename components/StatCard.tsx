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
  /** Nachhilfe / Monatseinkommen — Markenblau, als hervorgehobene Glaskarte */
  blue: {
    card: "glass-stat glass-stat--hero",
    label: "text-white/80",
    value: "text-white",
    sub: "text-white/75",
    trendUp: "bg-white/85 text-[#2c5a99]",
    trendDown: "bg-white/85 text-red-700",
  },
  /** Jahres-KPI / Kumuliert — Indigo */
  lilac: {
    card: "glass-stat glass-tint-lilac",
    label: "text-indigo-700/80",
    value: "text-indigo-800",
    sub: "text-indigo-700/75",
    trendUp: "bg-white/75 text-indigo-800",
    trendDown: "bg-white/75 text-red-700",
  },
  /** Dance — Rose */
  rose: {
    card: "glass-stat glass-tint-rose",
    label: "text-rose-700/80",
    value: "text-rose-800",
    sub: "text-rose-700/75",
    trendUp: "bg-white/75 text-rose-800",
    trendDown: "bg-white/75 text-red-700",
  },
  /** Ersparnis — Smaragd */
  green: {
    card: "glass-stat glass-tint-green",
    label: "text-emerald-800/80",
    value: "text-emerald-900",
    sub: "text-emerald-800/75",
    trendUp: "bg-white/75 text-emerald-800",
    trendDown: "bg-white/75 text-red-700",
  },
  /** Stunden / Zeit — Cyan */
  sky: {
    card: "glass-stat glass-tint-sky",
    label: "text-cyan-800/80",
    value: "text-cyan-900",
    sub: "text-cyan-800/75",
    trendUp: "bg-white/75 text-cyan-900",
    trendDown: "bg-white/75 text-red-700",
  },
  /** Schüler — Violett */
  violet: {
    card: "glass-stat glass-tint-violet",
    label: "text-violet-700/80",
    value: "text-violet-800",
    sub: "text-violet-700/75",
    trendUp: "bg-white/75 text-violet-800",
    trendDown: "bg-white/75 text-red-700",
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

  const pad = compact ? "p-4" : "p-5";
  const labelCls = compact
    ? `text-[10px] font-semibold uppercase tracking-wider ${t.label}`
    : `text-xs font-semibold uppercase tracking-widest ${t.label}`;
  const valueCls = compact
    ? `mt-1.5 break-words text-lg font-extrabold tabular-nums leading-tight tracking-[-0.035em] sm:text-xl sm:whitespace-nowrap md:text-2xl ${t.value}`
    : `mt-2 break-words text-xl font-extrabold tabular-nums leading-tight tracking-[-0.035em] sm:text-2xl sm:whitespace-nowrap md:text-3xl ${t.value}`;
  const subCls = compact ? `mt-0.5 text-xs ${t.sub}` : `mt-1 text-sm ${t.sub}`;
  const trendWrap = compact ? "mt-2 min-h-[1.25rem]" : "mt-3 min-h-6";
  const trendPill = compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-0.5 text-xs";

  return (
    <div
      className={`min-w-0 h-full ${t.card} ${pad} flex flex-col`}
    >
      <p className={labelCls}>{label}</p>
      <p className={valueCls}>{value}</p>
      {subValue && <p className={subCls}>{subValue}</p>}
      <div className={trendWrap}>
        {hasTrend && (
          <div
            className={`inline-flex items-center gap-1 rounded-full font-semibold shadow-sm ${trendPill} ${
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
