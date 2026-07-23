"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useReminderTemplates } from "@/hooks/useReminderTemplates";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { dueReminderStage, renderReminder, type ReminderTokenInput } from "@/lib/reminder-tokens";
import { zurichParts } from "@/lib/dashboard-analytics";
import { formatCHF, monthOptions } from "@/lib/ui-format";

type Period = { year: number; month: number };
type ReminderInvoice = {
  invoiceId: string;
  studentName: string;
  invoiceNumber: string;
  totalCHF: number;
  year: number;
  month: number;
  dueDate: string;
  daysOverdue: number;
};
type Stage = 1 | 2 | 3;

const STAGE_TABS: { stage: Stage; label: string }[] = [
  { stage: 1, label: "1. Erinnerung" },
  { stage: 2, label: "2. Erinnerung" },
  { stage: 3, label: "Mahnung" },
];

function periodKey(p: Period): string {
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

function periodLabel(p: Period): string {
  const name = monthOptions.find((m) => m.value === p.month)?.label ?? String(p.month);
  return `${name} ${p.year}`;
}

function prevPeriod(p: Period): Period {
  return p.month === 1 ? { year: p.year - 1, month: 12 } : { year: p.year, month: p.month - 1 };
}

export function ReminderPreview() {
  const { templates, status, ready } = useReminderTemplates();
  const { state: copyState, copy } = useCopyToClipboard();

  const nowPeriod = useMemo<Period>(() => {
    const p = zurichParts(new Date());
    return { year: p.year, month: p.month };
  }, []);
  const defaultPeriod = useMemo(() => prevPeriod(nowPeriod), [nowPeriod]);

  const [selected, setSelected] = useState<Period>(defaultPeriod);
  const [periods, setPeriods] = useState<Period[] | null>(null);
  const [invoices, setInvoices] = useState<ReminderInvoice[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tabs, setTabs] = useState<Record<string, Stage>>({});

  const load = useCallback(async (period: Period) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/invoices/reminders?year=${period.year}&month=${period.month}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Rechnungen konnten nicht geladen werden.");
      }
      const body = (await res.json()) as { periods: Period[]; invoices: ReminderInvoice[] };
      setPeriods(Array.isArray(body.periods) ? body.periods : []);
      setInvoices(Array.isArray(body.invoices) ? body.invoices : []);
    } catch (e) {
      setInvoices(null);
      setError(e instanceof Error ? e.message : "Rechnungen konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(selected);
  }, [load, selected]);

  // Dropdown: Perioden mit Rechnungen + Vor-/aktueller Monat injiziert, dedupliziert, neueste zuerst.
  const options = useMemo<Period[]>(() => {
    const map = new Map<string, Period>();
    for (const p of [defaultPeriod, nowPeriod, ...(periods ?? [])]) {
      map.set(periodKey(p), p);
    }
    return Array.from(map.values()).sort((a, b) => b.year - a.year || b.month - a.month);
  }, [periods, defaultPeriod, nowPeriod]);

  const tabFor = (id: string): Stage => tabs[id] ?? 1;

  function onCopy(inv: ReminderInvoice, text: string) {
    if (!ready) return;
    void copy(inv.invoiceId, text);
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
        <span className="text-xs font-semibold text-slate-700">Fertige Nachrichten</span>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          Monat
          <select
            value={periodKey(selected)}
            onChange={(e) => {
              const opt = options.find((p) => periodKey(p) === e.target.value);
              if (opt) setSelected(opt);
            }}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400"
          >
            {options.map((p) => (
              <option key={periodKey(p)} value={periodKey(p)}>
                {periodLabel(p)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="p-3">
        {status === "error" && (
          <p className="mb-3 text-xs text-red-600">
            Vorlagen konnten nicht geladen werden — Kopieren ist deaktiviert.
          </p>
        )}

        {loading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <button onClick={() => void load(selected)} className="font-medium underline">
              Erneut versuchen
            </button>
          </div>
        ) : !invoices || invoices.length === 0 ? (
          <p className="text-xs text-slate-500">Keine offenen Rechnungen für diesen Monat.</p>
        ) : (
          <div className="space-y-3">
            {invoices.map((inv) => {
              const stage = tabFor(inv.invoiceId);
              const input: ReminderTokenInput = {
                name: inv.studentName,
                totalCHF: inv.totalCHF,
                invoiceNumber: inv.invoiceNumber,
                month: inv.month,
                year: inv.year,
              };
              const rendered = ready && templates ? renderReminder(templates[`stage${stage}`], input) : "";
              const active = copyState?.key === inv.invoiceId;
              const due = dueReminderStage(inv.daysOverdue);
              return (
                <div key={inv.invoiceId} className="rounded-xl border border-slate-200 p-3">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <div className="min-w-0">
                      <span className="text-sm font-semibold text-slate-800">{inv.studentName}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        {inv.invoiceNumber || "ohne Nr."} · {formatCHF(inv.totalCHF)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500">fällig {inv.dueDate}</span>
                      {inv.daysOverdue < 0 ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                          fällig in {-inv.daysOverdue} Tagen
                        </span>
                      ) : (
                        <span
                          className={`rounded-full px-2 py-0.5 font-medium ${
                            inv.daysOverdue > 60
                              ? "bg-red-100 text-red-700"
                              : inv.daysOverdue > 30
                                ? "bg-orange-100 text-orange-800"
                                : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {inv.daysOverdue} Tage überfällig
                        </span>
                      )}
                      {due && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">
                          → {due.label}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {STAGE_TABS.map(({ stage: s, label }) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setTabs((t) => ({ ...t, [inv.invoiceId]: s }))}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                          stage === s
                            ? "border-slate-800 bg-slate-800 text-white"
                            : "border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-800"
                        }`}
                      >
                        {label}
                        {due?.stage === s && <span className="ml-1 text-[10px]" title="empfohlen">•</span>}
                      </button>
                    ))}
                  </div>

                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5 font-mono text-xs leading-relaxed text-slate-700">
                    {ready ? rendered : status === "error" ? "" : "Vorlagen werden geladen …"}
                  </pre>

                  <div className="mt-2 flex items-center justify-end">
                    <button
                      type="button"
                      disabled={!ready}
                      onClick={() => onCopy(inv, rendered)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        active && copyState?.kind === "ok"
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : active && copyState?.kind === "error"
                            ? "border-red-300 bg-red-50 text-red-700"
                            : "border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-800"
                      }`}
                    >
                      {active && copyState?.kind === "ok"
                        ? "Kopiert ✓"
                        : active && copyState?.kind === "error"
                          ? "Fehler ✕"
                          : "Kopieren"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
