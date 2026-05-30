"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { ACADEMIGO_MAX_TEACHER_HOURLY_CHF } from "@/lib/academigo-types";
import { useGlobalIncomeSummary } from "@/hooks/useGlobalIncomeSummary";

type Contact = {
  id: string;
  tutor24Id: string;
  contactType: "teacher" | "student";
  name: string;
  profileUrl: string | null;
  messagedAt: string;
};

type NewContact = {
  name: string;
  tutor24Id: string;
  profileUrl: string;
  contactType: "teacher" | "student";
};

type JobResult = {
  messaged: number;
  skipped: number;
  errors: string[];
  log: string[];
  newContacts: NewContact[];
};

type StatusResponse = {
  running: boolean;
  mode: "teachers" | "students" | null;
  startedAt: string | null;
  result: JobResult | null;
  messageTemplate: string;
  messageTemplateTeachers?: string;
  messageTemplateStudents?: string;
  contacts: Contact[];
  contactTotal?: number;
};

const PREVIEW_TEACHER =
  "Dein Schwerpunkt Mathematik und Physik sowie deine Erfahrung mit Schülerinnen und Schülern auf verschiedenen Niveaus passen gut zu dem Netzwerk, das wir bei Academigo aufbauen.";

const PREVIEW_STUDENT =
  "Dein Gesuch in Mathematik auf Gymi-Niveau klingt nach etwas, bei dem wir dich bei Academigo gerne unverbindlich unterstützen können.";

export default function AcademigoPage() {
  const { monthIncome, ytdIncome, loading: incomeLoading } = useGlobalIncomeSummary();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [templateTab, setTemplateTab] = useState<"teachers" | "students">("teachers");
  const [teacherTemplate, setTeacherTemplate] = useState("");
  const [studentTemplate, setStudentTemplate] = useState("");
  const [templateDirty, setTemplateDirty] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [startingMode, setStartingMode] = useState<"teachers" | "students" | null>(null);
  const [headless, setHeadless] = useState(false);
  const [maxPages, setMaxPages] = useState(10);
  const [showPreview, setShowPreview] = useState(false);
  const [contactFilter, setContactFilter] = useState<"all" | "teacher" | "student">("all");
  const logRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const typeParam =
        contactFilter === "all" ? "" : `?type=${contactFilter === "teacher" ? "teacher" : "student"}`;
      const res = await fetch(`/api/academigo${typeParam}`);
      if (res.ok) {
        const data: StatusResponse = await res.json();
        setStatus(data);
        if (!templateDirty) {
          setTeacherTemplate(data.messageTemplateTeachers ?? data.messageTemplate);
          setStudentTemplate(data.messageTemplateStudents ?? data.messageTemplate);
        }
      }
    } catch {
      /* ignore */
    }
  }, [contactFilter, templateDirty]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [status?.result?.log?.length]);

  useEffect(() => {
    fetchStatus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchStatus();
  }, [contactFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (status?.running) {
      pollRef.current = setInterval(fetchStatus, 1500);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus, status?.running]);

  const handleStop = async () => {
    await fetch("/api/academigo", { method: "DELETE" });
    fetchStatus();
  };

  const activeTemplate = templateTab === "teachers" ? teacherTemplate : studentTemplate;
  const setActiveTemplate = templateTab === "teachers" ? setTeacherTemplate : setStudentTemplate;

  const handleSaveTemplate = async () => {
    setSavingTemplate(true);
    try {
      const res = await fetch("/api/academigo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageTemplate: activeTemplate, templateTarget: templateTab }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Speichern fehlgeschlagen");
      } else {
        setTemplateDirty(false);
        fetchStatus();
      }
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleStart = async (mode: "teachers" | "students") => {
    setStartingMode(mode);
    try {
      const res = await fetch("/api/academigo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          headless,
          maxPages,
          messageTemplate: mode === "teachers" ? teacherTemplate : studentTemplate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Fehler beim Starten");
      } else {
        setTemplateDirty(false);
        pollRef.current = setInterval(fetchStatus, 1500);
        fetchStatus();
      }
    } finally {
      setStartingMode(null);
    }
  };

  const result = status?.result;
  const isRunning = status?.running ?? false;
  const latestLog = result?.log?.at(-1) ?? "";
  const previewInsert = templateTab === "teachers" ? PREVIEW_TEACHER : PREVIEW_STUDENT;
  const previewText = activeTemplate
    .replace(/\[Name\]/gi, "Max")
    .replace(/\[PERSONALIZED_SECTION\]/gi, previewInsert)
    .replace(/\{\{LEVEL_INSERT\}\}/g, previewInsert);

  const modeLabel =
    status?.mode === "teachers" ? "Lehrer" : status?.mode === "students" ? "Schüler" : null;

  return (
    <DashboardShell monthIncome={monthIncome} ytdIncome={ytdIncome} incomeLoading={incomeLoading}>
      <div className="space-y-4">
        <div className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
          <h1 className="mb-1 text-lg font-semibold text-gray-900">Academigo — Nachrichten-Automation</h1>
          <p className="mb-4 text-sm text-gray-500">
            Nutzt getrennte tutor24.ch-Zugänge: Lehrer-Automation mit{" "}
            <code className="rounded bg-gray-100 px-1 text-[11px]">ACADEMIGO_TEACHER_*</code>, Schüler-Automation mit{" "}
            <code className="rounded bg-gray-100 px-1 text-[11px]">ACADEMIGO_STUDENT_*</code> (jeweils in .env.local).
          </p>

          <div className="mb-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <label className="text-sm font-medium text-gray-700">
                Nachrichtenvorlage
                <span className="ml-2 font-normal text-gray-400">
                  — <code className="rounded bg-gray-100 px-1">[Name]</code>,{" "}
                  <code className="rounded bg-gray-100 px-1">[PERSONALIZED_SECTION]</code> (eigener KI-Prompt pro
                  Tab)
                </span>
              </label>
              <div className="flex gap-1 text-xs">
                {(["teachers", "students"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setTemplateTab(tab)}
                    disabled={isRunning}
                    className={`rounded-lg px-3 py-1.5 font-medium ${
                      templateTab === tab
                        ? "bg-violet-600 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {tab === "teachers" ? "Lehrer" : "Schüler"}
                  </button>
                ))}
              </div>
            </div>
            <p className="mb-2 text-xs text-gray-500">
              {templateTab === "teachers"
                ? "Allgemeiner Text + KI-Absatz aus dem Lehrerprofil (Rekrutierung fürs Netzwerk)."
                : "Allgemeiner Text + KI-Absatz aus dem Gesuch (Bezug zu Fach, Niveau, Ziel)."}
            </p>
            <textarea
              value={activeTemplate}
              onChange={(e) => {
                setActiveTemplate(e.target.value);
                setTemplateDirty(true);
              }}
              disabled={isRunning}
              rows={14}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs leading-relaxed text-gray-800"
            />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSaveTemplate}
              disabled={isRunning || savingTemplate || !templateDirty}
              className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50"
            >
              {savingTemplate ? "Speichert..." : "Vorlage speichern"}
            </button>
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="text-xs text-violet-600 underline underline-offset-2"
            >
              {showPreview ? "Vorschau verbergen" : "Vorschau mit Beispiel-Einleitung"}
            </button>
          </div>

          {showPreview && (
            <div className="mb-4 whitespace-pre-wrap rounded-xl border border-violet-100 bg-violet-50 p-4 font-mono text-xs text-gray-700">
              {previewText}
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center gap-4 border-t border-gray-100 pt-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Max. Seiten:</label>
              <input
                type="number"
                min={1}
                max={20}
                value={maxPages}
                onChange={(e) => setMaxPages(Number(e.target.value))}
                className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-sm"
                disabled={isRunning}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={headless}
                onChange={(e) => setHeadless(e.target.checked)}
                disabled={isRunning}
              />
              Headless
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-4">
              <h2 className="mb-1 text-sm font-semibold text-gray-900">Lehrer kontaktieren</h2>
              <p className="mb-3 text-xs text-gray-500">
                providers/search — Nachhilfelehrer in Zürich, max. CHF {ACADEMIGO_MAX_TEACHER_HOURLY_CHF}/h
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleStart("teachers")}
                  disabled={isRunning || startingMode !== null}
                  className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {isRunning && status?.mode === "teachers"
                    ? "Läuft..."
                    : startingMode === "teachers"
                      ? "Startet..."
                      : "Starten"}
                </button>
                {isRunning && status?.mode === "teachers" && (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600"
                  >
                    Stoppen
                  </button>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-4">
              <h2 className="mb-1 text-sm font-semibold text-gray-900">Schüler kontaktieren</h2>
              <p className="mb-3 text-xs text-gray-500">jobs/search — Gesuche in Zürich (10 km)</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleStart("students")}
                  disabled={isRunning || startingMode !== null}
                  className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {isRunning && status?.mode === "students"
                    ? "Läuft..."
                    : startingMode === "students"
                      ? "Startet..."
                      : "Starten"}
                </button>
                {isRunning && status?.mode === "students" && (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600"
                  >
                    Stoppen
                  </button>
                )}
              </div>
            </div>
          </div>

          {isRunning && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
              <p className="text-xs font-semibold text-amber-700">
                {modeLabel ? `${modeLabel}-Automation` : "Automation"} läuft seit{" "}
                {status?.startedAt ? new Date(status.startedAt).toLocaleTimeString("de-CH") : "—"}
              </p>
              {latestLog && <p className="mt-0.5 truncate font-mono text-xs text-amber-600">{latestLog}</p>}
            </div>
          )}
        </div>

        {result && (
          <div className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">{isRunning ? "Live-Log" : "Letztes Ergebnis"}</h2>
              {!isRunning && (
                <div className="flex gap-3">
                  <span className="rounded-lg bg-green-50 px-3 py-1 text-sm font-semibold text-green-600">
                    {result.messaged} gesendet
                  </span>
                  <span className="rounded-lg bg-gray-100 px-3 py-1 text-sm font-semibold text-gray-500">
                    {result.skipped} übersprungen
                  </span>
                  {result.errors.length > 0 && (
                    <span className="rounded-lg bg-red-50 px-3 py-1 text-sm font-semibold text-red-500">
                      {result.errors.length} Fehler
                    </span>
                  )}
                </div>
              )}
            </div>

            <div
              ref={logRef}
              className={`max-h-64 overflow-y-auto rounded-xl p-3 font-mono text-xs leading-5 ${
                isRunning ? "bg-gray-900 text-green-400" : "bg-gray-50 text-gray-600"
              }`}
            >
              {result.log.length === 0 ? (
                <span className="opacity-50">Warte auf erste Ausgabe...</span>
              ) : (
                result.log.map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.includes("✓")
                        ? isRunning
                          ? "font-semibold text-green-300"
                          : "font-semibold text-green-600"
                        : line.includes("Fehler") || line.includes("fehler")
                          ? isRunning
                            ? "text-red-400"
                            : "text-red-500"
                          : ""
                    }
                  >
                    {line}
                  </div>
                ))
              )}
              {isRunning && <span className="animate-pulse">▌</span>}
            </div>

            {!isRunning && result.errors.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-red-600">
                  {result.errors.length} Fehler anzeigen
                </summary>
                <ul className="mt-2 space-y-0.5 rounded-lg bg-red-50 p-3 text-xs text-red-500">
                  {result.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </details>
            )}

            {!isRunning && result.newContacts.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-sm font-semibold text-gray-700">
                  Diese Runde kontaktiert ({result.newContacts.length}):
                </p>
                <ul className="space-y-1">
                  {result.newContacts.map((c) => (
                    <li key={`${c.contactType}-${c.tutor24Id}`} className="flex items-center gap-2 text-sm">
                      <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-violet-700">
                        {c.contactType === "teacher" ? "Lehrer" : "Schüler"}
                      </span>
                      <a
                        href={c.profileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-gray-800 hover:text-violet-600 hover:underline"
                      >
                        {c.name}
                      </a>
                      <span className="text-xs text-gray-400">ID {c.tutor24Id}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {status && (
          <div className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-gray-900">
                Bereits kontaktiert —{" "}
                <span className="text-violet-600">{status.contactTotal ?? status.contacts.length}</span>
              </h2>
              <div className="flex gap-2 text-xs">
                {(["all", "teacher", "student"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setContactFilter(f)}
                    className={`rounded-lg px-2.5 py-1 font-medium ${
                      contactFilter === f
                        ? "bg-violet-600 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {f === "all" ? "Alle" : f === "teacher" ? "Lehrer" : "Schüler"}
                  </button>
                ))}
              </div>
            </div>

            {status.contacts.length > 0 ? (
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
                      <th className="pb-2 pr-4">Typ</th>
                      <th className="pb-2 pr-4">Name</th>
                      <th className="pb-2 pr-4 hidden sm:table-cell">ID</th>
                      <th className="pb-2">Kontaktiert</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.contacts.map((c) => (
                      <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2 pr-4 text-xs text-gray-500">
                          {c.contactType === "teacher" ? "Lehrer" : "Schüler"}
                        </td>
                        <td className="py-2 pr-4 font-medium text-gray-800">
                          {c.profileUrl ? (
                            <a
                              href={c.profileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-violet-600 hover:underline"
                            >
                              {c.name}
                            </a>
                          ) : (
                            c.name
                          )}
                        </td>
                        <td className="hidden py-2 pr-4 text-gray-400 sm:table-cell">{c.tutor24Id}</td>
                        <td className="py-2 text-gray-500">
                          {new Date(c.messagedAt).toLocaleString("de-CH", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-center text-sm text-gray-400">
                Noch keine Kontakte in dieser Kategorie. Starte eine Automation oben.
              </p>
            )}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
