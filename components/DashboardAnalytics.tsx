"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
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
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { StatCard } from "@/components/StatCard";
import {
  assessYoyAvailability,
  buildYoyMonthlySeries,
  computeEffectiveRates,
  computeInvoiceAging,
  computeMonthStatus,
  computePaymentBehavior,
  computeRevenueConcentration,
  computeStudentLifecycle,
  computeUtilizationHeatmap,
  computeWeeklyHours,
  STANDARD_HOURLY_CHF,
  zurichDayNumber,
  zurichParts,
  type AnalyticsInvoice,
  type AnalyticsSession,
  type AnalyticsStudent,
  type MonthCoverage,
  type StudentSessionExtent,
  type WeeklyHoursPoint,
} from "@/lib/dashboard-analytics";
import { CHART_TEACHING, CHART_TEACHING_DIM, LILAC, formatCHF, formatDate } from "@/lib/ui-format";
import { isManualBaselineSession } from "@/lib/ui-types";
import { ReminderTemplates } from "@/components/ReminderTemplates";
import { ReminderPreview } from "@/components/ReminderPreview";
import { ReminderCopyButtons } from "@/components/ReminderCopyButtons";

type AnalyticsPayload = {
  students: AnalyticsStudent[];
  sessions: AnalyticsSession[];
  invoices: AnalyticsInvoice[];
  extents: StudentSessionExtent[];
  monthCoverage: MonthCoverage[];
};

type Props = {
  /** Einkommensdefinition des bestehenden Dashboards (Kalender + Abos) — unverändert übernommen. */
  monthIncomeCHF: number;
  ytdIncomeCHF: number;
  incomeLoading: boolean;
  chartYear: number;
  goalCHF: number | null;
  onGoalChange: (value: number | null) => void;
};

const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const sectionCls = "rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5";
const h2Cls = "text-sm font-semibold text-slate-800";
const noteCls = "text-xs text-slate-500";
const thCls = "whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400";
const tdCls = "px-3 py-2.5 text-sm text-slate-700";

/** Eingeklappte Sektion mit Kopfzeile + Kennzahl; Inhalt erst nach Klick. */
function CollapsibleSection({
  title,
  summary,
  children,
}: {
  title: string;
  summary?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className={sectionCls}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
      >
        <span className="min-w-0">
          <span className={h2Cls}>{title}</span>
          {summary && !open && <span className={`ml-2 ${noteCls}`}>{summary}</span>}
        </span>
        <span className="shrink-0 rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-500 transition hover:border-slate-300 hover:text-slate-700">
          {open ? "Ausblenden ▴" : "Anzeigen ▾"}
        </span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </section>
  );
}

function WeeklyTooltip({ active, payload }: { active?: boolean; payload?: { payload: WeeklyHoursPoint }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-sm shadow-lg">
      <p className="font-semibold text-slate-900">Woche ab {d.label}</p>
      <p className="text-slate-600">
        {d.hours.toFixed(1)}h {d.isCurrent ? "· laufende Woche" : ""}
      </p>
    </div>
  );
}

export function DashboardAnalytics({
  monthIncomeCHF,
  ytdIncomeCHF,
  incomeLoading,
  chartYear,
  goalCHF,
  onGoalChange,
}: Props) {
  const compact = useMediaQuery("(max-width: 639px)");
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    let cancelled = false;
    void fetch("/api/analytics/dashboard")
      .then(async (r) => {
        if (!r.ok) throw new Error("load");
        const body = (await r.json()) as AnalyticsPayload;
        if (!cancelled) setData(body);
      })
      .catch(() => {
        if (!cancelled) setError("Analysen konnten nicht geladen werden.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Manuelle Baseline-Einträge sind Monats-Summen, keine echten Lektionen.
  const realSessions = useMemo(
    () => (data?.sessions ?? []).filter((s) => !isManualBaselineSession(s)),
    [data]
  );

  const aging = useMemo(
    () => (data && now ? computeInvoiceAging(data.invoices, now) : null),
    [data, now]
  );
  const payment = useMemo(
    () => (data ? computePaymentBehavior(data.invoices, data.students) : null),
    [data]
  );
  const weekly = useMemo(
    () => (now ? computeWeeklyHours(realSessions, now, 12) : null),
    [realSessions, now]
  );
  const heatmap = useMemo(() => {
    if (!now) return null;
    const p = zurichParts(now);
    const windowStart = zurichDayNumber(now) - p.weekday - 77; // 12 Wochen inkl. laufender
    const windowed = realSessions.filter((s) => zurichDayNumber(new Date(s.date)) >= windowStart);
    return computeUtilizationHeatmap(windowed);
  }, [realSessions, now]);
  const lifecycle = useMemo(
    () =>
      data && now
        ? computeStudentLifecycle({
            students: data.students,
            extents: data.extents,
            recentSessions: realSessions,
            now,
          })
        : null,
    [data, realSessions, now]
  );
  const concentration = useMemo(
    () => (data ? computeRevenueConcentration(realSessions, data.students) : null),
    [data, realSessions]
  );
  const effectiveRates = useMemo(
    () => (data ? computeEffectiveRates(realSessions, data.students) : null),
    [data, realSessions]
  );
  const monthStatus = useMemo(
    () =>
      now && !incomeLoading
        ? computeMonthStatus({ mtdIncomeCHF: monthIncomeCHF, ytdIncomeCHF, now, goalCHF })
        : null,
    [monthIncomeCHF, ytdIncomeCHF, incomeLoading, now, goalCHF]
  );
  const yoy = useMemo(
    () => (data ? assessYoyAvailability(data.monthCoverage, chartYear) : null),
    [data, chartYear]
  );
  const yoySeries = useMemo(
    () => (data && yoy?.available ? buildYoyMonthlySeries(data.monthCoverage, chartYear) : null),
    [data, yoy, chartYear]
  );

  const busiestSlots = useMemo(() => {
    if (!heatmap || heatmap.hourSlots.length === 0) return [];
    const flat: { label: string; hours: number }[] = [];
    heatmap.cells.forEach((row, wd) =>
      row.forEach((hours, i) => {
        if (hours > 0) flat.push({ label: `${WEEKDAY_LABELS[wd]} ${heatmap.hourSlots[i]}:00`, hours });
      })
    );
    return flat.sort((a, b) => b.hours - a.hours).slice(0, 3);
  }, [heatmap]);

  if (error) {
    return (
      <section className={sectionCls}>
        <p className="text-sm text-red-600">{error}</p>
      </section>
    );
  }

  if (!data || !now || !aging || !weekly || !heatmap || !lifecycle || !concentration || !effectiveRates) {
    return (
      <section className={sectionCls}>
        <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
      </section>
    );
  }

  const agingTiles: { key: keyof typeof aging.buckets; label: string; cls: string }[] = [
    { key: "notDue", label: "Noch nicht fällig", cls: "border-slate-200 bg-slate-50 text-slate-700" },
    { key: "d0_30", label: "0–30 Tage überfällig", cls: "border-amber-200 bg-amber-50 text-amber-800" },
    { key: "d31_60", label: "31–60 Tage überfällig", cls: "border-orange-200 bg-orange-50 text-orange-800" },
    { key: "d60plus", label: "Über 60 Tage überfällig", cls: "border-red-200 bg-red-50 text-red-800" },
  ];

  const latePayers = (payment?.payers ?? []).filter((p) => p.habituallyLate);

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-bold text-slate-900">Analysen</h2>
        <span className={noteCls}>nur Auswertung — verändert keine Daten</span>
      </div>

      {/* ── 5) Monatsbilanz + Ziel ─────────────────────────────────────── */}
      <section className={sectionCls}>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className={h2Cls}>Monatsbilanz (laufender Monat)</h3>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Monatsziel (CHF)
            <input
              type="number"
              min={0}
              step={100}
              value={goalCHF ?? ""}
              placeholder="z.B. 5000"
              onChange={(e) => onGoalChange(e.target.value === "" ? null : Math.max(0, Number(e.target.value)))}
              className="w-28 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-800 outline-none transition focus:border-slate-400"
            />
          </label>
        </div>
        {monthStatus ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard compact accent="blue" label="Dieser Monat" value={formatCHF(monthStatus.monthIncomeCHF)} subValue="inkl. bereits geplanter Lektionen" />
              <StatCard compact accent="sky" label="Ø abgeschlossene Monate" value={monthStatus.avgCompletedMonthCHF !== null ? formatCHF(monthStatus.avgCompletedMonthCHF) : "—"} subValue={monthStatus.avgCompletedMonthCHF !== null ? "dieses Jahr" : "ab Februar verfügbar"} />
              <StatCard
                compact
                accent="green"
                label="Monat vs. Ø"
                value={monthStatus.diffVsAvgCHF !== null ? `${monthStatus.diffVsAvgCHF >= 0 ? "+" : ""}${formatCHF(monthStatus.diffVsAvgCHF)}` : "—"}
                subValue={monthStatus.diffVsAvgCHF !== null && monthStatus.diffVsAvgCHF < 0 ? "unter dem Jahresschnitt" : undefined}
              />
              <StatCard
                compact
                accent="lilac"
                label="Zielerreichung"
                value={monthStatus.goalPct !== null ? `${monthStatus.goalPct}%` : "—"}
                subValue={
                  goalCHF && goalCHF > 0
                    ? monthStatus.monthIncomeCHF >= goalCHF
                      ? `Ziel ${formatCHF(goalCHF)} erreicht ✓`
                      : `es fehlen ${formatCHF(goalCHF - monthStatus.monthIncomeCHF)}`
                    : "Ziel rechts setzen"
                }
              />
            </div>
            {monthStatus.goalPct !== null && (
              <div className="mt-3">
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>Ziel {formatCHF(goalCHF ?? 0)}</span>
                  <span>{monthStatus.goalPct}%</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.min(100, monthStatus.goalPct)}%`, backgroundColor: monthStatus.goalPct >= 100 ? "#059669" : CHART_TEACHING_DIM }}
                  />
                </div>
              </div>
            )}
            <p className={`mt-2 ${noteCls}`}>
              Der Monatswert enthält durch den Kalender-Sync bereits alle geplanten Lektionen bis Monatsende —
              darum gibt es keine Hochrechnung, sondern den direkten Vergleich mit Ø und Ziel.
            </p>
          </>
        ) : (
          <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
        )}
        {yoy && !yoy.available && (
          <p className={`mt-3 border-t border-slate-100 pt-3 ${noteCls}`}>Vorjahresvergleich: {yoy.message}</p>
        )}
        {yoy?.available && yoySeries && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="text-xs font-semibold text-slate-700">
                Lektionsumsatz: {chartYear} vs. {yoy.prevYear}
              </h4>
              <span className={noteCls}>nur Lektionen, ohne Abos/Zusatzeinkommen</span>
            </div>
            <div className={`mt-2 w-full ${compact ? "h-36" : "h-44"}`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={yoySeries} barCategoryGap="25%" margin={{ top: 4, right: 4, left: -14, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip
                    cursor={false}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload as { label: string; currentCHF: number; previousCHF: number };
                      return (
                        <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs shadow-lg">
                          <p className="font-semibold text-slate-900">Monat {d.label}</p>
                          <p className="text-slate-700">{chartYear}: {formatCHF(d.currentCHF)}</p>
                          <p className="text-slate-500">{yoy.prevYear}: {formatCHF(d.previousCHF)}</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="previousCHF" name={String(yoy.prevYear)} fill="#cbd5e1" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="currentCHF" name={String(chartYear)} fill={CHART_TEACHING_DIM} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1 flex items-center gap-4 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CHART_TEACHING_DIM }} />
                {chartYear}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-slate-300" />
                {yoy.prevYear}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* ── 1) Offene Rechnungen & Cashflow ────────────────────────────── */}
      <section className={sectionCls}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className={h2Cls}>Offene Rechnungen & Zahlungsverhalten (Vormonate)</h3>
          <span className={noteCls}>
            Ausstehend total: <span className="font-semibold text-slate-800">{formatCHF(aging.totalOutstandingCHF)}</span>
            {payment?.avgDaysToPay !== null && payment !== null ? ` · Ø Zahlungsdauer ${payment.avgDaysToPay} Tage (${payment.paidInvoiceCount} bezahlte Rechnungen)` : ""}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {agingTiles.map((t) => (
            <div key={t.key} className={`rounded-xl border p-3.5 ${t.cls}`}>
              <p className="text-[10px] font-semibold uppercase tracking-wider opacity-75">{t.label}</p>
              <p className="mt-1.5 text-base font-bold tabular-nums sm:text-lg">{formatCHF(aging.buckets[t.key].amountCHF)}</p>
              <p className="mt-0.5 text-xs opacity-70">{aging.buckets[t.key].count} {aging.buckets[t.key].count === 1 ? "Rechnung" : "Rechnungen"}</p>
            </div>
          ))}
        </div>

        {aging.rows.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[28rem] divide-y divide-gray-100 text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Schüler</th>
                  <th className={thCls}>Monat</th>
                  <th className={thCls}>Betrag</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Nachricht</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {aging.rows.map((r) => (
                  <tr key={r.invoiceId}>
                    <td className={`${tdCls} font-medium text-slate-800`}>{r.studentName}</td>
                    <td className={tdCls}>{r.periodLabel}</td>
                    <td className={`${tdCls} font-semibold tabular-nums`}>{formatCHF(r.totalCHF)}</td>
                    <td className={tdCls}>
                      {r.daysOverdue < 0 ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">fällig in {-r.daysOverdue} Tagen</span>
                      ) : (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.daysOverdue > 60 ? "bg-red-100 text-red-700" : r.daysOverdue > 30 ? "bg-orange-100 text-orange-800" : "bg-amber-100 text-amber-800"}`}>
                          {r.daysOverdue} Tage überfällig
                        </span>
                      )}
                    </td>
                    <td className={tdCls}>
                      <ReminderCopyButtons
                        row={{
                          studentName: r.studentName,
                          invoiceNumber: r.invoiceNumber,
                          totalCHF: r.totalCHF,
                          year: r.year,
                          month: r.month,
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={`mt-4 ${noteCls}`}>
            Keine offenen Rechnungen aus Vormonaten — der laufende Monat wird erst am Monatsende fakturiert.
          </p>
        )}

        <CollapsibleSection
          title="Erinnerungen & Mahnungen"
          summary="Vorlagen bearbeiten und fertige Nachrichten kopieren"
        >
          <ReminderTemplates />
          <ReminderPreview />
        </CollapsibleSection>

        {latePayers.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50/60 p-3">
            <p className="text-xs font-semibold text-amber-900">Zahlen regelmässig spät (≥ 50 % der Rechnungen nach Fälligkeit):</p>
            <p className="mt-1 text-sm text-amber-900">
              {latePayers.map((p) => `${p.name} (Ø ${p.avgDaysToPay} Tage, ${p.paidCount} Rechnungen)`).join(" · ")}
            </p>
          </div>
        )}
      </section>

      {/* ── 2) Auslastung ──────────────────────────────────────────────── */}
      <section className={sectionCls}>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className={h2Cls}>Unterrichtsstunden pro Woche (letzte 12 Wochen)</h3>
          <span className={noteCls}>
            Ø {weekly.avgHours.toFixed(1)}h/Woche · laufende Woche {weekly.currentWeekHours.toFixed(1)}h
            {weekly.avgHours > 0 ? ` (${weekly.currentWeekHours >= weekly.avgHours ? "+" : ""}${(weekly.currentWeekHours - weekly.avgHours).toFixed(1)}h vs. Ø)` : ""}
          </span>
        </div>
        <div className={`w-full ${compact ? "h-40" : "h-52"}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekly.weeks} barCategoryGap="30%" margin={{ top: 8, right: 8, left: compact ? -18 : 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
              <XAxis dataKey="label" tick={{ fontSize: compact ? 9 : 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} interval={compact ? 1 : 0} />
              <YAxis tick={{ fontSize: compact ? 9 : 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={40} unit="h" />
              <Tooltip content={<WeeklyTooltip />} cursor={false} />
              {weekly.avgHours > 0 && (
                <ReferenceLine y={weekly.avgHours} stroke="#d1d5db" strokeDasharray="5 5" label={{ value: "Ø", position: "insideTopRight", fontSize: 10, fill: "#9ca3af" }} />
              )}
              <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                {weekly.weeks.map((w) => (
                  <Cell key={w.weekStartDay} fill={w.isCurrent ? CHART_TEACHING : CHART_TEACHING_DIM} opacity={w.isCurrent ? 1 : 0.75} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {heatmap.hourSlots.length > 0 ? (
          <div className="mt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="text-xs font-semibold text-slate-700">Wochenrhythmus (Wochentag × Startzeit)</h4>
              <span className={noteCls}>hell = wenig, dunkel = viel · {heatmap.totalHours.toFixed(0)}h in 12 Wochen</span>
            </div>
            <div className="mt-2 overflow-x-auto">
              <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: `2.25rem repeat(${heatmap.hourSlots.length}, minmax(1.75rem, 2.5rem))` }}>
                <div />
                {heatmap.hourSlots.map((h) => (
                  <div key={h} className="pb-0.5 text-center text-[10px] text-slate-400">{h}</div>
                ))}
                {WEEKDAY_LABELS.map((label, wd) => (
                  <Fragment key={label}>
                    <div className="flex items-center pr-1 text-[10px] font-medium text-slate-500">{label}</div>
                    {heatmap.hourSlots.map((h, i) => {
                      const v = heatmap.cells[wd]?.[i] ?? 0;
                      const alpha = heatmap.maxCellHours > 0 ? 0.12 + 0.88 * (v / heatmap.maxCellHours) : 0;
                      return (
                        <div
                          key={`c-${wd}-${h}`}
                          title={`${label} ${h}:00 — ${v.toFixed(1)}h Unterricht`}
                          className="flex h-7 items-center justify-center rounded-[4px] text-[10px] font-medium"
                          style={
                            v > 0
                              ? { backgroundColor: `rgba(53, 104, 168, ${alpha})`, color: alpha > 0.55 ? "#fff" : "#33517a" }
                              : { backgroundColor: "#f8fafc" }
                          }
                        >
                          {v > 0 ? v.toFixed(1).replace(/\.0$/, "") : ""}
                        </div>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
            {busiestSlots.length > 0 && (
              <p className={`mt-2 ${noteCls}`}>
                Stärkste Slots: {busiestSlots.map((s) => `${s.label} (${s.hours.toFixed(1)}h)`).join(" · ")} — leere Felder sind freie Kapazität. Zuordnung nach Startzeit der Lektion.
              </p>
            )}
          </div>
        ) : (
          <p className={`mt-3 ${noteCls}`}>Noch keine Lektionen in den letzten 12 Wochen.</p>
        )}
      </section>

      {/* ── 3) Lebenszyklus & Konzentration (eingeklappt) ──────────────── */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <CollapsibleSection
          title="Schüler-Lebenszyklus"
          summary={lifecycle.atRisk.length > 0 ? `${lifecycle.atRisk.length} Schüler brauchen Aufmerksamkeit` : "alles im grünen Bereich"}
        >
          <div>
            <h4 className="text-xs font-semibold text-slate-700">Neue Schüler pro Monat (erste Lektion)</h4>
            <div className="mt-1 h-24 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={lifecycle.newByMonth} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#9ca3af" }} axisLine={false} tickLine={false} interval={compact ? 2 : 1} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={false}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload as { label: string; count: number; names: string[] };
                      return (
                        <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs shadow-lg">
                          <p className="font-semibold text-slate-900">{d.label}: {d.count} neu</p>
                          {d.names.length > 0 && <p className="mt-0.5 max-w-[14rem] text-slate-600">{d.names.join(", ")}</p>}
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="count" fill={LILAC} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <h4 className="mt-4 text-xs font-semibold text-slate-700">Aufmerksamkeit nötig</h4>
          {lifecycle.atRisk.length > 0 ? (
            <div className="mt-1 overflow-x-auto">
              <table className="w-full min-w-[24rem] divide-y divide-gray-100 text-sm">
                <thead>
                  <tr>
                    <th className={thCls}>Schüler</th>
                    <th className={thCls}>Letzte Lektion</th>
                    <th className={thCls}>Tage</th>
                    <th className={thCls}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {lifecycle.atRisk.map((r) => (
                    <tr key={r.studentId}>
                      <td className={`${tdCls} font-medium text-slate-800`}>{r.name}</td>
                      <td className={tdCls}>{r.lastSession ? formatDate(r.lastSession) : "—"}</td>
                      <td className={`${tdCls} tabular-nums`}>{r.daysSinceLast ?? "—"}</td>
                      <td className={tdCls}>
                        {r.status === "risiko" && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">⚠ Risiko — lange keine Lektion</span>}
                        {r.status === "ruecklaeufig" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">▼ rückläufig ({r.hoursPrev4Weeks}h → {r.hoursLast4Weeks}h)</span>}
                        {r.status === "keine_lektionen" && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">aktiv, ohne Lektionen</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={`mt-1 ${noteCls}`}>Alle aktiven Schüler hatten kürzlich Lektionen.</p>
          )}
          <p className={`mt-2 ${noteCls}`}>Reine Anzeige — es wird kein Schüler automatisch deaktiviert.</p>
        </CollapsibleSection>

        <CollapsibleSection
          title="Umsatz-Konzentration"
          summary={concentration.top5Share !== null ? `Top 5 = ${Math.round(concentration.top5Share * 100)} % · ${concentration.ranked.length} Schüler` : "keine Daten"}
        >
          <p className={`${noteCls} -mt-1 mb-3`}>Lektionsumsatz der letzten 12 Monate.</p>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs text-slate-600">
                <span>Grösster Schüler</span>
                <span className="font-semibold text-slate-800">{concentration.top1Share !== null ? `${Math.round(concentration.top1Share * 100)} %` : "—"}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full" style={{ width: `${Math.round((concentration.top1Share ?? 0) * 100)}%`, backgroundColor: CHART_TEACHING }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-slate-600">
                <span>Top 5 Schüler</span>
                <span className="font-semibold text-slate-800">{concentration.top5Share !== null ? `${Math.round(concentration.top5Share * 100)} %` : "—"}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full" style={{ width: `${Math.round((concentration.top5Share ?? 0) * 100)}%`, backgroundColor: CHART_TEACHING_DIM }} />
              </div>
            </div>
          </div>
          {concentration.ranked.length > 0 && (
            <ul className="mt-4 max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {concentration.ranked.map((t, i) => (
                <li key={t.name} className="flex items-center gap-2 text-sm">
                  <span className="w-6 shrink-0 tabular-nums text-slate-400">{i + 1}.</span>
                  <span className="min-w-0 flex-1 truncate text-slate-700">{t.name}</span>
                  <span className="hidden h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-slate-100 sm:block">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${Math.min(100, Math.round(t.share * 100))}%`, backgroundColor: CHART_TEACHING_DIM }}
                    />
                  </span>
                  <span className="shrink-0 tabular-nums text-slate-500">{formatCHF(t.incomeCHF)} · {Math.round(t.share * 100)} %</span>
                </li>
              ))}
            </ul>
          )}
          <p className={`mt-3 ${noteCls}`}>
            Hohe Konzentration = Klumpenrisiko: verliert man den grössten Schüler, fehlt dieser Anteil des Lektionsumsatzes.
          </p>
        </CollapsibleSection>
      </div>

      {/* ── 4) Effektiver Stundensatz (eingeklappt) ────────────────────── */}
      <CollapsibleSection
        title="Effektiver Stundensatz pro Schüler"
        summary={(() => {
          const below = effectiveRates.filter((r) => r.belowStandard).length;
          return below > 0 ? `${below} Schüler deutlich unter Standard` : "alle im Rahmen des Standardsatzes";
        })()}
      >
        <p className={`${noteCls} -mt-1 mb-3`}>
          Letzte 12 Monate · Standardsatz {formatCHF(STANDARD_HOURLY_CHF)}/h · effektiv = Umsatz ÷ Stunden
        </p>
        {effectiveRates.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] divide-y divide-gray-100 text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Schüler</th>
                  <th className={thCls}>Umsatz</th>
                  <th className={thCls}>Stunden</th>
                  <th className={thCls}>Effektiv / h</th>
                  <th className={thCls}>Aktueller Tarif / h</th>
                  <th className={thCls}>vs. Standard</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {effectiveRates.map((r) => (
                  <tr key={r.studentId} className={r.belowStandard ? "bg-amber-50/50" : undefined}>
                    <td className={`${tdCls} font-medium text-slate-800`}>
                      {r.name}
                      {r.belowStandard && (
                        <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">⚠ unter Standard</span>
                      )}
                    </td>
                    <td className={`${tdCls} tabular-nums`}>{formatCHF(r.revenueCHF)}</td>
                    <td className={`${tdCls} tabular-nums`}>{r.hours.toFixed(1)}h</td>
                    <td className={`${tdCls} font-semibold tabular-nums`}>{formatCHF(r.effectiveHourlyCHF)}</td>
                    <td className={`${tdCls} tabular-nums`}>{formatCHF(r.currentTariffHourlyCHF)}</td>
                    <td className={`${tdCls} tabular-nums ${r.diffVsStandardCHF < 0 ? "text-amber-700" : "text-slate-500"}`}>
                      {r.diffVsStandardCHF >= 0 ? "+" : ""}{formatCHF(r.diffVsStandardCHF)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={noteCls}>Keine Lektionen im Auswertungszeitraum.</p>
        )}
        <p className={`mt-2 ${noteCls}`}>
          Nur Auswertung der bereits verrechneten Beträge (historische Tarife inklusive) — Tarife werden hier nicht verändert.
        </p>
      </CollapsibleSection>
    </div>
  );
}
