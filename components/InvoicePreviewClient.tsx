"use client";

import { useEffect, useMemo, useState } from "react";
import { formatAmount, formatDate, formatDuration, getPeriodLabel } from "@/lib/invoice";
import {
  buildWhatsAppUrl,
  buildWhatsAppValues,
  defaultWhatsAppTemplate,
  renderWhatsAppTemplate,
} from "@/lib/whatsapp";

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
type TutorSettings = {
  name: string;
  email: string;
  address: string;
  phone: string;
  iban: string;
  bankName: string;
};

type Invoice = {
  id: string;
  sentAt: string | null;
  invoiceNumber?: string | null;
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
  const [generatedPdfUrl, setGeneratedPdfUrl] = useState<string | null>(null);
  const [settings, setSettings] = useState<TutorSettings | null>(null);
  const [sendState, setSendState] = useState<string>("");
  const [previewNonce, setPreviewNonce] = useState(0);
  const [parentName, setParentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [template, setTemplate] = useState(defaultWhatsAppTemplate);
  const [copyState, setCopyState] = useState("");

  const storageKey = `wa-template-${studentId}`;

  useEffect(() => {
    void Promise.all([
      fetch(`/api/sessions?studentId=${studentId}&year=${year}&month=${month}`).then((r) => r.json()),
      fetch(`/api/students/${studentId}`).then((r) => r.json()),
      fetch(`/api/invoices?studentId=${studentId}&year=${year}`).then((r) => r.json()),
      fetch("/api/settings").then((r) => (r.ok ? r.json() : null)),
    ]).then(([sessionData, studentData, invoices, settingsData]) => {
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
      if (existing) {
        setInvoice(existing);
        if (existing.pdfPath) setGeneratedPdfUrl(existing.pdfPath as string);
      }
      if (settingsData) setSettings(settingsData as TutorSettings);
    });
  }, [studentId, year, month]);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (stored) setTemplate(stored);
  }, [storageKey]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, template);
  }, [storageKey, template]);

  const totals = useMemo(() => {
    const totalMinutes = sessions.reduce((sum, s) => sum + s.durationMin, 0);
    const totalCHF = sessions.reduce((sum, s) => sum + s.amountCHF, 0);
    return { totalMinutes, totalCHF };
  }, [sessions]);

  const generateInvoice = async (): Promise<{ invoiceId: string; pdfUrl?: string } | null> => {
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
    setGeneratedPdfUrl(typeof data.pdfUrl === "string" ? data.pdfUrl : null);
    setPreviewNonce((n) => n + 1);
    return { invoiceId: data.invoiceId as string, pdfUrl: data.pdfUrl as string | undefined };
  };

  const sendInvoice = async () => {
    setSendState("Sende Rechnung...");
    const generated = invoice?.id ? { invoiceId: invoice.id, pdfUrl: generatedPdfUrl ?? undefined } : await generateInvoice();
    if (!generated) return;
    const invoiceId = generated.invoiceId;

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
  const waMessage = useMemo(() => {
    const values = buildWhatsAppValues({
      studentName: student?.name ?? "Schueler",
      parentName,
      year,
      month,
      totalCHF: totals.totalCHF,
      invoiceNumber: invoice?.invoiceNumber ?? undefined,
      tutorName: settings?.name ?? undefined,
    });
    return renderWhatsAppTemplate(template, values);
  }, [student?.name, parentName, year, month, totals.totalCHF, invoice?.invoiceNumber, template, settings?.name]);

  const openWhatsAppWithPdf = async () => {
    const generated = invoice?.id ? { invoiceId: invoice.id, pdfUrl: generatedPdfUrl ?? undefined } : await generateInvoice();
    if (!generated) return;
    const pdfLink =
      generated.pdfUrl ??
      generatedPdfUrl ??
      `/api/invoice/preview?studentId=${studentId}&year=${year}&month=${month}`;
    const text = `${waMessage}\n\nPDF: ${pdfLink}`;
    window.open(buildWhatsAppUrl(text, parentPhone), "_blank");
  };

  const copyWhatsAppText = async () => {
    try {
      await navigator.clipboard.writeText(waMessage);
      setCopyState("WhatsApp-Text kopiert.");
    } catch {
      setCopyState("Kopieren fehlgeschlagen.");
    }
  };

  const resetTemplate = () => {
    setTemplate(defaultWhatsAppTemplate);
    setCopyState("Template zurueckgesetzt.");
  };

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 lg:grid-cols-[40%_1fr]">
        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Rechnungsdetails</h2>
            <p className="mt-2 text-sm text-gray-700">
              <strong className="text-gray-900">{student?.name ?? "..."}</strong>
              <br />
              {getPeriodLabel(month, year)}
            </p>
            <p className="mt-2 text-sm text-gray-600">
              Lektionen: {sessions.length}
              <br />
              Total Stunden: {(totals.totalMinutes / 60).toFixed(2)}h
              <br />
              Total: <span className="font-semibold text-[#0F6E56]">{formatAmount(totals.totalCHF)}</span>
            </p>
          </div>

          <ul className="max-h-56 space-y-1 overflow-auto rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm text-gray-700">
            {sessions.map((s) => (
              <li key={s.id}>
                {formatDate(new Date(s.date))} — {formatDuration(s.durationMin)} — {formatAmount(s.amountCHF)}
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.open(downloadUrl, "_blank")}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Download PDF
            </button>
            <button
              type="button"
              onClick={() => void sendInvoice()}
              disabled={!canSend}
              title={canSend ? "" : "Bitte E-Mail-Adresse des Schülers hinterlegen"}
              className="rounded-md bg-[#0F6E56] px-3 py-2 text-sm font-medium text-white hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Send to student
            </button>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900">WhatsApp Nachricht</h3>
              <button
                type="button"
                onClick={resetTemplate}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
              >
                Reset template
              </button>
            </div>
            <p className="mb-2 text-xs text-gray-500">
              Platzhalter: {"{parentName}"}, {"{studentName}"}, {"{monthLabel}"}, {"{amountCHF}"}, {"{dueDate}"}, {"{invoiceNumber}"}, {"{tutorName}"}
            </p>
            <div className="mb-2 grid grid-cols-1 gap-2 md:grid-cols-2">
              <input
                value={parentName}
                onChange={(e) => setParentName(e.target.value)}
                placeholder="Elternname (optional)"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                value={parentPhone}
                onChange={(e) => setParentPhone(e.target.value)}
                placeholder="WhatsApp Nummer (optional)"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={8}
              className="w-full rounded-md border border-gray-300 p-3 text-sm"
            />
            <textarea
              value={waMessage}
              readOnly
              rows={8}
              className="mt-2 w-full rounded-md border border-gray-200 bg-gray-50 p-3 text-sm"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copyWhatsAppText()}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Copy WhatsApp text
              </button>
              <button
                type="button"
                onClick={() => window.open(buildWhatsAppUrl(waMessage, parentPhone), "_blank")}
                className="rounded-md bg-[#0F6E56] px-3 py-2 text-sm font-medium text-white hover:opacity-95"
              >
                Open in WhatsApp
              </button>
              <button
                type="button"
                onClick={() => void openWhatsAppWithPdf()}
                className="rounded-md border border-[#0F6E56] bg-white px-3 py-2 text-sm font-medium text-[#0F6E56] hover:bg-teal-50"
              >
                WhatsApp with PDF link
              </button>
            </div>
            {copyState ? <p className="mt-2 text-xs text-[#0F6E56]">{copyState}</p> : null}
          </div>

          {sentDate ? (
            <p className="text-sm text-[#0F6E56]">Sent on {sentDate}</p>
          ) : null}
          {sendState ? <p className="text-sm text-gray-700">{sendState}</p> : null}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
          <iframe
            src={previewUrl}
            className="h-[78vh] w-full rounded-lg border border-gray-200"
            title="Invoice Preview"
          />
        </section>
      </div>
    </main>
  );
}
