"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { StudentTable } from "@/components/StudentTable";
import type { SessionWithStudent, Student } from "@/lib/ui-types";

type EditableStudent = Student & { totalEarned: number; sessions: number };

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [sessions, setSessions] = useState<SessionWithStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<EditableStudent | null>(null);
  const [form, setForm] = useState({ name: "", subject: "", ratePerMin: "", email: "" });
  const [tariffDialogOpen, setTariffDialogOpen] = useState(false);
  const [pendingSave, setPendingSave] = useState<{
    url: string;
    method: "PUT" | "POST";
    body: Record<string, unknown>;
  } | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(todayYmd);
  const [recalculateAllSessions, setRecalculateAllSessions] = useState(false);
  const [tariffError, setTariffError] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const [studentsRes, sessionsRes] = await Promise.all([
        fetch("/api/students"),
        fetch(`/api/sessions?year=${new Date().getFullYear()}`),
      ]);
      if (!studentsRes.ok || !sessionsRes.ok) throw new Error("Fehler");
      setStudents((await studentsRes.json()) as Student[]);
      setSessions((await sessionsRes.json()) as SessionWithStudent[]);
    } catch {
      setError("Fehler beim Laden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() =>
    students
      .filter((s) => s.active !== false)
      .map((student) => {
        const own = sessions.filter((ses) => ses.studentId === student.id);
        return { ...student, totalEarned: own.reduce((acc, s) => acc + s.amountCHF, 0), sessions: own.length };
      }),
    [students, sessions]
  );

  const monthIncome = sessions
    .filter((s) => s.month === new Date().getMonth() + 1 && s.year === new Date().getFullYear())
    .reduce((acc, s) => acc + s.amountCHF, 0);
  const ytd = sessions
    .filter((s) => s.year === new Date().getFullYear())
    .reduce((acc, s) => acc + s.amountCHF, 0);

  const resetForm = () => setForm({ name: "", subject: "", ratePerMin: "", email: "" });

  const submitPayload = async (
    url: string,
    method: "PUT" | "POST",
    payload: Record<string, unknown>,
    opts?: { closePanelsOnSuccess?: boolean }
  ) => {
    const closePanelsOnSuccess = opts?.closePanelsOnSuccess !== false;
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) {
      if (closePanelsOnSuccess) {
        setPanelOpen(false);
        setEditing(null);
        resetForm();
      }
      setTariffDialogOpen(false);
      setPendingSave(null);
      setTariffError("");
      void load();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setTariffError(typeof data.error === "string" ? data.error : "Speichern fehlgeschlagen.");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = { ...form, ratePerMin: Number(form.ratePerMin) };
    const url = editing ? `/api/students/${editing.id}` : "/api/students";
    const method = editing ? "PUT" : "POST";

    const oldRate = editing?.ratePerMin;
    const newRate = Number(form.ratePerMin);
    if (method === "PUT" && editing && oldRate !== undefined && newRate !== oldRate) {
      setPendingSave({ url, method, body: payload });
      setEffectiveFrom(todayYmd());
      setRecalculateAllSessions(false);
      setTariffError("");
      setTariffDialogOpen(true);
      return;
    }

    await submitPayload(url, method, payload, { closePanelsOnSuccess: true });
  };

  const confirmTariffChange = async () => {
    if (!pendingSave) return;
    const extra: Record<string, unknown> = {
      recalculateAllSessions,
      ...(recalculateAllSessions ? {} : { effectiveFrom }),
    };
    await submitPayload(pendingSave.url, pendingSave.method, { ...pendingSave.body, ...extra }, { closePanelsOnSuccess: true });
  };

  const inputClass = "w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none transition focus:border-[#4A7FC1] focus:ring-2 focus:ring-[#4A7FC1]/20";

  return (
    <DashboardShell monthIncome={monthIncome} ytdIncome={ytd}>
      <div className="min-w-0 space-y-5">

        {/* Page header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="min-w-0 text-xl font-bold text-gray-900">Schüler</h1>
          <button
            onClick={() => { setEditing(null); resetForm(); setPanelOpen(true); }}
            className="w-full shrink-0 rounded-xl bg-[#4A7FC1] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 sm:w-auto"
          >
            + Schüler hinzufügen
          </button>
        </div>

        {/* Table card */}
        {loading ? (
          <div className="h-64 animate-pulse rounded-2xl border border-blue-100 bg-white" />
        ) : error ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <button className="underline font-medium" onClick={() => void load()}>Erneut versuchen</button>
          </div>
        ) : (
          <StudentTable
            students={rows}
            onEdit={(student) => {
              setEditing(student);
              setForm({ name: student.name, subject: student.subject, ratePerMin: String(student.ratePerMin), email: student.email ?? "" });
              setPanelOpen(true);
            }}
            onDeactivate={async (studentId) => {
              await fetch(`/api/students/${studentId}`, { method: "DELETE" });
              void load();
            }}
          />
        )}
      </div>

      {/* Slide-out panel */}
      {panelOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-sm sm:items-stretch sm:justify-end">
          <div className="flex h-[min(100dvh,100%)] w-full max-h-full max-w-md flex-col border-blue-100 bg-white shadow-2xl sm:border-l">
            {/* Panel header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h3 className="text-base font-semibold text-gray-900">
                {editing ? "Schüler bearbeiten" : "Schüler hinzufügen"}
              </h3>
              <button
                onClick={() => setPanelOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-400 transition hover:border-gray-300 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            {/* Panel body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {editing && (
                <div className="mb-4 rounded-xl border border-orange-100 bg-orange-50 p-3 text-xs text-orange-700">
                  Name muss exakt mit dem Google Kalender Ereignistitel übereinstimmen.
                </div>
              )}
              <form onSubmit={onSubmit} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">Name</label>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="z.B. Lena Müller"
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">Fach</label>
                  <input
                    required
                    value={form.subject}
                    onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                    placeholder="z.B. Mathematik"
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">Tarif (CHF/Min)</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    value={form.ratePerMin}
                    onChange={(e) => setForm((f) => ({ ...f, ratePerMin: e.target.value }))}
                    placeholder="z.B. 1.25"
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">E-Mail (optional)</label>
                  <input
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="name@beispiel.ch"
                    className={inputClass}
                  />
                </div>
                <button
                  type="submit"
                  className="mt-2 w-full rounded-xl bg-[#4A7FC1] py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
                >
                  Speichern
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {tariffDialogOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
            <h4 className="text-base font-semibold text-gray-900">Tarif aendern</h4>
            <p className="mt-2 text-sm text-gray-600">
              Soll der neue Tarif auch fuer bestehende Lektionen neu berechnet werden? Waehle, ab welchem
              Datum die neuen Preise gelten sollen — oder wende ihn auf die gesamte Historie an.
            </p>

            <div className="mt-4 space-y-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={recalculateAllSessions}
                  onChange={(e) => setRecalculateAllSessions(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold text-gray-900">Gesamte Historie neu berechnen</span>
                  <span className="mt-1 block text-xs text-gray-500">
                    Alle gespeicherten Sessions dieses Schuelers werden mit dem neuen Tarif ueberschrieben
                    (z. B. nachtraegliche Korrektur / Vereinheitlichung).
                  </span>
                </span>
              </label>

              <div className={`space-y-1 ${recalculateAllSessions ? "opacity-40 pointer-events-none" : ""}`}>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Gueltig ab (Datum)
                </label>
                <input
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  className={inputClass}
                />
                <p className="text-xs text-gray-500">
                  Es werden nur Sessions ab diesem Kalendertag (00:00) neu berechnet. Aeltere Sessions bleiben
                  unveraendert.
                </p>
              </div>
            </div>

            {tariffError && <p className="mt-3 text-sm text-red-600">{tariffError}</p>}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setTariffDialogOpen(false);
                  setPendingSave(null);
                  setTariffError("");
                }}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={() => void confirmTariffChange()}
                className="rounded-xl bg-[#4A7FC1] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
              >
                Speichern und anwenden
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
