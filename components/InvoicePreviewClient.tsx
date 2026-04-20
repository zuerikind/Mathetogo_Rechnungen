"use client";

import { useEffect, useMemo, useState } from "react";
import { formatAmount, formatDate, formatDuration, getPeriodLabel } from "@/lib/invoice";

type Session = {
  id: string;
  date: string;
  durationMin: number;
  amountCHF: number;
};

type Student = {
  id: string;
  name: string;
  email: string | null;
};

type Invoice = {
  id: string;
  sentAt: string | null;
};

type Props = {
  studentId: string;
  year: number;
  month: number;
};

export function InvoicePreviewClient({ studentId, year, month }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [student, setStudent] = useState<Student | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [sendState, setSendState] = useState<string>("");
  const [previewNonce, setPreviewNonce] = useState(0);

  useEffect(() => {
    void Promise.all([
      fetch(`/api/sessions?studentId=${studentId}&year=${year}&month=${month}`).then((r) => r.json()),
      fetch(`/api/students/${studentId}`).then((r) => r.json()),
      fetch(`/api/invoices?studentId=${studentId}&year=${year}`).then((r) => r.json()),
    ]).then(([sessionData, studentData, invoices]) => {
      if (Array.isArray(sessionData)) {
        setSessions(sessionData);
      } else {
        setSessions([]);
      }
      if (studentData && !("error" in studentData)) {
        setStudent(studentData as Student);
      } else {
        setStudent(null);
      }
      const existing = (invoices ?? []).find(
        (entry: { month: number }) => entry.month === month
      );
      if (existing) setInvoice(existing);
    });
  }, [studentId, year, month]);

  const totals = useMemo(() => {
    const totalMinutes = sessions.reduce((sum, s) => sum + s.durationMin, 0);
    const totalCHF = sessions.reduce((sum, s) => sum + s.amountCHF, 0);
    return { totalMinutes, totalCHF };
  }, [sessions]);

  const generateInvoice = async (): Promise<string | null> => {
    const response = await fetch("/api/invoice/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, year, month }),
    });
    const data = await response.json();
    if (!response.ok) {
      setSendState(data.error ?? "Fehler beim Generieren.");
      return null;
    }
    setInvoice((old) => ({ id: data.invoiceId, sentAt: old?.sentAt ?? null }));
    setPreviewNonce((n) => n + 1);
    return data.invoiceId as string;
  };

  const sendInvoice = async () => {
    setSendState("Sende Rechnung...");
    const invoiceId = invoice?.id ?? (await generateInvoice());
    if (!invoiceId) return;

    let response = await fetch("/api/invoice/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId }),
    });
    let data = await response.json();

    if (response.status === 409 && data.alreadySent) {
      const confirmed = window.confirm(data.error);
      if (!confirmed) {
        setSendState("Versand abgebrochen.");
        return;
      }
      response = await fetch("/api/invoice/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId, forceResend: true }),
      });
      data = await response.json();
    }

    if (!response.ok) {
      setSendState(data.error ?? "Fehler beim Versand.");
      return;
    }

    setInvoice({ id: invoiceId, sentAt: data.sentAt });
    setPreviewNonce((n) => n + 1);
    setSendState(`Sent to ${data.sentTo} ✓`);
  };

  const previewUrl = `/api/invoice/preview?studentId=${studentId}&year=${year}&month=${month}&_=${previewNonce}`;
  const downloadUrl = invoice ? `/invoices/${year}-${String(month).padStart(2, "0")}-${studentId}.pdf` : previewUrl;
  const sentDate = invoice?.sentAt ? formatDate(new Date(invoice.sentAt)) : null;
  const canSend = Boolean(student?.email);

  return (
    <main style={{ padding: 24 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "stretch" }}>
        <section style={{ width: "40%", background: "white", borderRadius: 10, padding: 16 }}>
          <h2>Rechnungsdetails</h2>
          <p>
            <strong>{student?.name ?? "..."}</strong>
            <br />
            {getPeriodLabel(month, year)}
          </p>
          <p>
            Lektionen: {sessions.length}
            <br />
            Total Stunden: {(totals.totalMinutes / 60).toFixed(2)}h
            <br />
            Total: {formatAmount(totals.totalCHF)}
          </p>

          <ul style={{ paddingLeft: 18, maxHeight: 220, overflow: "auto" }}>
            {sessions.map((s) => (
              <li key={s.id}>
                {formatDate(new Date(s.date))} — {formatDuration(s.durationMin)} — {formatAmount(s.amountCHF)}
              </li>
            ))}
          </ul>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              onClick={() => window.open(downloadUrl, "_blank")}
              style={{ padding: "8px 12px" }}
            >
              Download PDF
            </button>
            <button
              onClick={() => void sendInvoice()}
              disabled={!canSend}
              title={canSend ? "" : "Bitte E-Mail-Adresse des Schülers hinterlegen"}
              style={{ padding: "8px 12px" }}
            >
              Send to student
            </button>
          </div>

          {sentDate ? (
            <p style={{ marginTop: 8, color: "#0F6E56" }}>Sent on {sentDate}</p>
          ) : null}
          {sendState ? <p style={{ marginTop: 8 }}>{sendState}</p> : null}
        </section>

        <section style={{ width: "60%", background: "white", borderRadius: 10, padding: 8 }}>
          <iframe
            src={previewUrl}
            style={{ width: "100%", height: "78vh", border: "1px solid #ddd", borderRadius: 8 }}
            title="Invoice Preview"
          />
        </section>
      </div>
    </main>
  );
}
