"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";

type Contact = {
  id: string;
  tutor24Id: string;
  name: string;
  profileUrl: string | null;
  messagedAt: string;
};

type NewContact = { name: string; tutor24Id: string; profileUrl: string };

type JobResult = {
  messaged: number;
  skipped: number;
  errors: string[];
  log: string[];
  newContacts: NewContact[];
};

type StatusResponse = {
  running: boolean;
  startedAt: string | null;
  result: JobResult | null;
  contacts: Contact[];
};

const MESSAGE_PREVIEW = `Hallo zusammen,

gerne unterstütze ich dich in Mathematik und der Physik, entweder online oder in Zürich, auf Deutsch oder Englisch. Ich unterrichte seit über 12 Jahren, habe an der ETH studiert und begleite aktuell mehr als 30 aktive Schüler, die meisten auf Gymi- oder Universitätsniveau…

[… vollständige Nachricht wie konfiguriert …]

Liebi Grüess
Omid`;

export default function Tutor24Page() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [starting, setStarting] = useState(false);
  const [headless, setHeadless] = useState(false);
  const [maxPages, setMaxPages] = useState(10);
  const [subjects, setSubjects] = useState<string[]>(["Mathematik", "Physik"]);
  const [showPreview, setShowPreview] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/tutor24");
      if (res.ok) setStatus(await res.json());
    } catch {
      // ignore
    }
  }, []);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [status?.result?.log?.length]);

  // Poll every 1.5 s while running, stop when done
  useEffect(() => {
    fetchStatus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    await fetch("/api/tutor24", { method: "DELETE" });
    fetchStatus();
  };

  const handleStart = async () => {
    setStarting(true);
    try {
      const res = await fetch("/api/tutor24", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headless, maxPages, subjects }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Fehler beim Starten");
      } else {
        // Start polling immediately
        pollRef.current = setInterval(fetchStatus, 1500);
        fetchStatus();
      }
    } finally {
      setStarting(false);
    }
  };

  const result = status?.result;
  const isRunning = status?.running ?? false;
  const latestLog = result?.log?.at(-1) ?? "";

  return (
    <DashboardShell monthIncome={0} ytdIncome={0}>
      <div className="space-y-4">

        {/* Control panel */}
        <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
          <h1 className="mb-1 text-lg font-semibold text-gray-900">Tutor24 Nachrichten-Automation</h1>
          <p className="mb-4 text-sm text-gray-500">
            Sucht auf tutor24.ch nach Mathematik-Gesuchen (Seiten 1–{maxPages}) und schickt personalisierte
            Nachrichten an Schüler, die noch nicht kontaktiert wurden.
          </p>

          <div className="mb-4 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Max. Seiten pro Fach:</label>
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
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">Fächer:</span>
              {["Mathematik", "Physik"].map((s) => (
                <label key={s} className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={subjects.includes(s)}
                    onChange={(e) =>
                      setSubjects((prev) =>
                        e.target.checked ? [...prev, s] : prev.filter((x) => x !== s)
                      )
                    }
                    disabled={isRunning}
                    className="accent-[#4A7FC1]"
                  />
                  {s}
                </label>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={headless}
                onChange={(e) => setHeadless(e.target.checked)}
                disabled={isRunning}
              />
              Headless (kein sichtbares Browser-Fenster)
            </label>
            <button
              onClick={() => setShowPreview((v) => !v)}
              className="text-xs text-[#4A7FC1] underline underline-offset-2"
            >
              {showPreview ? "Vorschau verbergen" : "Nachricht-Vorschau anzeigen"}
            </button>
          </div>

          {showPreview && (
            <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs text-gray-700 whitespace-pre-wrap font-mono">
              {MESSAGE_PREVIEW}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleStart}
              disabled={isRunning || starting}
              className="rounded-xl bg-[#4A7FC1] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#3a6fb1] disabled:opacity-50"
            >
              {isRunning ? "Läuft..." : starting ? "Startet..." : "Automation starten"}
            </button>

            {isRunning && (
              <button
                onClick={handleStop}
                className="rounded-xl border border-red-200 bg-red-50 px-5 py-2.5 text-sm font-semibold text-red-600 transition-all hover:bg-red-100"
              >
                Stoppen
              </button>
            )}
          </div>

          {isRunning && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
              <p className="text-xs font-semibold text-amber-700">
                Läuft seit {status?.startedAt ? new Date(status.startedAt).toLocaleTimeString("de-CH") : "—"}
              </p>
              {latestLog && (
                <p className="mt-0.5 font-mono text-xs text-amber-600 truncate">{latestLog}</p>
              )}
            </div>
          )}
        </div>

        {/* Live log + result — visible as soon as the job starts */}
        {result && (
          <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">
                {isRunning ? "Live-Log" : "Letztes Ergebnis"}
              </h2>
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
                        ? isRunning ? "text-green-300 font-semibold" : "text-green-600 font-semibold"
                        : line.includes("Fehler") || line.includes("fehler")
                        ? isRunning ? "text-red-400" : "text-red-500"
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

            {/* Per-run contact list */}
            {!isRunning && result.newContacts.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-sm font-semibold text-gray-700">
                  Diese Runde kontaktiert ({result.newContacts.length}):
                </p>
                <ul className="space-y-1">
                  {result.newContacts.map((c, i) => (
                    <li key={c.tutor24Id} className="flex items-center gap-2 text-sm">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100 text-xs font-bold text-green-600">
                        {i + 1}
                      </span>
                      <a
                        href={c.profileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-gray-800 hover:text-[#4A7FC1] hover:underline"
                      >
                        {c.name}
                      </a>
                      <span className="text-xs text-gray-400">ID {c.tutor24Id}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!isRunning && result.newContacts.length === 0 && result.messaged === 0 && !result.errors.length && (
              <p className="mt-3 text-sm text-gray-400">
                Keine neuen Nachrichten gesendet — alle Schüler auf diesen Seiten wurden bereits kontaktiert.
              </p>
            )}
          </div>
        )}

        {/* Contact history */}
        {status && status.contacts.length > 0 && (
          <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-gray-900">
              Bereits kontaktiert —{" "}
              <span className="text-[#4A7FC1]">{status.contacts.length} Schüler</span>
            </h2>
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
                    <th className="pb-2 pr-4">Name</th>
                    <th className="pb-2 pr-4 hidden sm:table-cell">Tutor24-ID</th>
                    <th className="pb-2">Kontaktiert</th>
                  </tr>
                </thead>
                <tbody>
                  {status.contacts.map((c) => (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 pr-4 font-medium text-gray-800">
                        {c.profileUrl ? (
                          <a
                            href={c.profileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-[#4A7FC1] hover:underline"
                          >
                            {c.name}
                          </a>
                        ) : (
                          c.name
                        )}
                      </td>
                      <td className="py-2 pr-4 text-gray-400 hidden sm:table-cell">{c.tutor24Id}</td>
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
          </div>
        )}

        {status && status.contacts.length === 0 && !isRunning && (
          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-5 text-center text-sm text-gray-400">
            Noch keine Schüler kontaktiert. Starte die Automation oben.
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
