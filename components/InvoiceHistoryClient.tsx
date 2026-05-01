"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { useGlobalIncomeSummary } from "@/hooks/useGlobalIncomeSummary";
import { formatAmount, getInvoiceDueDate, getPeriodLabel } from "@/lib/invoice";
import { formatCHF } from "@/lib/ui-format";

type InvoiceRow = {
  id: string;
  studentId: string;
  month: number;
  year: number;
  totalCHF: number;
  sessionIds: string;
  sentAt: string | null;
  paidAt: string | null;
  pdfPath: string | null;
  isVirtual?: boolean;
  student: { name: string };
};

type Student = { id: string; name: string };

type InvoiceRowUiState = "paid" | "overdue" | "sent" | "draft";
type InvoiceStatusUpdate = "sent" | "paid" | "reminder" | "unpaid";

function safeSessionCount(sessionIds: string): number {
  try {
    const parsed = JSON.parse(sessionIds || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function getRowUiState(invoice: InvoiceRow, now: Date): InvoiceRowUiState {
  if (invoice.paidAt) return "paid";
  if (invoice.sentAt) {
    const due = endOfDay(getInvoiceDueDate(invoice.year, invoice.month));
    if (now.getTime() > due.getTime()) return "overdue";
    return "sent";
  }
  return "draft";
}

function getRowClasses(state: InvoiceRowUiState): string {
  if (state === "paid") return "bg-emerald-50/65 hover:bg-emerald-50";
  if (state === "overdue") return "bg-red-50/65 hover:bg-red-50";
  if (state === "sent") return "bg-amber-50/65 hover:bg-amber-50";
  return "hover:bg-[#F8FBFF]";
}

function getStatusLabel(invoice: InvoiceRow, now: Date): string {
  const state = getRowUiState(invoice, now);
  if (state === "paid") return "Bezahlt";
  if (state === "overdue") return "Überfällig";
  if (state === "sent") return "Rechnung gesendet";
  if (invoice.pdfPath) return "Erstellt";
  return "Ausstehend";
}

const statusBadge: Record<string, string> = {
  Bezahlt: "bg-emerald-50 text-emerald-700",
  "Rechnung gesendet": "bg-amber-100 text-amber-800",
  "Überfällig": "bg-red-100 text-red-700",
  Erstellt: "bg-gray-100 text-gray-600",
  Ausstehend: "bg-orange-50 text-orange-700",
};

/** Archiv: feste Jahres-Verdienste (nicht aus der Tabelle berechnet). */
const FIXED_YEAR_EARNINGS_CHF: Readonly<Record<number, number>> = {
  2024: 16534.25,
  2025: 55705.5,
};

export function InvoiceHistoryClient() {
  const { monthIncome, ytdIncome, loading: incomeLoading } = useGlobalIncomeSummary();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  /** Default: laufendes Jahr — sonst lädt «Alle Jahre» sehr lange und die Summe ist nicht mit «Jahr gesamt» vergleichbar. */
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [month, setMonth] = useState("");
  const [studentId, setStudentId] = useState("");
  const [status, setStatus] = useState("");
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [zipDownloading, setZipDownloading] = useState(false);
  const [selectedYearYtd, setSelectedYearYtd] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const loadInvoices = useCallback(async () => {
    const query = new URLSearchParams();
    if (year) query.set("year", year);
    if (month) query.set("month", month);
    if (studentId) query.set("studentId", studentId);
    if (status) query.set("status", status);
    setListLoading(true);
    try {
      const r = await fetch(`/api/invoices?${query.toString()}`);
      if (!r.ok) throw new Error("load");
      const data = (await r.json()) as unknown;
      const nextRows = Array.isArray(data) ? (data as InvoiceRow[]) : [];
      setRows(nextRows);
      setSelectedIds((prev) => {
        if (prev.size === 0) return prev;
        const existing = new Set(nextRows.map((row) => row.id));
        return new Set(Array.from(prev).filter((id) => existing.has(id)));
      });
    } catch {
      setRows([]);
    } finally {
      setListLoading(false);
    }
  }, [year, month, studentId, status]);

  useEffect(() => {
    void fetch("/api/students")
      .then((r) => r.json())
      .then((data) => setStudents(data ?? []));
  }, []);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  useEffect(() => {
    const selected = Number(year);
    if (!Number.isFinite(selected)) {
      setSelectedYearYtd(null);
      return;
    }
    const currentMonth = new Date().getMonth() + 1;
    void fetch(`/api/income-summary?year=${selected}&month=${currentMonth}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const v = body && Number.isFinite(body.ytdIncome) ? Number(body.ytdIncome) : null;
        setSelectedYearYtd(v);
      })
      .catch(() => setSelectedYearYtd(null));
  }, [year]);

  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return [current - 1, current, current + 1];
  }, []);

  const now = new Date();
  const calendarYear = now.getFullYear();

  const earningsByYear = useMemo(() => {
    const map = new Map<number, { totalCHF: number; count: number }>();
    for (const r of rows) {
      const y = r.year;
      const cur = map.get(y) ?? { totalCHF: 0, count: 0 };
      cur.totalCHF += r.totalCHF;
      cur.count += 1;
      map.set(y, cur);
    }
    return Array.from(map.entries())
      .map(([y, v]) => ({ year: y, totalCHF: v.totalCHF, count: v.count }))
      .sort((a, b) => b.year - a.year);
  }, [rows]);

  /** Dynamische Jahre aus der Tabelle + feste Archiv-Jahre 2024/2025 (keine Doppelzählung). */
  const yearCards = useMemo(() => {
    const fixedYears = [2025, 2024] as const;
    const dynamicBase = earningsByYear
      .filter((e) => FIXED_YEAR_EARNINGS_CHF[e.year] === undefined)
      .map((e) => ({ ...e, isFixed: false as const, isDashboardAligned: false as const }));
    const selectedYear = Number(year);
    const referenceYear = Number.isFinite(selectedYear) ? selectedYear : calendarYear;
    const referenceYtd = selectedYearYtd ?? ytdIncome;
    const hasCurrentYear = dynamicBase.some((e) => e.year === referenceYear);
    const dynamic = dynamicBase.map((e) =>
      e.year === referenceYear
        ? { ...e, totalCHF: referenceYtd, isDashboardAligned: true as const }
        : e
    );
    if (!hasCurrentYear) {
      dynamic.push({
        year: referenceYear,
        totalCHF: referenceYtd,
        count: 0,
        isFixed: false as const,
        isDashboardAligned: true as const,
      });
    }
    const fixed = fixedYears.map((y) => ({
      year: y,
      totalCHF: FIXED_YEAR_EARNINGS_CHF[y],
      count: null as number | null,
      isFixed: true as const,
      isDashboardAligned: false as const,
    }));
    return [...dynamic, ...fixed].sort((a, b) => b.year - a.year);
  }, [earningsByYear, calendarYear, ytdIncome, year, selectedYearYtd]);

  const hasNarrowFilters = Boolean(month || studentId || status);

  const selectClass =
    "w-full min-w-0 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 outline-none transition focus:border-[#4A7FC1] focus:ring-2 focus:ring-[#4A7FC1]/20 sm:w-auto sm:min-w-[8.5rem]";

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.id)),
    [rows, selectedIds]
  );
  const selectedCount = selectedRows.length;

  const ensurePersistedInvoice = useCallback(async (row: InvoiceRow): Promise<InvoiceRow> => {
    if (!row.isVirtual) return row;
    const response = await fetch("/api/invoice/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: row.studentId, year: row.year, month: row.month }),
    });
    const data = (await response.json()) as { error?: string; invoiceId?: string; pdfUrl?: string };
    if (!response.ok || !data.invoiceId) {
      throw new Error(data.error ?? "Rechnung konnte nicht erzeugt werden.");
    }
    const promoted: InvoiceRow = {
      ...row,
      id: data.invoiceId,
      pdfPath: typeof data.pdfUrl === "string" ? data.pdfUrl : row.pdfPath,
      isVirtual: false,
    };
    setRows((prev) => prev.map((r) => (r.id === row.id ? promoted : r)));
    setSelectedIds((prev) => {
      if (!prev.has(row.id)) return prev;
      const next = new Set(prev);
      next.delete(row.id);
      next.add(promoted.id);
      return next;
    });
    return promoted;
  }, []);

  const updateRowStatusLocally = useCallback((invoiceId: string, status: InvoiceStatusUpdate) => {
    const nowIso = new Date().toISOString();
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== invoiceId) return row;
        if (status === "paid") return { ...row, sentAt: row.sentAt ?? nowIso, paidAt: nowIso };
        if (status === "sent") return { ...row, sentAt: nowIso, paidAt: null };
        if (status === "unpaid") return { ...row, paidAt: null };
        if (status === "reminder") return { ...row, sentAt: row.sentAt ?? nowIso };
        return row;
      })
    );
  }, []);

  const updateSingleStatus = useCallback(
    async (invoice: InvoiceRow, status: InvoiceStatusUpdate) => {
      setActionBusyId(invoice.id);
      try {
        let target = invoice;
        if (target.isVirtual) {
          target = await ensurePersistedInvoice(target);
        }

        if (status === "reminder") {
          const response = await fetch("/api/invoice/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ invoiceId: target.id, forceResend: true }),
          });
          const data = await response.json();
          if (!response.ok) {
            alert(data.error ?? "Reminder konnte nicht gesendet werden.");
            return;
          }
          await fetch(`/api/invoices/${target.id}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "reminder" }),
          });
          updateRowStatusLocally(target.id, "reminder");
          return;
        }

        const response = await fetch(`/api/invoices/${target.id}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        const data = await response.json();
        if (response.ok) updateRowStatusLocally(target.id, status);
        else alert(data.error ?? "Status konnte nicht aktualisiert werden.");
      } catch (error) {
        alert(error instanceof Error ? error.message : "Status konnte nicht aktualisiert werden.");
      } finally {
        setActionBusyId(null);
      }
    },
    [ensurePersistedInvoice, updateRowStatusLocally]
  );

  const applyBulkStatus = useCallback(
    async (status: Exclude<InvoiceStatusUpdate, "reminder">) => {
      if (selectedRows.length === 0) return;
      setBulkBusy(true);
      try {
        await Promise.all(
          selectedRows.map(async (row) => {
            try {
              const target = await ensurePersistedInvoice(row);
              const response = await fetch(`/api/invoices/${target.id}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status }),
              });
              if (response.ok) updateRowStatusLocally(target.id, status);
            } catch {
              // Continue with other rows; one failure should not block the bulk action.
            }
          })
        );
      } finally {
        setBulkBusy(false);
      }
    },
    [selectedRows, ensurePersistedInvoice, updateRowStatusLocally]
  );

  const downloadMonthZip = async () => {
    if (!year || !month) {
      alert("Bitte Jahr und Monat wählen, um alle Rechnungen des Monats herunterzuladen.");
      return;
    }

    setZipDownloading(true);
    try {
      const url = `/api/invoices/download?year=${year}&month=${month}`;
      const response = await fetch(url);
      if (!response.ok) {
        let message = "ZIP-Download fehlgeschlagen.";
        try {
          const body = (await response.json()) as { error?: string };
          if (typeof body.error === "string" && body.error.trim().length > 0) {
            message = body.error;
          }
        } catch {
          const fallback = await response.text();
          if (fallback.trim().length > 0) message = fallback;
        }
        alert(message);
        return;
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `rechnungen-${year}-${String(month).padStart(2, "0")}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      alert("ZIP-Download fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setZipDownloading(false);
    }
  };

  return (
    <DashboardShell monthIncome={monthIncome} ytdIncome={ytdIncome} incomeLoading={incomeLoading}>
      <div className="min-w-0 space-y-5">

        {/* Page header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <h1 className="min-w-0 text-xl font-bold text-gray-900">Rechnungen</h1>

          {/* Filters */}
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-stretch sm:justify-end">
            <select value={year} onChange={(e) => setYear(e.target.value)} className={selectClass}>
              <option value="">Alle Jahre</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </select>
            <select value={month} onChange={(e) => setMonth(e.target.value)} className={selectClass}>
              <option value="">Alle Monate</option>
              {Array.from({ length: 12 }, (_, idx) => idx + 1).map((m) => (
                <option key={m} value={String(m)}>{new Intl.DateTimeFormat("de-CH", { month: "long" }).format(new Date(2026, m - 1, 1))}</option>
              ))}
            </select>
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className={selectClass}>
              <option value="">Alle Schüler</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
              <option value="">Alle Status</option>
              <option value="paid">Bezahlt</option>
              <option value="sent">Rechnung gesendet</option>
              <option value="created">Erstellt</option>
              <option value="pending">Ausstehend</option>
            </select>
            <button
              type="button"
              onClick={() => void downloadMonthZip()}
              disabled={zipDownloading}
              className="w-full shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-[#4A7FC1] hover:text-[#4A7FC1] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {zipDownloading ? "ZIP wird erstellt..." : "Monat als ZIP"}
            </button>
          </div>
        </div>

        {/* Verdienst pro Jahr — je Kalenderjahr eine Box aus den sichtbaren Tabellenzeilen */}
        <section className="min-w-0 space-y-2">
          <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
            <h2 className="text-sm font-semibold text-gray-800">Verdienst pro Jahr</h2>
            <p className="text-[11px] leading-snug text-gray-500">
              2024 und 2025 sind fest hinterlegt; andere Jahre aus der Tabelle unten. «Dieser Monat» / «Jahr gesamt» oben gelten nur für {calendarYear} (Kalender + Abos).
            </p>
          </div>
          {hasNarrowFilters && !listLoading ? (
            <p className="text-[11px] text-amber-800">
              Monats-, Schüler- oder Status-Filter aktiv — die Boxen zeigen nur den gefilterten Ausschnitt.
            </p>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-stretch gap-3">
            {listLoading ? (
              <div className="flex min-h-[5.5rem] min-w-[9rem] shrink-0 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50/80 px-3 py-4">
                <LoadingSpinner size={24} label="Tabelle …" />
              </div>
            ) : null}
            {yearCards.map(({ year: y, totalCHF, count, isFixed, isDashboardAligned }) => {
              const isCurrentYear = !isFixed && y === calendarYear;
              return (
                <div
                  key={y}
                  className={`min-w-[9.5rem] flex-1 rounded-2xl border px-4 py-3 shadow-sm sm:max-w-[14rem] sm:flex-none ${
                    isCurrentYear
                      ? "border-[#4A7FC1] bg-[#EBF4FF]"
                      : isFixed
                        ? "border-gray-200 bg-gray-50/90"
                        : "border-gray-100 bg-white"
                  }`}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                    Jahr {y}
                    {isCurrentYear ? <span className="ml-1 font-medium text-[#4A7FC1]">(aktuell)</span> : null}
                    {isFixed ? <span className="ml-1 font-medium text-gray-500">(fix)</span> : null}
                  </p>
                  <p className={`mt-1.5 break-words text-xl font-bold tabular-nums sm:text-2xl ${isCurrentYear ? "text-[#4A7FC1]" : "text-gray-900"}`}>
                    {formatCHF(totalCHF)}
                  </p>
                  <p className="mt-1 text-[11px] text-gray-500">
                    {isFixed
                      ? "Fest hinterlegt (Archiv)"
                      : isDashboardAligned
                        ? "Aus Dashboard (Kalender + Abos + Q1)"
                        : `${count} ${count === 1 ? "Rechnungszeile" : "Rechnungszeilen"}`}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Table */}
        <div className="relative min-w-0 overflow-x-auto rounded-2xl border border-blue-100 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50/60 px-3 py-2 sm:px-5">
            <div className="text-xs text-gray-600">
              {selectedCount > 0 ? `${selectedCount} ausgewählt` : "Keine Auswahl"}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const allSelected =
                    rows.length > 0 &&
                    rows.every((row) => selectedIds.has(row.id));
                  if (allSelected) setSelectedIds(new Set());
                  else setSelectedIds(new Set(rows.map((row) => row.id)));
                }}
                disabled={rows.length === 0 || bulkBusy}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-[#4A7FC1] hover:text-[#4A7FC1] disabled:opacity-40"
              >
                Alle auswählen
              </button>
              <button
                type="button"
                onClick={() => void applyBulkStatus("sent")}
                disabled={selectedCount === 0 || bulkBusy}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-amber-300 hover:text-amber-700 disabled:opacity-40"
              >
                Als gesendet markieren
              </button>
              <button
                type="button"
                onClick={() => void applyBulkStatus("paid")}
                disabled={selectedCount === 0 || bulkBusy}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-40"
              >
                Als bezahlt markieren
              </button>
              <button
                type="button"
                onClick={() => void applyBulkStatus("unpaid")}
                disabled={selectedCount === 0 || bulkBusy}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-orange-300 hover:text-orange-800 disabled:opacity-40"
              >
                Als unbezahlt markieren
              </button>
            </div>
          </div>
          {listLoading ? (
            <div className="flex min-h-[14rem] flex-col items-center justify-center gap-3 py-12">
              <LoadingSpinner size={32} label="Rechnungen werden geladen …" />
            </div>
          ) : null}
          <table className={`min-w-[44rem] w-full divide-y divide-gray-100 text-sm sm:min-w-full ${listLoading ? "hidden" : ""}`}>
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                <th className="whitespace-nowrap px-3 py-3.5 sm:px-5">
                  <input
                    type="checkbox"
                    checked={
                      rows.length > 0 &&
                      rows.every((row) => selectedIds.has(row.id))
                    }
                    onChange={(e) => {
                      if (e.target.checked) setSelectedIds(new Set(rows.map((row) => row.id)));
                      else setSelectedIds(new Set());
                    }}
                  />
                </th>
                <th className="whitespace-nowrap px-3 py-3.5 sm:px-5">Monat</th>
                <th className="whitespace-nowrap px-3 py-3.5 sm:px-5">Schüler</th>
                <th className="whitespace-nowrap px-3 py-3.5 sm:px-5">Sessions</th>
                <th className="whitespace-nowrap px-3 py-3.5 sm:px-5">Total CHF</th>
                <th className="whitespace-nowrap px-3 py-3.5 sm:px-5">Status</th>
                <th className="min-w-[12rem] px-3 py-3.5 sm:min-w-0 sm:px-5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-sm text-gray-400 sm:px-5">
                    Keine Rechnungen gefunden. Sobald Sessions vorhanden sind, erscheinen hier ausstehende Einträge.
                  </td>
                </tr>
              ) : rows.map((invoice) => {
                const statusText = getStatusLabel(invoice, now);
                const rowState = getRowUiState(invoice, now);
                const dueDate = endOfDay(getInvoiceDueDate(invoice.year, invoice.month));
                const isBusy = actionBusyId === invoice.id;
                const sessionCount = safeSessionCount(invoice.sessionIds);
                return (
                  <tr key={invoice.id} className={`transition-colors ${getRowClasses(rowState)}`}>
                    <td className="px-3 py-3 sm:px-5">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(invoice.id)}
                        onChange={(e) => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(invoice.id);
                            else next.delete(invoice.id);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-medium text-gray-800 sm:px-5">{getPeriodLabel(invoice.month, invoice.year)}</td>
                    <td className="max-w-[10rem] truncate px-3 py-3 text-gray-700 sm:max-w-none sm:whitespace-normal sm:px-5" title={invoice.student.name}>{invoice.student.name}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-gray-600 sm:px-5">{sessionCount}</td>
                    <td className="whitespace-nowrap px-3 py-3 font-semibold text-gray-800 sm:px-5">{formatAmount(invoice.totalCHF)}</td>
                    <td className="px-3 py-3 sm:px-5">
                      <span className={`inline-block max-w-full truncate rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge[statusText]}`} title={statusText}>
                        {statusText}
                      </span>
                      {rowState !== "paid" && invoice.sentAt && (
                        <div className="mt-1 text-[11px] text-gray-500">
                          Fällig bis {new Intl.DateTimeFormat("de-CH").format(dueDate)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 sm:px-5">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Link
                          href={`/invoice/${invoice.studentId}/${invoice.year}/${invoice.month}`}
                          className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-[#4A7FC1] hover:text-[#4A7FC1]"
                        >
                          Vorschau
                        </Link>
                        {invoice.pdfPath ? (
                          <a
                            href={invoice.pdfPath}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-[#4A7FC1] hover:text-[#4A7FC1]"
                          >
                            Download
                          </a>
                        ) : (
                          <span className="rounded-lg border border-gray-100 px-2.5 py-1 text-xs font-medium text-gray-300">
                            PDF View
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={Boolean(invoice.isVirtual) || !invoice.pdfPath || Boolean(invoice.sentAt) || isBusy}
                          onClick={() => void updateSingleStatus(invoice, "sent")}
                          className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-amber-300 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Rechnung gesendet
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(invoice.isVirtual) || !invoice.sentAt || Boolean(invoice.paidAt) || isBusy}
                          onClick={() => void updateSingleStatus(invoice, "reminder")}
                          className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                            rowState === "overdue"
                              ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
                              : "border-gray-200 text-gray-600 hover:border-[#4A7FC1] hover:text-[#4A7FC1]"
                          }`}
                        >
                          Reminder
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(invoice.isVirtual) || Boolean(invoice.paidAt) || isBusy}
                          onClick={() => void updateSingleStatus(invoice, "paid")}
                          className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Gezahlt
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(invoice.isVirtual) || !invoice.paidAt || isBusy}
                          onClick={() => void updateSingleStatus(invoice, "unpaid")}
                          className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-orange-300 hover:text-orange-800 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Nicht bezahlt
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardShell>
  );
}
