"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COURSE_GROUPS,
  GROUP_LABEL,
  LEVEL_LABEL,
  MAX_ACTIVE_COURSES,
  PLACEHOLDERS,
  SUBJECTS,
  courseStats,
  demandOverview,
  effectiveStatus,
  formatSaturdays,
  isCourseGroup,
  isOfferLevel,
  needsReplyCheck,
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
import { CoursePipeline } from "./Tutor24Pipeline";

type Row = Omit<PreviewRow, "nachricht">;
type Mode = "preview" | "send" | "replies";

type StatusResponse = {
  state: {
    running: boolean;
    /** "compare" nur von der Kommandozeile (--compare N) */
    mode: Mode | "compare" | null;
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
    /** fertig geprueft: problem = null heisst "so geht es raus" */
    recipients: Array<{ id: string; name: string; kurs: string; anrede: "du" | "Sie"; problem: string | null; text: string }>;
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
  // Unabhaengig von der Vorschau: bekommen du-Empfaenger wirklich die du-Form?
  const duWarning = renderMessage(course, "Lea", "du").warning;
  const st = courseStats(course, log);
  const subjects = Array.from(new Set([...settings.mySubjects, course.fach]));
  // Stufe nachfragen: nur Text, keine Termine/Preise/Zusagen.
  const inquiry = course.gruppe === "offen";

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
          {st.angeschrieben} angeschrieben · {st.geantwortet} geantwortet ({pct(st.quote)})
          {!inquiry && (
            <>
              {" "}· <b>{st.zusagen}</b>/{course.minParticipants} Zusagen ·{" "}
              {st.tageBisSchluss >= 0 ? `noch ${st.tageBisSchluss} Tage bis Anmeldeschluss` : "Anmeldeschluss vorbei"}
            </>
          )}
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
            {inquiry ? (
              <p className="text-xs text-gray-500">
                Für Kandidaten, deren Inserat nur die Stufe nennt (z.B. „Sekundarstufe“), nicht das Jahr. Die Nachricht fragt nach der genauen Stufe; mit der Antwort
                ordnest du sie selbst einem Kurs zu.
              </p>
            ) : (
            <>
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
            </>
            )}
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
              {duWarning && (
                <p className="mt-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                  Aus diesem Text lässt sich keine du-Form ableiten: Wer „du“ bekommen sollte, erhält die Sie-Form. Die Sätze der Vorlage
                  (z.B. „Ihre Anfrage“, „Falls Sie noch suchen“, „ich Ihnen“) werden umgewandelt, eigene Sie-Formulierungen nicht.
                </p>
              )}
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

/**
 * view "nachfassen": Faecher, Nachfrage-Analyse, Vorschau. view "kurse": Kurse, Pipeline, Automationen.
 * Beide teilen Status, Entwurf und automatisches Speichern; onOpenCourse wechselt auf die Seite /kurse.
 */
export function Tutor24Followup({
  view = "nachfassen",
  focusCourse = null,
  onOpenCourse,
}: {
  view?: "nachfassen" | "kurse";
  focusCourse?: string | null;
  onOpenCourse?: (courseId: string) => void;
} = {}) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openCourse, setOpenCourse] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(focusCourse);
  const [newFach, setNewFach] = useState("Mathe");
  const [newGruppe, setNewGruppe] = useState<CourseGroup>("bm");
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
    const sent = JSON.stringify(draft);
    setSaving(true);
    try {
      const data = await post({ action: "config", ...draft });
      if (!data) failedRef.current = sent;
      // Serverfassung (normalisiert) nur uebernehmen, wenn seither nichts getippt wurde.
      else if (data.courses) setDraft((d) => (JSON.stringify(d) === sent ? { settings: data.settings, courses: data.courses } : d));
      await fetchStatus();
    } finally {
      setSaving(false);
    }
  };

  // Automatisch speichern: ein neu angelegter Kurs war sonst nach dem Neuladen weg.
  // Ein fehlgeschlagener Stand wird nicht wiederholt, erst die naechste Aenderung.
  const failedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!dirty || errors.length > 0 || running || saving || failedRef.current === JSON.stringify(draft)) return;
    const t = setTimeout(() => void saveConfig(), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, dirty, errors.length, running, saving]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  // Tab-Wechsel innerhalb der 800 ms haengt die Komponente ab: offenen Stand sofort senden.
  const pendingRef = useRef<string | null>(null);
  pendingRef.current = dirty && errors.length === 0 && !running ? JSON.stringify({ action: "config", ...draft }) : null;
  useEffect(
    () => () => {
      if (pendingRef.current)
        void fetch("/api/tutor24/followup", { method: "POST", headers: { "Content-Type": "application/json" }, body: pendingRef.current, keepalive: true });
    },
    []
  );

  const start = async (action: Mode) => {
    if (!status) return;
    // Kein Bestaetigungsfenster: die gepruefte Liste steht beim Knopf, der Lauf geht dann ohne Rueckfrage durch.
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

  const setAnrede = async (id: string, anrede: "du" | "Sie") => {
    setStatus((s) => s && { ...s, rows: s.rows.map((r) => (r.conversation_id === id ? { ...r, anrede } : r)) });
    await post({ action: "anrede", id, anrede });
    await fetchStatus();
  };

  const assign = async (id: string, kurs: string) => {
    setStatus((s) => s && { ...s, log: s.log.map((r) => (r.conversation_id === id ? { ...r, kurs, markierung: "Frage" } : r)) });
    await post({ action: "assign", id, kurs });
    await fetchStatus();
  };

  if (!status || !draft) return <div className="h-64 animate-pulse rounded-2xl border border-blue-100 bg-white" />;

  const { state, send } = status;
  const setSettings = (patch: Partial<FollowupSettings>) => setDraft({ ...draft, settings: { ...draft.settings, ...patch } });
  const setCourses = (courses: Course[]) => setDraft({ ...draft, courses });
  const activeCount = draft.courses.filter((c) => c.active && c.gruppe !== "offen").length;
  // Derselbe Knopf in "Meine Faecher", bei den Kursen und beim Senden: die liegen Bildschirme auseinander.
  const saveButton = (
    <button onClick={() => void saveConfig()} disabled={!dirty || saving || running || errors.length > 0} className={`ml-auto ${btnPrimary} py-1.5`}>
      {saving ? "Speichert…" : dirty ? "Fächer & Kurse speichern" : "Gespeichert"}
    </button>
  );
  const addCourse = async (fach: string, gruppe: CourseGroup) => {
    const c = newCourse(fach, gruppe);
    const next = { ...draft, courses: [...draft.courses, c] };
    setDraft(next);
    setSelectedId(c.id);
    setOpenCourse(c.id);
    // Aus dem Nachfassen-Tab: sofort speichern, dann auf die Seite /kurse (die laedt frisch vom Server).
    if (onOpenCourse && (await post({ action: "config", ...next }))) onOpenCourse(c.id);
  };
  const openCourseTab = (id: string) => (onOpenCourse ? onOpenCourse(id) : setSelectedId(id));
  const selected = draft.courses.find((c) => c.id === selectedId) ?? draft.courses[0] ?? null;
  // "Bereit": wer beim naechsten Senden diesen Kurs bekaeme — auch wenn er gerade pausiert ist.
  const readyFor = (c: Course) => {
    const asActive = draft.courses.map((x) => (x.id === c.id ? { ...x, active: true } : x));
    return status.rows.filter((r) => {
      const eff = effectiveStatus(r, asActive, draft.settings, logged);
      return eff.send && eff.course?.id === c.id;
    });
  };
  const waiting = status.log.filter(needsReplyCheck).length;
  const badRecipients = send.recipients.filter((r) => r.problem);
  // Auswahl und Anlegen mit demselben Fach: "Mathe" ist nur Startwert, falls es unter "Meine Faecher" steht.
  const fachForNew = draft.settings.mySubjects.includes(newFach) ? newFach : draft.settings.mySubjects[0] ?? "";

  const withEff = status.rows.map((r) => ({ r, eff: effectiveStatus(r, draft.courses, draft.settings, logged) }));
  const shown = withEff.filter(({ r, eff }) => (filter === "alle" || statusGroup(eff.label) === filter) && (!onlySend || r.status === "send"));
  const groupCounts = withEff.reduce<Record<string, number>>((acc, { eff }) => {
    const g = statusGroup(eff.label);
    return { ...acc, [g]: (acc[g] ?? 0) + 1 };
  }, {});
  const notAnalysed = status.rows.filter((r) => r.fach && !r.faecher).length;
  const lastLine = state.log.at(-1) ?? "";
  const runningLabel = { preview: "Probelauf läuft", send: "Senden läuft", replies: "Antworten werden geprüft", compare: "Vergleich läuft" };

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

      {view === "kurse" ? (
        <>
          {/* Automationen: der Ablauf in drei Schritten */}
          <div className={cardClass}>
            <div className="mb-1 flex flex-wrap items-center gap-3">
              <h2 className="font-semibold text-gray-900">Automationen</h2>
              {errors.length > 0 ? (
                <span className="text-xs font-semibold text-red-600">Senden gesperrt: ein Kurs hat einen Fehler (siehe Kurse).</span>
              ) : (
                dirty && <span className="text-xs text-amber-700">Änderungen werden gespeichert …</span>
              )}
            </div>
            <p className="mb-4 text-sm text-gray-500">
              Drei Schritte, von links nach rechts. Jeder läuft im Hintergrund weiter, auch wenn du die Seite neu lädst; es läuft immer nur einer gleichzeitig.
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="flex flex-col rounded-xl border border-gray-100 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Schritt 1</p>
                <h3 className="font-semibold text-gray-900">Neue Kandidaten suchen</h3>
                <p className="mt-1 flex-1 text-sm text-gray-500">
                  Liest deine tutor24-Konversationen und ordnet passende Personen den Kursen zu (Spalte „Bereit“). Sendet nichts.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button onClick={() => void start("preview")} disabled={blocked || busy || !(maxChecks >= 1)} className={btnPrimary}>
                    Kandidaten suchen
                  </button>
                  <label className="flex items-center gap-1 text-xs text-gray-500">
                    max.
                    <input type="number" min={1} value={maxChecks} onChange={(e) => setMaxChecks(Number(e.target.value))} disabled={blocked} className={`${inputClass} w-16`} />
                  </label>
                </div>
              </div>
              <div className="flex flex-col rounded-xl border border-gray-100 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Schritt 2</p>
                <h3 className="font-semibold text-gray-900">Kursangebot senden</h3>
                <p className="mt-1 flex-1 text-sm text-gray-500">
                  Schickt das Angebot an alle in „Bereit“ der <b>aktiven</b> Kurse. Höchstens {send.limit} pro Tag (heute noch {send.budget}), 1–3 Minuten
                  Pause dazwischen. Alle Texte werden vorher geprüft; danach läuft es ohne Rückfrage durch.
                  {send.pending > send.queue && ` ${send.pending - send.queue} weitere folgen an einem späteren Tag.`}
                </p>
                {send.queue > 0 && (
                  <details className="mt-2 text-xs" open={badRecipients.length > 0}>
                    <summary className={`cursor-pointer font-semibold ${badRecipients.length ? "text-red-600" : "text-green-700"}`}>
                      {badRecipients.length
                        ? `${badRecipients.length} von ${send.queue} Nachrichten fehlerhaft — so wird nichts gesendet`
                        : `✓ ${send.queue} Nachrichten geprüft — Liste ansehen`}
                    </summary>
                    <ul className="mt-1 max-h-56 space-y-1 overflow-y-auto">
                      {send.recipients.map((r) => (
                        <li key={r.id} className="rounded-md bg-gray-50 p-1.5">
                          <span className="font-semibold text-gray-800">{r.name || r.id}</span>
                          <span className="text-gray-500"> · {r.kurs} · {r.anrede}</span>
                          {r.problem && <span className="block text-red-600">{r.problem}</span>}
                          <details>
                            <summary className="cursor-pointer text-[#4A7FC1]">Text</summary>
                            <p className="mt-1 whitespace-pre-wrap text-gray-700">{r.text}</p>
                          </details>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="mt-3">
                  <button
                    onClick={() => void start("send")}
                    disabled={blocked || busy || dirty || errors.length > 0 || badRecipients.length > 0 || send.queue === 0}
                    className="rounded-xl bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {send.queue > 0 ? `${send.queue} ${send.queue === 1 ? "Person" : "Personen"} anschreiben` : "Niemand bereit"}
                  </button>
                </div>
              </div>
              <div className="flex flex-col rounded-xl border border-gray-100 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Schritt 3</p>
                <h3 className="font-semibold text-gray-900">Antworten prüfen</h3>
                <p className="mt-1 flex-1 text-sm text-gray-500">
                  Schaut in den Chats der Angeschriebenen nach Antworten. Neue erscheinen in der Pipeline unter „Antwort erhalten“. Sendet nichts.
                </p>
                <div className="mt-3">
                  <button
                    onClick={() => void start("replies")}
                    disabled={blocked || busy || waiting === 0}
                    className="rounded-xl border border-[#4A7FC1] px-5 py-2 text-sm font-semibold text-[#4A7FC1] hover:bg-blue-50 disabled:opacity-50"
                  >
                    {waiting > 0
                      ? `${waiting} ${waiting === 1 ? "Chat" : "Chats"} prüfen`
                      : status.log.length === 0
                        ? "Noch niemand angeschrieben"
                        : "Alle haben geantwortet oder sind eingeordnet"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Kursauswahl */}
          <div className={cardClass}>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="font-semibold text-gray-900">Kurse</h2>
              <p className="text-xs text-gray-500">Kurs anklicken, um seine Pipeline zu sehen. Gespeichert wird automatisch.</p>
              {/* Nur zum erneuten Versuch, falls das automatische Speichern fehlschlug */}
              {saveButton}
            </div>
            {draft.courses.length > 0 && !draft.courses.some((c) => c.active) && (
              <p className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                Kein Kurs aktiv — beim Anschreiben bekommt niemand ein Angebot. Kurs auswählen und unten das Häkchen vor dem Kursnamen setzen.
              </p>
            )}
            {errors.length > 0 && <p className="mb-3 rounded-lg bg-red-50 p-3 text-xs text-red-600">Bitte korrigieren (bis dahin wird nichts gespeichert und nichts gesendet): {errors.join(" ")}</p>}
            {activeCount > MAX_ACTIVE_COURSES && (
              <p className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                {activeCount} Kurse sind gleichzeitig aktiv. Mehr als {MAX_ACTIVE_COURSES} verteilen die Anmeldungen meist zu dünn.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              {draft.courses.map((c) => {
                const st = courseStats(c, status.log);
                const isSel = selected?.id === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`w-64 rounded-xl border p-3 text-left transition ${isSel ? "border-[#4A7FC1] bg-blue-50/40 ring-2 ring-[#4A7FC1]/20" : "border-gray-200 hover:border-gray-300"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold text-gray-900">{c.name || "Kurs ohne Namen"}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {c.active ? "aktiv" : "pausiert"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {c.gruppe === "offen" ? "Fragt nach der genauen Stufe" : `${formatSaturdays(c.saturdays)} · ${c.mode === "online" ? "online" : c.place || "vor Ort"}`}
                    </p>
                    <p className="mt-2 text-xs text-gray-600">
                      {readyFor(c).length} bereit · {st.angeschrieben} angeschrieben · {st.geantwortet} Antworten
                    </p>
                    {c.gruppe !== "offen" && (
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-600">
                        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${AMPEL[st.ampel]}`} />
                        <span>
                          <b>{st.zusagen}</b>/{c.minParticipants} Zusagen · {st.bezahlt} bezahlt ·{" "}
                          {st.tageBisSchluss >= 0 ? `noch ${st.tageBisSchluss} T. bis Anmeldeschluss` : "Anmeldeschluss vorbei"}
                        </span>
                      </p>
                    )}
                  </button>
                );
              })}
              <div className="w-64 rounded-xl border border-dashed border-gray-300 p-3">
                <p className="text-sm font-semibold text-gray-700">Neuer Kurs</p>
                <div className="mt-2 flex flex-col gap-2">
                  <select value={fachForNew} onChange={(e) => setNewFach(e.target.value)} className={inputClass} aria-label="Fach">
                    {draft.settings.mySubjects.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select value={newGruppe} onChange={(e) => setNewGruppe(e.target.value as CourseGroup)} className={inputClass} aria-label="Kursgruppe">
                    {COURSE_GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
                  </select>
                  <button
                    onClick={() => void addCourse(fachForNew, newGruppe)}
                    disabled={running || !fachForNew}
                    className="rounded-lg bg-[#4A7FC1] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3a6fb1] disabled:opacity-50"
                  >
                    Anlegen
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Pipeline des gewaehlten Kurses */}
          {selected && (
            <div className={cardClass}>
              <div className="mb-3">
                <h2 className="font-semibold text-gray-900">Pipeline: {selected.name || "Kurs ohne Namen"}</h2>
                <p className="text-xs text-gray-500">
                  Name anklicken öffnet den Chat in tutor24. Mit dem Auswahlfeld ordnest du jede Person ein; sie wandert dann in die passende Spalte.
                  {selected.gruppe === "offen" && " Wer die Stufe nennt, übernimmst du mit „In Kurs übernehmen“ in den passenden Kurs."}
                </p>
              </div>
              {!selected.active && (
                <p className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                  Dieser Kurs ist pausiert: „Bereit“ zeigt, wer ihn bekäme, gesendet wird aber erst, wenn du unten das Häkchen vor dem Kursnamen setzt.
                </p>
              )}
              <CoursePipeline
                course={selected}
                courses={draft.courses}
                ready={readyFor(selected)}
                log={status.log.filter((r) => r.kurs === selected.id)}
                rows={status.rows}
                disabled={running}
                onMark={(id, m) => void mark(id, m)}
                onSkip={(r) => void toggleRow(r)}
                onAssign={(id, kurs) => void assign(id, kurs)}
                onAnrede={(id, a) => void setAnrede(id, a)}
              />
              <div className="mt-4">
                <CourseEditor
                  course={selected}
                  settings={draft.settings}
                  log={status.log}
                  open={openCourse === selected.id}
                  disabled={running}
                  onToggle={() => setOpenCourse(openCourse === selected.id ? null : selected.id)}
                  onChange={(next) => setCourses(draft.courses.map((x) => (x.id === selected.id ? next : x)))}
                  onDelete={() => {
                    // Mit Angeschriebenen haette deren Pipeline keinen Kurs mehr: Antworten waeren unsichtbar.
                    const contacted = status.log.filter((r) => r.kurs === selected.id).length;
                    if (contacted > 0) {
                      alert(`„${selected.name}“ hat schon ${contacted} Angeschriebene. Löschen würde ihre Antworten aus der Pipeline entfernen. Nimm stattdessen das Häkchen weg (pausieren).`);
                      return;
                    }
                    if (window.confirm(`Kurs „${selected.name}“ löschen?`)) {
                      setCourses(draft.courses.filter((x) => x.id !== selected.id));
                      setSelectedId(null);
                    }
                  }}
                />
              </div>
            </div>
          )}
        </>
      ) : (
        <>
      {/* Speichern + Meine Faecher */}
      <div className={cardClass}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="font-semibold text-gray-900">Meine Fächer</h2>
          <p className="text-xs text-gray-500">Nur diese Fächer zählen für Kurse und Vorschläge.</p>
          {saveButton}
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
          Lauf setzt dort fort, wo der letzte aufgehört hat. Pro geöffneter Seite 8–15 Sekunden Pause. Jeder Lauf ist ein eigener Prozess:
          Neuladen oder Neustarten der App unterbricht ihn nicht. Zeitmessung pro Lauf in tutor24-followup/timing.csv.
        </p>
        <label className="mb-3 flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={draft.settings.listingOnDemand}
            disabled={running}
            onChange={(e) => setSettings({ listingOnDemand: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            Inserat nur bei Bedarf öffnen
            <span className="block text-xs text-gray-500">
              Wertet zuerst nur die Konversationsseite aus und öffnet das Inserat nur bei unklarer Stufe, fehlendem Fach, Sicherheit
              unter „hoch“ oder Widerspruch. Vorher den Vergleich prüfen: <code>npx tsx scripts/followup_group_offer.mts --compare 20</code>{" "}
              → tutor24-followup/compare.csv. Speichern mit „Fächer &amp; Kurse speichern“.
            </span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            max. Konversationen
            <input type="number" min={1} value={maxChecks} onChange={(e) => setMaxChecks(Number(e.target.value))} disabled={blocked} className={`${inputClass} w-20`} />
          </label>
          <button onClick={() => void start("preview")} disabled={blocked || busy || !(maxChecks >= 1)} className={btnPrimary}>
            Probelauf starten
          </button>
          <span className="text-xs text-gray-500">Senden und Antworten prüfen: auf der Seite „Kurse“ (Navigation oben).</span>
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
                          <button onClick={() => openCourseTab(existing.id)} className="text-xs text-[#4A7FC1] underline underline-offset-2">
                            {existing.name}
                          </button>
                        ) : (
                          <button
                            onClick={() => void addCourse(d.fach, d.gruppe)}
                            disabled={running}
                            className="rounded-lg bg-[#4A7FC1] px-3 py-1 text-xs font-semibold text-white hover:bg-[#3a6fb1] disabled:opacity-50"
                          >
                            {d.gruppe === "offen" ? "Nachfrage anlegen" : "Kurs anlegen"}
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
                  const details = [r.klasse && `Klasse ${r.klasse}`, r.gymi_jahr && `Gymi-Jahr ${r.gymi_jahr}`, r.anlass, r.ort !== "unbekannt" && r.ort, r.ortsname, r.zeitwunsch, r.quelle && `Quelle: ${r.quelle}`]
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

        </>
      )}
    </div>
  );
}
