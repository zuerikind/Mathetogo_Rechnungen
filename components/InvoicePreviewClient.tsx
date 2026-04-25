"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DashboardShell } from "@/components/DashboardShell";
import { formatAmount, formatDate, formatDuration, getPeriodLabel } from "@/lib/invoice";
import {
  buildWhatsAppUrl,
  buildWhatsAppValues,
  defaultWhatsAppTemplate,
  renderWhatsAppTemplate,
} from "@/lib/whatsapp";
import { getSubscriptionInvoiceLines, type SubscriptionBillingInput } from "@/lib/subscription-billing";

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
  pdfPath?: string | null;
  month?: number;
  studentId?: string;
  student?: { name?: string };
};

type Props = {
  studentId: string;
  year: number;
  month: number;
};

export function InvoicePreviewClient({ studentId, year, month }: Props) {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionBillingInput[]>([]);
  const [student, setStudent] = useState<Student | null>(null);
  const [studentList, setStudentList] = useState<Student[]>([]);
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
      fetch("/api/students").then((r) => r.json()),
      fetch(`/api/invoices?year=${year}`).then((r) => r.json()),
      fetch(`/api/subscriptions?studentId=${encodeURIComponent(studentId)}`).then((r) => r.json()),
      fetch("/api/settings").then((r) => (r.ok ? r.json() : null)),
    ]).then(([sessionData, studentData, studentsData, invoices, subData, settingsData]) => {
      setSessions(Array.isArray(sessionData) ? sessionData : []);
      if (Array.isArray(subData)) {
        setSubscriptions(
          subData.map((s: SubscriptionBillingInput) => ({
            id: s.id,
            studentId: s.studentId,
            amountCHF: s.amountCHF,
            billingMethod: s.billingMethod,
            durationMonths: s.durationMonths,
            startMonth: s.startMonth,
            startYear: s.startYear,
          }))
        );
      } else {
        setSubscriptions([]);
      }
      const currentStudent =
        studentData && !("error" in studentData) ? (studentData as Student) : null;
      if (currentStudent) setStudent(currentStudent);

      const fromStudents = Array.isArray(studentsData) ? (studentsData as Student[]) : [];
      const invoiceRows = Array.isArray(invoices) ? (invoices as Invoice[]) : [];

      const mergedStudents = [...fromStudents];
      const seenIds = new Set(mergedStudents.map((s) => s.id));

      for (const row of invoiceRows) {
        if (!row.studentId || seenIds.has(row.studentId)) continue;
        mergedStudents.push({
          id: row.studentId,
          name: row.student?.name ?? row.studentId,
          email: null,
        });
        seenIds.add(row.studentId);
      }

      if (currentStudent && !seenIds.has(currentStudent.id)) {
        mergedStudents.push(currentStudent);
      }

      mergedStudents.sort((a, b) => a.name.localeCompare(b.name, "de-CH"));
      setStudentList(mergedStudents);

      const existing = invoiceRows.find(
        (entry) => entry.month === month && entry.studentId === studentId
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

  const subscriptionLines = useMemo(
    () => getSubscriptionInvoiceLines(subscriptions, year, month),
    [subscriptions, year, month]
  );

  const totals = useMemo(() => {
    const totalMinutes = sessions.reduce((sum, s) => sum + s.durationMin, 0);
    const sessionsCHF = sessions.reduce((sum, s) => sum + s.amountCHF, 0);
    const subscriptionCHF = subscriptionLines.reduce((sum, l) => sum + l.amountCHF, 0);
    return { totalMinutes, sessionsCHF, subscriptionCHF, totalCHF: sessionsCHF + subscriptionCHF };
  }, [sessions, subscriptionLines]);

  const generateInvoice = async (): Promise<{ invoiceId: string; pdfUrl?: string } | null> => {
    const response = await fetch("/api/invoice/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, year, month }),
    });
    const data = await response.json();
    if (!response.ok) { setSendState(data.error ?? "Fehler beim Generieren."); return null; }
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
      if (!confirmed) { setSendState("Versand abgebrochen."); return; }
      response = await fetch("/api/invoice/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId, forceResend: true }),
      });
      data = await response.json();
    }

    if (!response.ok) { setSendState(data.error ?? "Fehler beim Versand."); return; }
    setInvoice({ id: invoiceId, sentAt: data.sentAt });
    setPreviewNonce((n) => n + 1);
    setSendState(`Gesendet an ${data.sentTo} ✓`);
  };

  const previewUrl = `/api/invoice/preview?studentId=${studentId}&year=${year}&month=${month}&_=${previewNonce}`;
  // Always download the freshly rendered preview PDF (same as iframe), not a cached Supabase URL.
  const pdfDownloadUrl = `${previewUrl}&download=1`;
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
    const pdfLink = generated.pdfUrl ?? generatedPdfUrl ?? previewUrl;
    window.open(buildWhatsAppUrl(`${waMessage}\n\nPDF: ${pdfLink}`, parentPhone), "_blank");
  };

  const copyWhatsAppText = async () => {
    try {
      await navigator.clipboard.writeText(waMessage);
      setCopyState("WhatsApp-Text kopiert.");
    } catch {
      setCopyState("Kopieren fehlgeschlagen.");
    }
  };

  const inputClass = "w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none transition focus:border-[#4A7FC1] focus:ring-2 focus:ring-[#4A7FC1]/20";

  const nextStudentId = useMemo(() => {
    if (studentList.length <= 1) return null;
    const idx = studentList.findIndex((s) => s.id === studentId);
    if (idx < 0) return studentList[0]?.id ?? null;
    return studentList[(idx + 1) % studentList.length]?.id ?? null;
  }, [studentList, studentId]);

  return (
    <DashboardShell monthIncome={totals.totalCHF} ytdIncome={totals.totalCHF}>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,42%)_minmax(0,1fr)]">

        {/* Left panel: details + actions */}
        <div className="min-w-0 space-y-4">

          {/* Header info */}
          <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => router.back()}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-800"
              >
                ← Zurück
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!nextStudentId) return;
                  router.push(`/invoice/${nextStudentId}/${year}/${month}`);
                }}
                disabled={!nextStudentId}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-[#4A7FC1] hover:text-[#4A7FC1] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Nächster Schüler →
              </button>
            </div>
            <h2 className="text-base font-semibold text-gray-900">Rechnungsdetails</h2>
            <div className="mt-3 space-y-1 text-sm text-gray-700">
              <p className="font-semibold text-gray-900">{student?.name ?? "..."}</p>
              <p className="text-gray-500">{getPeriodLabel(month, year)}</p>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 min-[360px]:grid-cols-3">
              <div className="rounded-xl bg-gray-50 px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Lektionen</p>
                <p className="text-lg font-bold text-gray-800">{sessions.length}</p>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Stunden</p>
                <p className="text-lg font-bold text-gray-800">{(totals.totalMinutes / 60).toFixed(1)}h</p>
              </div>
              <div className="rounded-xl bg-[#EBF4FF] px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#4A7FC1]">Total Rechnung</p>
                <p className="text-lg font-bold text-[#4A7FC1]">{formatAmount(totals.totalCHF)}</p>
              </div>
            </div>
            {subscriptionLines.length > 0 && (
              <p className="mt-2 text-xs text-gray-500">
                Inkl. Abonnement (Rechnung): {subscriptionLines.map((l) => l.description).join(", ")} ·{" "}
                {formatAmount(totals.subscriptionCHF)}
              </p>
            )}
          </div>

          {/* Sessions list */}
          <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Sessions</p>
            <ul className="max-h-48 space-y-1 overflow-auto text-sm text-gray-700">
              {sessions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 odd:bg-gray-50">
                  <span className="shrink-0">{formatDate(new Date(s.date))}</span>
                  <span className="text-gray-400">{formatDuration(s.durationMin)}</span>
                  <span className="ml-auto font-medium sm:ml-0">{formatAmount(s.amountCHF)}</span>
                </li>
              ))}
              {subscriptionLines.map((l) => (
                <li
                  key={l.id}
                  className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-dashed border-[#4A7FC1]/30 bg-[#EBF4FF]/40 px-2 py-1.5 text-[#2B5FA0]"
                >
                  <span className="shrink-0">—</span>
                  <span className="text-gray-500">{l.description}</span>
                  <span className="ml-auto font-medium sm:ml-0">{formatAmount(l.amountCHF)}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Action buttons */}
          <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Aktionen</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => window.open(pdfDownloadUrl, "_blank")}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:border-[#4A7FC1] hover:text-[#4A7FC1]"
              >
                PDF herunterladen
              </button>
              <button
                type="button"
                onClick={() => void sendInvoice()}
                disabled={!canSend}
                title={canSend ? "" : "Bitte E-Mail-Adresse des Schülers hinterlegen"}
                className="rounded-xl bg-[#4A7FC1] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                An Schüler senden
              </button>
            </div>
            {sentDate && (
              <p className="mt-2 text-xs text-green-600">✓ Gesendet am {sentDate}</p>
            )}
            {sendState && (
              <p className="mt-2 text-xs text-gray-500">{sendState}</p>
            )}
          </div>

          {/* WhatsApp section */}
          <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">WhatsApp</p>
              <button
                type="button"
                onClick={() => { setTemplate(defaultWhatsAppTemplate); setCopyState("Template zurückgesetzt."); }}
                className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-500 transition hover:border-gray-300"
              >
                Reset
              </button>
            </div>
            <p className="mb-2 text-xs text-gray-400">
              Platzhalter: {"{parentName}"}, {"{studentName}"}, {"{monthLabel}"}, {"{amountCHF}"}, {"{dueDate}"}, {"{invoiceNumber}"}, {"{tutorName}"}
            </p>
            <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input value={parentName} onChange={(e) => setParentName(e.target.value)} placeholder="Elternname (optional)" className={inputClass} />
              <input value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} placeholder="WhatsApp Nummer (optional)" className={inputClass} />
            </div>
            <textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={6}
              className={`${inputClass} resize-none`}
            />
            <textarea
              value={waMessage}
              readOnly
              rows={6}
              className="mt-2 w-full resize-none rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm text-gray-600 outline-none"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copyWhatsAppText()}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 transition hover:border-[#4A7FC1] hover:text-[#4A7FC1]"
              >
                Text kopieren
              </button>
              <button
                type="button"
                onClick={() => window.open(buildWhatsAppUrl(waMessage, parentPhone), "_blank")}
                className="rounded-xl bg-[#4A7FC1] px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90"
              >
                WhatsApp öffnen
              </button>
              <button
                type="button"
                onClick={() => void openWhatsAppWithPdf()}
                className="rounded-xl border border-[#4A7FC1] bg-white px-3 py-2 text-xs font-semibold text-[#4A7FC1] transition hover:bg-[#EBF4FF]"
              >
                WhatsApp + PDF
              </button>
            </div>
            {copyState && <p className="mt-2 text-xs text-[#4A7FC1]">{copyState}</p>}
          </div>
        </div>

        {/* Right panel: PDF preview */}
        <div className="min-h-0 min-w-0 rounded-2xl border border-blue-100 bg-white p-2 shadow-sm">
          <iframe
            src={previewUrl}
            className="h-[55vh] min-h-[20rem] w-full rounded-xl border border-gray-100 sm:h-[70vh] lg:h-[80vh]"
            title="Rechnungsvorschau"
          />
        </div>
      </div>
    </DashboardShell>
  );
}
