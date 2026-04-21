"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return [current - 1, current, current + 1];
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>Rechnungshistorie</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <select value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">Alle Jahre</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </select>
        <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          <option value="">Alle Schüler</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Alle Status</option>
          <option value="sent">Gesendet</option>
          <option value="created">Erstellt</option>
          <option value="pending">Ausstehend</option>
        </select>
      </div>

      <div style={{
        background: "#0F6E56",
        color: "white",
        padding: "12px 16px",
        borderRadius: 8,
        marginBottom: 16,
        display: "inline-block",
        fontWeight: "bold",
        fontSize: 18,
      }}>
        Total: CHF {rows.reduce((sum, r) => sum + r.totalCHF, 0).toFixed(2)}
        <span style={{ fontSize: 13, fontWeight: "normal", marginLeft: 12 }}>
          ({rows.length} {rows.length === 1 ? "Rechnung" : "Rechnungen"})
        </span>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", background: "white" }}>
        <thead>
          <tr>
            <th>Monat</th>
            <th>Student</th>
            <th>Sessions</th>
            <th>Total CHF</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr style={{ borderTop: "1px solid #eee" }}>
              <td colSpan={6} style={{ padding: 16, color: "#666" }}>
                Keine Rechnungen gefunden. Sobald Sessions vorhanden sind, erscheinen hier ausstehende Eintraege.
              </td>
            </tr>
          ) : rows.map((invoice) => {
            const statusText = getStatus(invoice);
            const sessionCount = JSON.parse(invoice.sessionIds || "[]").length;
            return (
              <tr key={invoice.id} style={{ borderTop: "1px solid #eee" }}>
                <td>{getPeriodLabel(invoice.month, invoice.year)}</td>
                <td>{invoice.student.name}</td>
                <td>{sessionCount}</td>
                <td>{formatAmount(invoice.totalCHF)}</td>
                <td>
                  <span
                    style={{
                      padding: "4px 8px",
                      borderRadius: 999,
                      background:
                        statusText === "Gesendet"
                          ? "#DDF5EA"
                          : statusText === "Erstellt"
                            ? "#ECECEC"
                            : "#FFECCB",
                    }}
                  >
                    {statusText}
                  </span>
                </td>
                <td style={{ display: "flex", gap: 8, padding: 8 }}>
                  <Link href={`/invoice/${invoice.studentId}/${invoice.year}/${invoice.month}`}>
                    Preview
                  </Link>
                  {invoice.pdfPath ? (
                    <a href={invoice.pdfPath} target="_blank">
                      Download
                    </a>
                  ) : (
                    <span style={{ color: "#999" }}>Download</span>
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
                            body: JSON.stringify({
                              invoiceId: invoice.id,
                              forceResend: true,
                            }),
                          });
                          data = await response.json();
                        }
                        if (response.ok) loadInvoices();
                        else alert(data.error ?? "Versand fehlgeschlagen.");
                      }}
                    >
                      Resend
                    </button>
                  ) : (
                    <span style={{ color: "#999" }}>Noch nicht generiert</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
