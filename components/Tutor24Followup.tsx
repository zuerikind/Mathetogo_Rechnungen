"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COURSE_GROUPS,
  GROUP_LABEL,
  LEVEL_LABEL,
  MARKS,
  MAX_ACTIVE_COURSES,
  PLACEHOLDERS,
  SUBJECTS,
  courseStats,
  demandOverview,
  effectiveStatus,
  isCourseGroup,
  isOfferLevel,
  newCourse,
  renderMessage,
  validateCourses,
  type Course,
  type CourseGroup,
  type FollowupSettings,
  type LevelCategory,
  type LogRow,
  type PreviewRow,
} from "@/lib/tutor24-followup";

type Row = Omit<PreviewRow, "nachricht">;
type Mode = "preview" | "send" | "replies";

type StatusResponse = {
  state: {
    running: boolean;
    mode: Mode | null;
    startedAt: string | null;
    finishedAt: string | null;
    progress: string;
    done: number;
    total: number;
    log: string[];
    error: string | null;
  };
  blockedBy: string | null;
  settings: FollowupSettings;
  courses: Course[];
  rows: Row[];
  log: LogRow[];
  send: {
    limit: number;
    sentToday: number;
    budget: number;
    pending: number;
    queue: number;
    recipients: Array<{ name: string; kurs: string }>;
  };
};

type Draft = { settings: FollowupSettings; courses: Course[] };

const inputClass = "rounded-lg border border-gray-200 px-2 py-1 text-sm disabled:bg-gray-50";
const cardClass = "rounded-2xl border border-blue-100 bg-white p-5 shadow-sm";
const btnPrimary = "rounded-xl bg-[#4A7FC1] px-5 py-2 text-sm font-semibold text-white hover:bg-[#3a6fb1] disabled:opacity-50";

const levelBadge = (c: string) =>
  isOfferLevel(c) ? "bg-blue-50 text-[#4A7FC1]" : c === "unklar" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500";

const AMPEL = { gruen: "bg-green-500", gelb: "bg-amber-400", rot: "bg-red-500" } as const;
const pct = (x: number) => `${Math.round(x * 100)} %`;

/** Effektive Status zu Filtergruppen zusammenfassen; die Gruende stehen in der Zeile. */
const statusGroup = (label: string) =>
  ["wird gesendet", "kein Kurs", "skip", "keine Kursgruppe", "ausgeschlossen: Fach"].includes(label) ? label : "übrige";

function CourseEditor({
  course,
  settings,
  log,
  open,
  disabled,
  onToggle,
  onChange,
  onDelete,
}: {
  course: Course;
  settings: FollowupSettings;
  log: LogRow[];
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
  onChange: (c: Course) => void;
  onDelete: () => void;
}) {
  const [previewDu, setPreviewDu] = useState(false);
  const set = <K extends keyof Course>(k: K, v: Course[K]) => onChange({ ...course, [k]: v });
  const preview = renderMessage(course, "Lea", previewDu ? "du" : "Sie");
  const st = courseStats(course, log);
  const subjects = Array.from(new Set([...settings.mySubjects, course.fach]));

  return (
    <div className="rounded-xl border border-gray-100">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-gray-800">
          <input type="checkbox" checked={course.active} disabled={disabled} onChange={(e) => set("active", e.target.checked)} className="accent-[#4A7FC1]" />
          {course.name || "Kurs ohne Namen"}
        </label>
        <span className="text-xs text-gray-400">
          {course.fach} · {GROUP_LABEL[course.gruppe]} · {course.active ? "aktiv" : "inaktiv"}
        </span>
        <span className="flex items-center gap-2 text-xs text-gray-600" title="Ampel: grün ab Mindestteilnehmerzahl Zusagen, gelb bei mindestens einer, rot bei keiner">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${AMPEL[st.ampel]}`} />
          {st.angeschrieben} angeschrieben · {st.geantwortet} geantwortet ({pct(st.quote)}) · <b>{st.zusagen}</b>/{course.minParticipants} Zusagen ·{" "}
          {st.tageBisSchluss >= 0 ? `noch ${st.tageBisSchluss} Tage bis Anmeldeschluss` : "Anmeldeschluss vorbei"}
        </span>
        <button onClick={onToggle} className="ml-auto text-xs text-[#4A7FC1] underline underline-offset-2">
          {open ? "Einklappen" : "Bearbeiten"}
        </button>
      </div>

      {open && (
        <div className="grid gap-4 border-t border-gray-100 p-4 lg:grid-cols-2">
          <div className="space-y-3 text-sm text-gray-600">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2">
                Name
                <input value={course.name} disabled={disabled} onChange={(e) => set("name", e.target.value)} className={`${inputClass} w-72`} />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">
                Fach
                <select value={course.fach} disabled={disabled} onChange={(e) => set("fach", e.target.value)} className={inputClass}>
                  {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2">
                Kursgruppe
                <select value={course.gruppe} disabled={disabled} onChange={(e) => set("gruppe", e.target.value as CourseGroup)} className={inputClass}>
                  {COURSE_GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label>Termine</label>
              {course.saturdays.map((d, i) => (
                <input
                  key={i}
                  type="date"
                  value={d}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = [...course.saturdays] as Course["saturdays"];
                    next[i] = e.target.value;
                    set("saturdays", next);
                  }}
                  className={inputClass}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">
                Uhrzeit
                <input value={course.time} disabled={disabled} onChange={(e) => set("time", e.target.value)} className={`${inputClass} w-36`} />
              </label>
              <label className="flex items-center gap-2">
                CHF/Lektion
                <input type="number" min={1} value={course.pricePerLesson} disabled={disabled} onChange={(e) => set("pricePerLesson", Number(e.target.value))} className={`${inputClass} w-20`} />
              </label>
              <label className="flex items-center gap-2">
                Lektionen
                <input type="number" min={1} value={course.lessons} disabled={disabled} onChange={(e) => set("lessons", Number(e.target.value))} className={`${inputClass} w-16`} />
              </label>
              <span className="text-xs text-gray-400">= CHF {course.pricePerLesson * course.lessons}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select value={course.mode} disabled={disabled} onChange={(e) => set("mode", e.target.value as Course["mode"])} className={inputClass}>
                <option value="online">online</option>
                <option value="vor Ort">vor Ort</option>
              </select>
              {course.mode === "vor Ort" && (
                <input placeholder="Ort, z.B. Zürich Oerlikon" value={course.place} disabled={disabled} onChange={(e) => set("place", e.target.value)} className={`${inputClass} w-48`} />
              )}
              <label className="flex items-center gap-2">
                Anmeldeschluss
                <input type="date" value={course.deadline} disabled={disabled} onChange={(e) => set("deadline", e.target.value)} className={inputClass} />
              </label>
              <label className="flex items-center gap-2">
                min. Teilnehmende
                <input type="number" min={1} value={course.minParticipants} disabled={disabled} onChange={(e) => set("minParticipants", Number(e.target.value))} className={`${inputClass} w-16`} />
              </label>
            </div>
            <div>
              <textarea
                value={course.template}
                disabled={disabled}
                onChange={(e) => set("template", e.target.value)}
                rows={14}
                className="w-full rounded-xl border border-gray-200 p-3 font-mono text-xs leading-5 outline-none focus:border-[#4A7FC1]"
              />
              <p className="mt-1 text-xs text-gray-400">
                Sie-Form schreiben, die du-Form wird automatisch abgeleitet. Platzhalter: {PLACEHOLDERS.join(" ")}
              </p>
            </div>
            <button
              onClick={onDelete}
              disabled={disabled}
              className="rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Kurs löschen
            </button>
          </div>
          <div>
            <div className="mb-2 flex items-center gap-3 text-xs text-gray-500">
              <span className="font-semibold uppercase tracking-wide">Vorschau (Beispiel „Lea“)</span>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={previewDu} onChange={(e) => setPreviewDu(e.target.checked)} />
                du-Form
              </label>
            </div>
            {preview.warning && <p className="mb-2 text-xs text-amber-700">{preview.warning}</p>}
            <div className="whitespace-pre-wrap rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs leading-5 text-gray-700">{preview.text}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export function Tutor24Followup() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openCourse, setOpenCourse] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [maxChecks, setMaxChecks] = useState(150);
  const [filter, setFilter] = useState<string>("alle");
  const [onlySend, setOnlySend] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/tutor24/followup");
      if (!res.ok) return;
      const data = (await res.json()) as StatusResponse;
      setStatus(data);
      // Entwurf nur beim ersten Laden setzen, sonst ueberschreibt das Polling ungespeicherte Eingaben.
      setDraft((d) => d ?? { settings: data.settings, courses: data.courses });
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const running = status?.state.running ?? false;
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (running) pollRef.current = setInterval(fetchStatus, 1500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus, running]);

  const dirty = useMemo(
    () => !!draft && !!status && JSON.stringify(draft) !== JSON.stringify({ settings: status.settings, courses: status.courses }),
    [draft, status]
  );
  const errors = useMemo(() => (draft ? validateCourses(draft.courses) : []), [draft]);
  const demand = useMemo(() => (status && draft ? demandOverview(status.rows, draft.settings) : []), [status, draft]);
  const logged = useMemo(() => new Set(status?.log.map((r) => r.conversation_id) ?? []), [status]);
  const blocked = running || !!status?.blockedBy;

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/tutor24/followup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) alert(data.error ?? "Fehler");
    return res.ok ? data : null;
  };

  const saveConfig = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const data = await post({ action: "config", ...draft });
      if (data?.courses) setDraft({ settings: data.settings, courses: data.courses });
      await fetchStatus();
    } finally {
      setSaving(false);
    }
  };

  const start = async (action: Mode) => {
    if (!status) return;
    if (action === "send") {
      const s = status.send;
      const list = s.recipients.map((r) => `• ${r.name || "—"} → ${r.kurs}`).join("\n");
      if (!window.confirm(`${s.queue} ${s.queue === 1 ? "Nachricht" : "Nachrichten"} senden?\n\n${list}\n\nZwischen den Nachrichten wartet die Automation 60–180 Sekunden.`)) return;
    }
    setBusy(true);
    try {
      if (await post({ action, max: maxChecks })) await fetchStatus();
    } finally {
      setBusy(false);
    }
  };

  const toggleRow = async (row: Row) => {
    const next = row.status === "send" ? "skip" : "send";
    // Sofort anzeigen, Server schreibt die CSV.
    setStatus((s) => s && { ...s, rows: s.rows.map((r) => (r.conversation_id === row.conversation_id ? { ...r, status: next } : r)) });
    await post({ action: "status", id: row.conversation_id, status: next });
    await fetchStatus();
  };

  const mark = async (id: string, markierung: string) => {
    setStatus((s) => s && { ...s, log: s.log.map((r) => (r.conversation_id === id ? { ...r, markierung } : r)) });
    await post({ action: "mark", id, markierung });
    await fetchStatus();
  };

  if (!status || !draft) return <div className="h-64 animate-pulse rounded-2xl border border-blue-100 bg-white" />;

  const { state, send } = status;
  const setSettings = (patch: Partial<FollowupSettings>) => setDraft({ ...draft, settings: { ...draft.settings, ...patch } });
  const setCourses = (courses: Course[]) => setDraft({ ...draft, courses });
  const activeCount = draft.courses.filter((c) => c.active).length;
  const addCourse = (fach: string, gruppe: CourseGroup) => {
    const c = newCourse(fach, gruppe);
    setCourses([...draft.courses, c]);
    setOpenCourse(c.id);
  };

  const withEff = status.rows.map((r) => ({ r, eff: effectiveStatus(r, draft.courses, draft.settings, logged) }));
  const shown = withEff.filter(({ r, eff }) => (filter === "alle" || statusGroup(eff.label) === filter) && (!onlySend || r.status === "send"));
  const groupCounts = withEff.reduce<Record<string, number>>((acc, { eff }) => {
    const g = statusGroup(eff.label);
    return { ...acc, [g]: (acc[g] ?? 0) + 1 };
  }, {});
  const answers = status.log.filter((r) => r.geantwortet === "ja");
  const notAnalysed = status.rows.filter((r) => r.fach && !r.faecher).length;
  const courseName = (id: string) => status.courses.find((c) => c.id === id)?.name ?? id;
  const lastLine = state.log.at(-1) ?? "";
  const runningLabel = { preview: "Probelauf läuft", send: "Senden läuft", replies: "Antworten werden geprüft" };

  return (
    <div className="space-y-4">
      {/* Live-Status */}
      {status.blockedBy && !running && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          tutor24 ist gerade belegt: <b>{status.blockedBy}</b>. Starten ist möglich, sobald dieser Lauf fertig ist.
        </div>
      )}
      {(running || state.error || state.finishedAt) && (
        <div className={`${cardClass} ${state.error && !running ? "border-2 border-red-300 bg-red-50" : ""}`}>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-semibold text-gray-900">
              {running ? runningLabel[state.mode ?? "preview"] : state.error ? "Abgebrochen" : "Letzter Lauf fertig"}
            </h2>
            {running && (
              <span className="text-sm text-gray-500">
                {state.done} von {state.total || "?"} · {Math.max(0, state.total - state.done)} übrig
              </span>
            )}
            {running && (
              <button
                onClick={async () => {
                  await fetch("/api/tutor24/followup", { method: "DELETE" });
                  void fetchStatus();
                }}
                className="ml-auto rounded-xl border border-red-200 bg-red-50 px-4 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-100"
              >
                Stoppen
              </button>
            )}
          </div>
          {state.error && !running && <p className="mt-2 text-sm font-semibold text-red-700">{state.error}</p>}
          {running && <p className="mt-2 text-sm text-gray-700">Position: {state.progress}</p>}
          {lastLine && <p className="mt-1 truncate font-mono text-xs text-gray-500">{lastLine}</p>}
          {state.log.length > 1 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-[#4A7FC1]">Letzte Meldungen</summary>
              <div className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl bg-gray-900 p-3 font-mono text-xs leading-5 text-green-400">
                {state.log.join("\n")}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Speichern + Meine Faecher */}
      <div className={cardClass}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="font-semibold text-gray-900">Meine Fächer</h2>
          <p className="text-xs text-gray-500">Nur diese Fächer zählen für Kurse und Vorschläge.</p>
          <button onClick={() => void saveConfig()} disabled={!dirty || saving || running || errors.length > 0} className={`ml-auto ${btnPrimary} py-1.5`}>
            {saving ? "Speichert…" : dirty ? "Fächer & Kurse speichern" : "Gespeichert"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {SUBJECTS.map((s) => {
            const on = draft.settings.mySubjects.includes(s);
            return (
              <button
                key={s}
                disabled={running}
                onClick={() => setSettings({ mySubjects: on ? draft.settings.mySubjects.filter((x) => x !== s) : [...draft.settings.mySubjects, s] })}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? "border-[#4A7FC1] bg-[#4A7FC1] text-white" : "border-gray-200 bg-white text-gray-600"}`}
              >
                {s}
              </button>
            );
          })}
        </div>
        {errors.length > 0 && (
          <ul className="mt-3 space-y-0.5 rounded-lg bg-red-50 p-3 text-xs text-red-600">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
      </div>

      {/* Probelauf + Antworten pruefen */}
      <div className={cardClass}>
        <h2 className="mb-1 font-semibold text-gray-900">Probelauf</h2>
        <p className="mb-3 text-sm text-gray-500">
          Liest die Konversationen und analysiert jedes Inserat: Stufe, Fächer, Klasse, Ort, Zeitwunsch, Anlass. Sendet nichts. Ein neuer
          Lauf setzt dort fort, wo der letzte aufgehört hat. Pro Konversation etwa 25 Sekunden. Jeder Lauf ist ein eigener Prozess:
          Neuladen oder Neustarten der App unterbricht ihn nicht.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            max. Konversationen
            <input type="number" min={1} value={maxChecks} onChange={(e) => setMaxChecks(Number(e.target.value))} disabled={blocked} className={`${inputClass} w-20`} />
          </label>
          <button onClick={() => void start("preview")} disabled={blocked || busy || !(maxChecks >= 1)} className={btnPrimary}>
            Probelauf starten
          </button>
          <button
            onClick={() => void start("replies")}
            disabled={blocked || busy || status.log.length === 0}
            title="Öffnet nur nachgefasste Konversationen und schaut, ob eine Antwort kam. Sendet nichts."
            className="rounded-xl border border-[#4A7FC1] px-5 py-2 text-sm font-semibold text-[#4A7FC1] hover:bg-blue-50 disabled:opacity-50"
          >
            Antworten prüfen ({status.log.filter((r) => r.geantwortet !== "ja").length})
          </button>
        </div>
      </div>

      {/* Nachfrage-Uebersicht */}
      <div className={cardClass}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="font-semibold text-gray-900">Nachfrage</h2>
          <label className="ml-auto flex items-center gap-2 text-xs text-gray-500">
            „Kurs empfohlen“ ab
            <input
              type="number"
              min={1}
              value={draft.settings.recommendMin}
              disabled={running}
              onChange={(e) => setSettings({ recommendMin: Math.max(1, Number(e.target.value)) })}
              className={`${inputClass} w-16`}
            />
            Kandidaten mit Sicherheit „hoch“
          </label>
        </div>
        {demand.length === 0 ? (
          <p className="text-sm text-gray-400">Noch keine Kandidaten. Starte zuerst einen Probelauf.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                  <th className="py-2 pr-3">Fach</th>
                  <th className="py-2 pr-3">Kursgruppe</th>
                  <th className="py-2 pr-3 text-right">Kandidaten</th>
                  <th className="py-2 pr-3 text-right">online möglich</th>
                  <th className="py-2 pr-3">häufigster Anlass</th>
                  <th className="py-2 pr-3">Zeitwünsche</th>
                  <th className="py-2 pr-3 text-right">Sicherheit hoch</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {demand.map((d) => {
                  const existing = draft.courses.find((c) => c.fach === d.fach && c.gruppe === d.gruppe);
                  return (
                    <tr key={`${d.fach}|${d.gruppe}`}>
                      <td className="py-2 pr-3 font-medium text-gray-800">{d.fach}</td>
                      <td className="py-2 pr-3">
                        {GROUP_LABEL[d.gruppe]}
                        {d.recommended && <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">Kurs empfohlen</span>}
                      </td>
                      <td className="py-2 pr-3 text-right font-semibold">{d.count}</td>
                      <td className="py-2 pr-3 text-right">{d.online}</td>
                      <td className="py-2 pr-3 text-xs text-gray-600">{d.anlass}</td>
                      <td className="py-2 pr-3 text-xs text-gray-600">{d.zeit}</td>
                      <td className="py-2 pr-3 text-right text-xs">{pct(d.hoch / d.count)}</td>
                      <td className="py-2 text-right">
                        {existing ? (
                          <button onClick={() => setOpenCourse(existing.id)} className="text-xs text-[#4A7FC1] underline underline-offset-2">
                            {existing.name}
                          </button>
                        ) : (
                          <button
                            onClick={() => addCourse(d.fach, d.gruppe)}
                            disabled={running}
                            className="rounded-lg bg-[#4A7FC1] px-3 py-1 text-xs font-semibold text-white hover:bg-[#3a6fb1] disabled:opacity-50"
                          >
                            Kurs anlegen
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {notAnalysed > 0 && (
          <p className="mt-3 text-xs text-amber-700">
            {notAnalysed} Konversationen noch nicht analysiert (aus der Zeit vor der Nachfrage-Analyse) — der nächste Probelauf holt sie nach.
          </p>
        )}
        <p className="mt-3 text-xs text-gray-500">Faustregel: Für 3 Anmeldungen braucht ein Kurs etwa 25–30 angeschriebene Kandidaten.</p>
      </div>

      {/* Kurse */}
      <div className={cardClass}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="font-semibold text-gray-900">Kurse</h2>
          <p className="text-xs text-gray-500">Gesendet wird nur für aktive Kurse. Neue Kurse sind inaktiv.</p>
        </div>
        {activeCount > MAX_ACTIVE_COURSES && (
          <p className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            {activeCount} Kurse sind gleichzeitig aktiv. Mehr als {MAX_ACTIVE_COURSES} verteilen die Anmeldungen meist zu dünn.
          </p>
        )}
        {draft.courses.length === 0 ? (
          <p className="text-sm text-gray-400">Noch keine Kurse. Lege einen über „Kurs anlegen“ in der Nachfrage-Übersicht an.</p>
        ) : (
          <div className="space-y-2">
            {draft.courses.map((c, i) => (
              <CourseEditor
                key={c.id}
                course={c}
                settings={draft.settings}
                log={status.log}
                open={openCourse === c.id}
                disabled={running}
                onToggle={() => setOpenCourse(openCourse === c.id ? null : c.id)}
                onChange={(next) => setCourses(draft.courses.map((x, j) => (j === i ? next : x)))}
                onDelete={() => {
                  if (window.confirm(`Kurs „${c.name}“ löschen? Bereits gesendete Nachrichten bleiben im Protokoll.`))
                    setCourses(draft.courses.filter((_, j) => j !== i));
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Vorschau */}
      <div className={cardClass}>
        <h2 className="mb-3 font-semibold text-gray-900">Vorschau ({status.rows.length} Konversationen)</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {Object.entries(groupCounts).sort((a, b) => b[1] - a[1]).map(([g, n]) => (
            <button
              key={g}
              onClick={() => setFilter(filter === g ? "alle" : g)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === g ? "border-[#4A7FC1] bg-[#4A7FC1] text-white" : "border-gray-200 bg-white text-gray-600"}`}
            >
              {g}: {n}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-xs text-gray-500">
            <input type="checkbox" checked={onlySend} onChange={(e) => setOnlySend(e.target.checked)} />
            nur status=send
          </label>
        </div>
        {status.rows.length === 0 ? (
          <p className="text-sm text-gray-400">Noch keine Vorschau. Starte zuerst einen Probelauf.</p>
        ) : (
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-gray-100 text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Stufe</th>
                  <th className="py-2 pr-3">Fächer</th>
                  <th className="py-2 pr-3">Begründung</th>
                  <th className="py-2 pr-3">Kurs</th>
                  <th className="py-2 pr-3">Nachricht</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {shown.map(({ r, eff }) => {
                  const msg = eff.course ? renderMessage(eff.course, r.name, r.anrede === "du" ? "du" : "Sie") : null;
                  const details = [r.klasse && `Klasse ${r.klasse}`, r.gymi_jahr && `Gymi-Jahr ${r.gymi_jahr}`, r.anlass, r.ort !== "unbekannt" && r.ort, r.ortsname, r.zeitwunsch]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <tr key={r.conversation_id} className="align-top">
                      <td className="py-2 pr-3">
                        <a href={r.link} target="_blank" rel="noopener noreferrer" className="font-medium text-gray-800 hover:text-[#4A7FC1] hover:underline">
                          {r.name || "—"}
                        </a>
                        <span className="block text-xs text-gray-400">{r.letzte_nachricht}</span>
                      </td>
                      <td className="py-2 pr-3">
                        {r.kategorie && (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${levelBadge(r.kategorie)}`}>
                            {LEVEL_LABEL[r.kategorie as LevelCategory] ?? r.kategorie}
                          </span>
                        )}
                        {isCourseGroup(r.kursgruppe) && (
                          <span className="mt-1 block text-xs text-gray-500">
                            {GROUP_LABEL[r.kursgruppe]} <span className="text-gray-400">({r.sicherheit})</span>
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs text-gray-600">{r.faecher || r.fach}</td>
                      <td className="max-w-xs py-2 pr-3 text-xs text-gray-600">
                        {r.begruendung}
                        {details && <span className="block text-gray-400">{details}</span>}
                      </td>
                      <td className="py-2 pr-3 text-xs">{eff.course ? eff.course.name : <span className="text-gray-400">kein Kurs</span>}</td>
                      <td className="max-w-sm py-2 pr-3 text-xs">
                        {msg ? (
                          <details>
                            <summary className="cursor-pointer text-[#4A7FC1]">
                              {msg.anrede}-Form anzeigen{msg.warning ? " ⚠" : ""}
                            </summary>
                            <div className="mt-1 whitespace-pre-wrap rounded-lg bg-gray-50 p-2 leading-5 text-gray-700">{msg.text}</div>
                          </details>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="py-2">
                        <button
                          onClick={() => void toggleRow(r)}
                          disabled={running || !isOfferLevel(r.kategorie) || !!r.grund}
                          title={!isOfferLevel(r.kategorie) || r.grund ? "Diese Konversation wird nie gesendet." : "Umschalten"}
                          className={`rounded-lg px-2.5 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${r.status === "send" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}
                        >
                          {r.status}
                        </button>
                        <span className={`mt-1 block text-xs ${eff.send ? "font-semibold text-green-700" : "text-gray-400"}`}>{eff.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Antworten */}
      <div className={cardClass}>
        <h2 className="mb-1 font-semibold text-gray-900">Antworten ({answers.length})</h2>
        <p className="mb-3 text-sm text-gray-500">
          {status.log.length} nachgefasst, {answers.length} mit Antwort. Jede Antwort selbst markieren, sie wird nicht automatisch ausgewertet.
        </p>
        {answers.length === 0 ? (
          <p className="text-sm text-gray-400">Noch keine Antworten bekannt. „Antworten prüfen“ startet die Suche.</p>
        ) : (
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-gray-100 text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Kurs</th>
                  <th className="py-2 pr-3">Datum</th>
                  <th className="py-2 pr-3">Antwort (Anfang)</th>
                  <th className="py-2">Markierung</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {answers.map((a) => (
                  <tr key={a.conversation_id} className="align-top">
                    <td className="py-2 pr-3 font-medium text-gray-800">{a.name || a.conversation_id}</td>
                    <td className="py-2 pr-3 text-xs">{courseName(a.kurs)}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-xs text-gray-500">{a.antwort_datum}</td>
                    <td className="max-w-md py-2 pr-3 text-xs text-gray-700">{a.antwort}</td>
                    <td className="py-2">
                      <select value={a.markierung || "offen"} disabled={running} onChange={(e) => void mark(a.conversation_id, e.target.value)} className={inputClass}>
                        {MARKS.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Senden */}
      <div className={cardClass}>
        <h2 className="mb-1 font-semibold text-gray-900">Senden</h2>
        <p className="mb-3 text-sm text-gray-500">
          Heute schon gesendet: <b>{send.sentToday}</b> von {send.limit}. Heute noch erlaubt: <b>{send.budget}</b>.{" "}
          Bereit mit aktivem Kurs: <b>{send.pending}</b>
          {send.pending > send.queue && ` (davon heute ${send.queue}, der Rest an einem späteren Tag)`}.
        </p>
        {dirty && <p className="mb-2 text-xs text-amber-700">Bitte zuerst Fächer & Kurse speichern — gesendet wird mit den gespeicherten Kursen.</p>}
        <button
          onClick={() => void start("send")}
          disabled={blocked || busy || dirty || send.queue === 0}
          className="rounded-xl bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {send.queue > 0 ? `${send.queue} ${send.queue === 1 ? "Nachricht" : "Nachrichten"} senden` : "Nichts zu senden"}
        </button>
      </div>
    </div>
  );
}
