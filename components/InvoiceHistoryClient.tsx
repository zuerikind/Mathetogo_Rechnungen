"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { formatAmount, getPeriodLabel } from "@/lib/invoice";

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

function getStatus(invoice: InvoiceRow): "Bezahlt" | "Rechnung gesendet" | "Erstellt" | "Ausstehend" {
  if (invoice.paidAt) return "Bezahlt";
  if (invoice.sentAt) return "Rechnung gesendet";
  if (invoice.pdfPath) return "Erstellt";
  return "Ausstehend";
}

const statusBadge: Record<string, string> = {
  Bezahlt: "bg-emerald-50 text-emerald-700",
  "Rechnung gesendet": "bg-green-50 text-green-700",
  Erstellt: "bg-gray-100 text-gray-600",
  Ausstehend: "bg-orange-50 text-orange-700",
};

export function InvoiceHistoryClient() {
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [studentId, setStudentId] = useState("");
  const [status, setStatus] = useState("");

  const loadInvoices = useCallback(() => {
    const query = new URLSearchParams();
    if (year) query.set("year", year);
    if (month) query.set("month", month);
    if (studentId) query.set("studentId", studentId);
    if (status) query.set("status", status);
    void fetch(`/api/invoices?${query.toString()}`)
      .then((r) => r.json())
      .then((data) => setRows(data ?? []));
  }, [year, month, studentId, status]);

  useEffect(() => {
    void fetch("/api/students")
      .then((r) => r.json())
      .then((data) => setStudents(data ?? []));
  }, []);

  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return [current - 1, current, current + 1];
  }, []);

  const total = rows.reduce((sum, r) => sum + r.totalCHF, 0);

  const selectClass =
    "w-full min-w-0 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 outline-none transition focus:border-[#4A7FC1] focus:ring-2 focus:ring-[#4A7FC1]/20 sm:w-auto sm:min-w-[8.5rem]";

  return (
    <DashboardShell monthIncome={0} ytdIncome={total}>
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
              onClick={() => {
                if (!year || !month) {
                  alert("Bitte Jahr und Monat wählen, um alle Rechnungen des Monats herunterzuladen.");
                  return;
                }
                const url = `/api/invoices/download?year=${year}&month=${month}`;
                window.open(url, "_blank");
              }}
              className="w-full shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-[#4A7FC1] hover:text-[#4A7FC1] sm:w-auto"
            >
              Monat als ZIP
            </button>
          </div>
        </div>

        {/* Total card */}
        <div className="flex min-w-0 flex-wrap items-stretch gap-3">
          <div className="min-w-0 flex-1 rounded-2xl border border-blue-100 bg-[#EBF4FF] px-4 py-3 shadow-sm sm:flex-none sm:px-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#4A7FC1]">Total</p>
            <p className="break-words text-xl font-bold tabular-nums text-[#4A7FC1] sm:text-2xl">CHF {total.toFixed(2)}</p>
          </div>
          <div className="min-w-0 flex-1 rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm sm:flex-none sm:px-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Rechnungen</p>
            <p className="text-xl font-bold tabular-nums text-gray-700 sm:text-2xl">{rows.length}</p>
          </div>
        </div>

        {/* Table */}
        <div className="min-w-0 overflow-x-auto rounded-2xl border border-blue-100 bg-white shadow-sm">
          <table className="min-w-[44rem] w-full divide-y divide-gray-100 text-sm sm:min-w-full">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400">
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
                  <td colSpan={6} className="px-3 py-10 text-center text-sm text-gray-400 sm:px-5">
                    Keine Rechnungen gefunden. Sobald Sessions vorhanden sind, erscheinen hier ausstehende Einträge.
                  </td>
                </tr>
              ) : rows.map((invoice) => {
                const statusText = getStatus(invoice);
                const sessionCount = JSON.parse(invoice.sessionIds || "[]").length;
                return (
                  <tr key={invoice.id} className="transition-colors hover:bg-[#F8FBFF]">
                    <td className="whitespace-nowrap px-3 py-3 font-medium text-gray-800 sm:px-5">{getPeriodLabel(invoice.month, invoice.year)}</td>
                    <td className="max-w-[10rem] truncate px-3 py-3 text-gray-700 sm:max-w-none sm:whitespace-normal sm:px-5" title={invoice.student.name}>{invoice.student.name}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-gray-600 sm:px-5">{sessionCount}</td>
                    <td className="whitespace-nowrap px-3 py-3 font-semibold text-gray-800 sm:px-5">{formatAmount(invoice.totalCHF)}</td>
                    <td className="px-3 py-3 sm:px-5">
                      <span className={`inline-block max-w-full truncate rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge[statusText]}`} title={statusText}>
                        {statusText}
                      </span>
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
                            Download
                          </span>
                        )}
                        {invoice.isVirtual ? (
                          <button
                            type="button"
                            onClick={async () => {
                              const response = await fetch("/api/invoice/generate", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  studentId: invoice.studentId,
                                  year: invoice.year,
                                  month: invoice.month,
                                }),
                              });
                              const data = await response.json();
                              if (response.ok) loadInvoices();
                              else alert(data.error ?? "Rechnung konnte nicht generiert werden.");
                            }}
                            className="rounded-lg border border-[#4A7FC1] bg-white px-2.5 py-1 text-xs font-semibold text-[#4A7FC1] transition hover:bg-[#EBF4FF]"
                          >
                            Generieren
                          </button>
                        ) : null}
                        {!invoice.isVirtual ? (
                          <button
                            type="button"
                            onClick={async () => {
                              let forceResend = false;
                              if (invoice.sentAt) {
                                const ok = window.confirm(
                                  `Diese Rechnung wurde bereits am ${new Intl.DateTimeFormat("de-CH").format(new Date(invoice.sentAt))} gesendet. Nochmals senden?`
                                );
                                if (!ok) return;
                                forceResend = true;
                              }
                              let response = await fetch("/api/invoice/send", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ invoiceId: invoice.id, forceResend }),
                              });
                              let data = await response.json();
                              if (response.status === 409 && data.alreadySent) {
                                const ok = window.confirm(data.error);
                                if (!ok) return;
                                response = await fetch("/api/invoice/send", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ invoiceId: invoice.id, forceResend: true }),
                                });
                                data = await response.json();
                              }
                              if (response.ok) loadInvoices();
                              else alert(data.error ?? "Versand fehlgeschlagen.");
                            }}
                            className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-[#4A7FC1] hover:text-[#4A7FC1]"
                          >
                            Rechnung senden
                          </button>
                        ) : (
                          <span className="text-xs text-gray-300">Noch nicht generiert</span>
                        )}
                        {!invoice.isVirtual && !invoice.sentAt ? (
                          <button
                            type="button"
                            onClick={async () => {
                              const response = await fetch(`/api/invoices/${invoice.id}/status`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ status: "sent" }),
                              });
                              const data = await response.json();
                              if (response.ok) loadInvoices();
                              else alert(data.error ?? "Status konnte nicht aktualisiert werden.");
                            }}
                            className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-[#4A7FC1] hover:text-[#4A7FC1]"
                          >
                            Als gesendet
                          </button>
                        ) : null}
                        {!invoice.isVirtual && !invoice.paidAt ? (
                          <button
                            type="button"
                            onClick={async () => {
                              const response = await fetch(`/api/invoices/${invoice.id}/status`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ status: "paid" }),
                              });
                              const data = await response.json();
                              if (response.ok) loadInvoices();
                              else alert(data.error ?? "Status konnte nicht aktualisiert werden.");
                            }}
                            className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-[#4A7FC1] hover:text-[#4A7FC1]"
                          >
                            Als bezahlt
                          </button>
                        ) : null}
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
