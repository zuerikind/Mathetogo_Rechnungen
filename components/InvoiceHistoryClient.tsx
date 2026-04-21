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
  pdfPath: string | null;
  isVirtual?: boolean;
  student: { name: string };
};

type Student = { id: string; name: string };

function getStatus(invoice: InvoiceRow): "Gesendet" | "Erstellt" | "Ausstehend" {
  if (invoice.sentAt) return "Gesendet";
  if (invoice.pdfPath) return "Erstellt";
  return "Ausstehend";
}

const statusBadge: Record<string, string> = {
  Gesendet: "bg-green-50 text-green-700",
  Erstellt: "bg-gray-100 text-gray-600",
  Ausstehend: "bg-orange-50 text-orange-700",
};

export function InvoiceHistoryClient() {
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [year, setYear] = useState("");
  const [studentId, setStudentId] = useState("");
  const [status, setStatus] = useState("");

  const loadInvoices = useCallback(() => {
    const query = new URLSearchParams();
    if (year) query.set("year", year);
    if (studentId) query.set("studentId", studentId);
    if (status) query.set("status", status);
    void fetch(`/api/invoices?${query.toString()}`)
      .then((r) => r.json())
      .then((data) => setRows(data ?? []));
  }, [year, studentId, status]);

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
    "rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 outline-none transition focus:border-[#4A7FC1] focus:ring-2 focus:ring-[#4A7FC1]/20";

  return (
    <DashboardShell monthIncome={0} ytdIncome={total}>
      <div className="space-y-5">

        {/* Page header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-gray-900">Rechnungen</h1>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <select value={year} onChange={(e) => setYear(e.target.value)} className={selectClass}>
              <option value="">Alle Jahre</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>{y}</option>
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
              <option value="sent">Gesendet</option>
              <option value="created">Erstellt</option>
              <option value="pending">Ausstehend</option>
            </select>
          </div>
        </div>

        {/* Total card */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-2xl border border-blue-100 bg-[#EBF4FF] px-5 py-3 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#4A7FC1]">Total</p>
            <p className="text-2xl font-bold text-[#4A7FC1]">CHF {total.toFixed(2)}</p>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white px-5 py-3 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Rechnungen</p>
            <p className="text-2xl font-bold text-gray-700">{rows.length}</p>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-2xl border border-blue-100 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                <th className="px-5 py-3.5">Monat</th>
                <th className="px-5 py-3.5">Schüler</th>
                <th className="px-5 py-3.5">Sessions</th>
                <th className="px-5 py-3.5">Total CHF</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-gray-400">
                    Keine Rechnungen gefunden. Sobald Sessions vorhanden sind, erscheinen hier ausstehende Einträge.
                  </td>
                </tr>
              ) : rows.map((invoice) => {
                const statusText = getStatus(invoice);
                const sessionCount = JSON.parse(invoice.sessionIds || "[]").length;
                return (
                  <tr key={invoice.id} className="transition-colors hover:bg-[#F8FBFF]">
                    <td className="px-5 py-3 font-medium text-gray-800">{getPeriodLabel(invoice.month, invoice.year)}</td>
                    <td className="px-5 py-3 text-gray-700">{invoice.student.name}</td>
                    <td className="px-5 py-3 text-gray-600">{sessionCount}</td>
                    <td className="px-5 py-3 font-semibold text-gray-800">{formatAmount(invoice.totalCHF)}</td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge[statusText]}`}>
                        {statusText}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
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
                            className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-[#4A7FC1] hover:text-[#4A7FC1]"
                          >
                            Download
                          </a>
                        ) : (
                          <span className="rounded-lg border border-gray-100 px-2.5 py-1 text-xs font-medium text-gray-300">
                            Download
                          </span>
                        )}
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
                            Erneut senden
                          </button>
                        ) : (
                          <span className="text-xs text-gray-300">Noch nicht generiert</span>
                        )}
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
