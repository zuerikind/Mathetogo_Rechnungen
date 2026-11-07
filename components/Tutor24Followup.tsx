"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COURSE_GROUPS,
  capacity,
  GROUP_LABEL,
  LEVEL_LABEL,
  MAX_ACTIVE_COURSES,
  NO_COURSE,
  SUBJECTS,
  courseStats,
  followedUpIds,
  demandOverview,
  effectiveStatus,
  formatSaturdays,
  isCourseGroup,
  isOfferLevel,
  leadFor,
  withAnrede,
  needsReplyCheck,
  newCourse,
  pipelineStage,
  validateCourses,
  type Course,
  type CourseGroup,
  type FollowupSettings,
  type LeadMap,
  type LevelCategory,
  type LogRow,
  type PreviewRow,
} from "@/lib/tutor24-followup";
import {
  checkCourse,
  followupForm,
  followupMessage,
  previewMessage,
  type FieldIssue,
  type PreviewArt,
  type PreviewWer,
} from "@/lib/tutor24-course-offer";
import { CoursePipeline } from "./Tutor24Pipeline";
import { Overview, PassTable, card, type Attention, type AutopilotInfo, type OverviewInfo } from "./AutopilotPanel";

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
    details?: string | null;
  };
  blockedBy: string | null;
  settings: FollowupSettings;
  courses: Course[];
  rows: Row[];
  log: LogRow[];
  /** Stand aus Tutor24Lead: Anrede, Sprache, Kurs der Erst-Nachricht */
  leads: LeadMap;
  autopilot: AutopilotInfo;
  uebersicht: OverviewInfo;
  send: {
    limit: number;
    sentToday: number;
    budget: number;
    pending: number;
    queue: number;
    /** fertig geprueft: problem = null heisst "so geht es raus" */
    recipients: Array<{ id: string; name: string; kurs: string; courseId: string; anrede: "du" | "Sie"; problem: string | null; text: string }>;
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
  ["wird gesendet", "kein Kurs", "skip", "keine Kursgruppe", "ausgeschlossen: Fach", "wartet auf Freigabe", "angemeldet"].includes(label)
    ? label
    : label.startsWith("kein Kurs:") ? "kein Kurs" : label.startsWith("ausgeschlossen") ? "ausgeschlossen" : "übrige";

/** Speichern / Verwerfen mit Stand: "Ungespeicherte Änderungen" oder "Gespeichert um HH:MM". */
function SaveBar({
  dirty,
  saving,
  savedAt,
  disabled,
  blockedReason,
  label = "Speichern",
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  savedAt?: string;
  disabled?: boolean;
  /** Fehler im Formular: Speichern gesperrt, Grund steht beim Feld */
  blockedReason?: string;
  label?: string;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <span className="ml-auto flex flex-wrap items-center gap-2 text-xs">
      {dirty ? (
        <span className="font-semibold text-amber-700">{blockedReason ?? "Ungespeicherte Änderungen"}</span>
      ) : (
        savedAt && <span className="text-green-700">Gespeichert um {savedAt}</span>
      )}
      <button
        onClick={onDiscard}
        disabled={!dirty || saving || disabled}
        className="rounded-lg border border-gray-200 px-3 py-1.5 font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
      >
        Verwerfen
      </button>
      <button
        onClick={onSave}
        disabled={!dirty || saving || disabled || !!blockedReason}
        className={`rounded-lg px-3 py-1.5 font-semibold disabled:opacity-40 ${
          dirty && !blockedReason ? "bg-amber-500 text-white ring-2 ring-amber-300 hover:bg-amber-600" : "bg-[#4A7FC1] text-white"
        }`}
      >
        {saving ? "Speichert…" : label}
      </button>
    </span>
  );
}

/** Meldungen der Pruefung beim Feld: Fehler rot (verhindern Speichern), Warnungen gelb. */
function FieldMsg({ check, fields }: { check: { errors: FieldIssue[]; warnings: FieldIssue[] }; fields: string[] }) {
  const errs = check.errors.filter((e) => fields.includes(e.field));
  const warns = check.warnings.filter((e) => fields.includes(e.field));
  if (!errs.length && !warns.length) return null;
  return (
    <ul className="-mt-1 space-y-0.5 text-xs">
      {errs.map((e, i) => <li key={`e${i}`} className="font-semibold text-red-600">{e.msg}</li>)}
      {warns.map((e, i) => <li key={`w${i}`} className="text-amber-700">Hinweis: {e.msg}</li>)}
    </ul>
  );
}

const PREVIEW_WER: Array<[PreviewWer, string]> = [["du", "Schüler (du)"], ["eltern", "Eltern"], ["unklar", "unklar"], ["en", "Englisch"]];

function CourseEditor({
  course,
  all,
  settings,
  log,
  open,
  disabled,
  dirty,
  isNew,
  saving,
  savedAt,
  onSave,
  onDiscard,
  onToggle,
  onChange,
  onDelete,
}: {
  course: Course;
  /** alle Kurse (Entwurf), fuer die Ueberschneidungs-Warnung */
  all: Course[];
  settings: FollowupSettings;
  log: LogRow[];
  open: boolean;
  disabled: boolean;
  dirty: boolean;
  isNew: boolean;
  saving: boolean;
  savedAt?: string;
  onSave: () => void;
  onDiscard: () => void;
  onToggle: () => void;
  onChange: (c: Course) => void;
  onDelete: () => void;
}) {
  const [art, setArt] = useState<PreviewArt>("erst");
  const [wer, setWer] = useState<PreviewWer>("du");
  const set = <K extends keyof Course>(k: K, v: Course[K]) => onChange({ ...course, [k]: v });
  // Vorschau und Pruefung immer aus dem aktuellen Formular (auch ungespeichert).
  const preview = previewMessage(course, settings.privatePricePerLesson, art, wer);
  const check = checkCourse(course, all, settings.privatePricePerLesson);
  const st = courseStats(course, log);
  const subjects = Array.from(new Set([...settings.mySubjects, course.fach]));
  // Stufe nachfragen: nur Text, keine Termine/Preise/Zusagen.
  const inquiry = course.gruppe === "offen";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <p className="px-4 pt-4 font-semibold text-gray-900">Kurs bearbeiten</p>
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
        <button onClick={onToggle} className="text-xs text-[#4A7FC1] underline underline-offset-2">
          {open ? "Einklappen" : "Bearbeiten"}
        </button>
        <SaveBar
          dirty={dirty}
          saving={saving}
          savedAt={savedAt}
          disabled={disabled}
          label={isNew ? "Kurs speichern" : "Speichern"}
          blockedReason={check.errors.length ? `${check.errors.length} ${check.errors.length === 1 ? "Fehler" : "Fehler"} — bitte korrigieren` : undefined}
          onSave={onSave}
          onDiscard={onDiscard}
        />
      </div>

      {open && (
        <div className="grid gap-4 border-t border-gray-100 p-4 lg:grid-cols-2">
          <div className="space-y-3 text-sm text-gray-600">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex w-full items-center gap-2 sm:w-auto">
                Name
                <input value={course.name} disabled={disabled} onChange={(e) => set("name", e.target.value)} className={`${inputClass} w-full min-w-0 sm:w-72`} />
              </label>
              <label className="flex w-full items-center gap-2 sm:w-auto" title="Für englische Nachrichten; leer = deutscher Name">
                Name englisch
                <input
                  value={course.nameEn ?? ""}
                  placeholder="optional, z.B. Matura maths preparation course"
                  disabled={disabled}
                  onChange={(e) => set("nameEn", e.target.value)}
                  className={`${inputClass} w-full min-w-0 sm:w-72`}
                />
              </label>
            </div>
            <FieldMsg check={check} fields={["name", "nameEn", "fach"]} />
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
            <FieldMsg check={check} fields={["saturdays"]} />
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
            <FieldMsg check={check} fields={["time", "pricePerLesson", "lessons"]} />
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
              <label className="flex items-center gap-2" title="Voll, sobald so viele zugesagt oder bezahlt haben: dann bietet die Erst-Nachricht den Kurs nicht mehr an.">
                Plätze
                <input type="number" min={1} value={capacity(course)} disabled={disabled} onChange={(e) => set("maxParticipants", Number(e.target.value))} className={`${inputClass} w-16`} />
              </label>
            </div>
            <FieldMsg check={check} fields={["place", "deadline", "minParticipants", "maxParticipants"]} />
            </>
            )}
            <p className="text-xs text-gray-400">
              Der Nachrichtentext entsteht aus den Kursdaten: derselbe Kursblock, Gruss und dieselbe Signatur wie in der Erst-Nachricht.
              Wer den Kurs schon in der Erst-Nachricht bekam, erhält nur eine kurze Erinnerung. Änderungen gelten erst nach „Speichern“;
              bis dahin nutzen Erst-Nachricht und Nachfassen die gespeicherte Fassung.
            </p>
            <button
              onClick={onDelete}
              disabled={disabled}
              className="rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Kurs löschen
            </button>
          </div>
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span className="font-semibold uppercase tracking-wide">Vorschau</span>
              {dirty && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">Entwurf — nicht gespeichert</span>}
              <select value={art} onChange={(e) => setArt(e.target.value as PreviewArt)} className={inputClass} aria-label="Nachricht">
                <option value="erst">Erst-Nachricht</option>
                <option value="nachfassen">Nachfassen</option>
              </select>
              <select value={wer} onChange={(e) => setWer(e.target.value as PreviewWer)} className={inputClass} aria-label="Anrede">
                {PREVIEW_WER.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <p className="mb-2 text-[11px] text-gray-400">
              {art === "erst" ? "Der persönliche Satz ist ein Beispiel; im Versand kommt er aus dem Inserat." : "Beispielname „Lea“ (nur in der du-Fassung im Gruss)."}
              {wer === "eltern" && " Eltern-Beispiel: „Ihre Tochter“."}
              {wer === "en" && !course.nameEn?.trim() && " Kein englischer Kursname eingetragen — es steht der deutsche."}
            </p>
            <FieldMsg check={check} fields={["vorschau"]} />
            {preview.problem && <p className="mb-2 text-xs font-semibold text-red-600">Diese Fassung besteht die Prüfung vor dem Senden nicht: {preview.problem}</p>}
            <div className={`whitespace-pre-wrap rounded-xl border p-4 text-xs leading-5 text-gray-700 ${dirty ? "border-amber-200 bg-amber-50/40" : "border-blue-100 bg-blue-50"}`}>
              {preview.text}
            </div>
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
  tab = "uebersicht",
  onTab,
  focusCourse = null,
  onOpenCourse,
}: {
  view?: "nachfassen" | "kurse";
  /** nur view "kurse": welcher Reiter (app/kurse/page.tsx) */
  tab?: KurseTab;
  onTab?: (t: KurseTab) => void;
  focusCourse?: string | null;
  onOpenCourse?: (courseId: string) => void;
} = {}) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openCourse, setOpenCourse] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(focusCourse);
  // /kurse: Kursliste oder Kursseite (Pipeline + Bearbeiten + Manuell)
  const [courseOpen, setCourseOpen] = useState(!!focusCourse);
  const [showNew, setShowNew] = useState(false);
  const [newFach, setNewFach] = useState("Mathe");
  const [newGruppe, setNewGruppe] = useState<CourseGroup>("bm");
  // id des Kurses, der gerade gespeichert wird ("settings" = Einstellungen oben)
  const [saving, setSaving] = useState<string | null>(null);
  // "Gespeichert um HH:MM" pro Kurs bzw. fuer die Einstellungen
  const [savedAt, setSavedAt] = useState<Record<string, string>>({});
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

  // Gespeichert gilt nur, was der Server hat (courses.json / settings.json): danach richten sich Pipeline,
  // Erst-Nachricht und Nachfassen. Der Entwurf ist nur fuer Formular und Vorschau.
  const savedCourse = (id: string) => status?.courses.find((c) => c.id === id);
  const courseDirty = (id: string) => {
    const d = draft?.courses.find((c) => c.id === id);
    return !!d && JSON.stringify(d) !== JSON.stringify(savedCourse(id));
  };
  const settingsDirty = !!draft && !!status && JSON.stringify(draft.settings) !== JSON.stringify(status.settings);
  const dirty = settingsDirty || (draft?.courses.some((c) => courseDirty(c.id)) ?? false);
  // Fehler der GESPEICHERTEN Kurse sperren das Senden (der Entwurf zeigt seine Fehler beim Feld).
  const errors = useMemo(() => (status ? validateCourses(status.courses) : []), [status]);
  const demand = useMemo(() => (status ? demandOverview(status.rows, status.settings) : []), [status]);
  const logged = useMemo(() => followedUpIds(status?.log ?? []), [status]);
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

  const hhmm = () => new Date().toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });

  /** Speichert genau einen Kurs (die anderen bleiben, wie sie gespeichert sind) bzw. nur die Einstellungen. */
  const persist = async (key: string, payload: { settings: FollowupSettings; courses: Course[] }) => {
    setSaving(key);
    try {
      const data = (await post({ action: "config", ...payload })) as { settings: FollowupSettings; courses: Course[] } | null;
      if (!data) return false;
      setStatus((st) => st && { ...st, settings: data.settings, courses: data.courses });
      setSavedAt((m) => ({ ...m, [key]: hhmm() }));
      await fetchStatus();
      return true;
    } finally {
      setSaving(null);
    }
  };
  const saveCourse = async (id: string) => {
    if (!draft || !status) return;
    const c = draft.courses.find((x) => x.id === id);
    if (!c) return;
    const saved = status.courses.some((x) => x.id === id) ? status.courses.map((x) => (x.id === id ? c : x)) : [...status.courses, c];
    await persist(id, { settings: status.settings, courses: saved });
  };
  const discardCourse = (id: string) => {
    if (!draft) return;
    const saved = savedCourse(id);
    setDraft({ ...draft, courses: saved ? draft.courses.map((x) => (x.id === id ? saved : x)) : draft.courses.filter((x) => x.id !== id) });
    if (!saved) setSelectedId(null);
  };
  const saveSettings = async () => {
    if (!draft || !status) return;
    await persist("settings", { settings: draft.settings, courses: status.courses });
  };
  const discardSettings = () => {
    if (draft && status) setDraft({ ...draft, settings: status.settings });
  };

  // Seite verlassen mit ungespeicherten Aenderungen: Browser-Warnung.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    // Links innerhalb der App (Menue) loesen kein beforeunload aus: selbst nachfragen.
    const onLink = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.origin !== window.location.origin || a.pathname === window.location.pathname) return;
      if (!window.confirm("Es gibt ungespeicherte Änderungen. Seite trotzdem verlassen?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", onLink, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", onLink, true);
    };
  }, [dirty]);

  const start = async (action: Mode, forCourse?: string) => {
    if (!status) return;
    // Kein Bestaetigungsfenster: die gepruefte Liste steht beim Knopf, der Lauf geht dann ohne Rueckfrage durch.
    setBusy(true);
    try {
      // Senden und Antworten prüfen gelten nur fuer den ausgewaehlten Kurs; Kandidaten suchen liest alle Konversationen.
      const courseId = action === "send" || action === "replies" ? forCourse ?? selected?.id : undefined;
      if (await post({ action, max: maxChecks, courseId })) await fetchStatus();
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
    // Sofort umschalten: Zeile UND Person (der Text folgt der gespeicherten Anrede der Person).
    setStatus((s) => {
      if (!s) return s;
      const row = s.rows.find((r) => r.conversation_id === id);
      const leads = { ...s.leads };
      for (const key of [id, row?.inserat_id ? `inserat:${row.inserat_id}` : ""])
        if (key && leads[key]) leads[key] = withAnrede(leads[key], anrede);
      return { ...s, leads, rows: s.rows.map((r) => (r.conversation_id === id ? { ...r, anrede } : r)) };
    });
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
  // Einstellungen (Faecher, Schalter, Einzelpreis): eigener Speichern-Knopf, gilt erst nach dem Klick.
  const saveButton = (
    <SaveBar
      dirty={settingsDirty}
      saving={saving === "settings"}
      savedAt={savedAt.settings}
      disabled={running}
      label="Einstellungen speichern"
      onSave={() => void saveSettings()}
      onDiscard={discardSettings}
    />
  );
  const addCourse = async (fach: string, gruppe: CourseGroup) => {
    const c = newCourse(fach, gruppe);
    // Aus dem Nachfassen-Tab: neuer (inaktiver) Kurs sofort speichern, dann auf die Seite /kurse.
    if (onOpenCourse) {
      if (await post({ action: "config", settings: status.settings, courses: [...status.courses, c] })) onOpenCourse(c.id);
      return;
    }
    // Auf /kurse: als Entwurf anlegen, gespeichert wird mit "Speichern".
    setDraft({ ...draft, courses: [...draft.courses, c] });
    setSelectedId(c.id);
    setOpenCourse(null);
    setCourseOpen(true);
  };
  const selected = draft.courses.find((c) => c.id === selectedId) ?? draft.courses[0] ?? null;
  /** Anderen Kurs oeffnen: ungespeicherte Aenderungen am aktuellen erst bestaetigen lassen. */
  const selectCourse = (id: string) => {
    if (selected && selected.id !== id && courseDirty(selected.id)) {
      if (!window.confirm(`„${selected.name || "Kurs ohne Namen"}“ hat ungespeicherte Änderungen. Verwerfen und den anderen Kurs öffnen?`)) return;
      discardCourse(selected.id);
    }
    setSelectedId(id);
    setCourseOpen(true);
  };
  const openCourseTab = (id: string) => (onOpenCourse ? onOpenCourse(id) : selectCourse(id));
  const deleteSelected = () => {
    if (!selected) return;
    // Mit Angeschriebenen haette deren Pipeline keinen Kurs mehr: Antworten waeren unsichtbar.
    const contacted = status.log.filter((r) => r.kurs === selected.id).length;
    if (contacted > 0) {
      alert(`„${selected.name}“ hat schon ${contacted} Angeschriebene. Löschen würde ihre Antworten aus der Pipeline entfernen. Setz den Kurs stattdessen auf pausiert.`);
      return;
    }
    if (window.confirm(`Kurs „${selected.name}“ löschen?`)) {
      // Loeschen gilt sofort (nicht erst mit "Speichern").
      const id = selected.id;
      setDraft({ ...draft, courses: draft.courses.filter((x) => x.id !== id) });
      setSelectedId(null);
      setCourseOpen(false);
      if (status.courses.some((x) => x.id === id)) void persist("delete", { settings: status.settings, courses: status.courses.filter((x) => x.id !== id) });
    }
  };
  // Pipeline, "Bereit" und Senden rechnen mit der gespeicherten Fassung.
  const selectedSaved = selected ? savedCourse(selected.id) ?? null : null;
  // "Bereit": wer beim naechsten Senden diesen Kurs bekaeme — auch wenn er gerade pausiert ist.
  const readyFor = (c: Course) => {
    const asActive = status.courses.map((x) => (x.id === c.id ? { ...x, active: true } : x));
    return status.rows.flatMap((r) => {
      const eff = effectiveStatus(r, asActive, status.settings, logged, status.log, undefined, leadFor(status.leads, r));
      return eff.send && eff.course?.id === c.id ? [{ ...r, kind: eff.kind }] : [];
    });
  };
  // Schritt 2 und 3 beziehen sich auf den ausgewaehlten Kurs; das Tageslimit gilt fuer alle zusammen.
  const waiting = status.log.filter((r) => needsReplyCheck(r) && r.kurs === selected?.id).length;
  const coursePending = send.recipients.filter((r) => r.courseId === selected?.id);
  const courseQueue = coursePending.slice(0, send.budget);
  const badRecipients = courseQueue.filter((r) => r.problem);
  const frenchQueue = send.recipients.filter((r) => r.courseId === NO_COURSE).slice(0, send.budget);
  // Auswahl und Anlegen mit demselben Fach: "Mathe" ist nur Startwert, falls es unter "Meine Faecher" steht.
  const fachForNew = draft.settings.mySubjects.includes(newFach) ? newFach : draft.settings.mySubjects[0] ?? "";

  const withEff = status.rows.map((r) => ({ r, eff: effectiveStatus(r, status.courses, status.settings, logged, status.log, undefined, leadFor(status.leads, r)) }));
  const shown = withEff.filter(({ r, eff }) => (filter === "alle" || statusGroup(eff.label) === filter) && (!onlySend || r.status === "send"));
  const groupCounts = withEff.reduce<Record<string, number>>((acc, { eff }) => {
    const g = statusGroup(eff.label);
    return { ...acc, [g]: (acc[g] ?? 0) + 1 };
  }, {});
  const notAnalysed = status.rows.filter((r) => r.fach && !r.faecher).length;
  const lastLine = state.log.at(-1) ?? "";
  const runningLabel = { preview: "Probelauf läuft", send: "Senden läuft", replies: "Antworten werden geprüft", compare: "Vergleich läuft" };
  // Abgebrochener manueller Lauf: nur die letzten 12 Stunden zeigen, aeltere stehen nicht mehr im Weg.
  const recentError = !running && !!state.error && !!state.finishedAt && Date.now() - new Date(state.finishedAt).getTime() < 12 * 3600_000;
  const lastPass = status.autopilot.durchgaenge[0];
  const fmtAt = (iso: string) => new Date(iso).toLocaleString("de-CH", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
  const attention: Attention[] = [
    ...(status.autopilot.gestoppt ? [{ tone: "bad" as const, text: <><b>Automatik gestoppt</b> ({fmtAt(status.autopilot.gestoppt.am)}): {status.autopilot.gestoppt.grund}</> }] : []),
    ...(status.uebersicht.laptop && !status.uebersicht.laptop.online
      ? [{ tone: "bad" as const, text: <><b>Laptop offline</b> seit {fmtAt(status.uebersicht.laptop.at)}. Ohne Laptop läuft kein Durchgang.</> }]
      : []),
    ...(lastPass?.fehlerKurz && !lastPass.behoben && !lastPass.stopp
      ? [{ tone: "bad" as const, text: <><b>Letzter Durchgang abgebrochen</b> ({fmtAt(lastPass.start)}): {lastPass.fehlerKurz}</>, action: { label: "Protokoll", onClick: () => onTab?.("protokoll") } }]
      : []),
    ...(errors.length ? [{ tone: "bad" as const, text: <><b>Ein Kurs hat einen Fehler</b>, bis dahin wird nichts gesendet: {errors.join(" ")}</>, action: { label: "Kurse", onClick: () => onTab?.("kurse") } }] : []),
    ...status.log
      .filter((r) => pipelineStage(r) === "antwort")
      .map((r) => ({
        tone: "info" as const,
        text: <><b>Neue Antwort</b> von {r.name || "ohne Namen"} · {status.courses.find((c) => c.id === r.kurs)?.name ?? "ohne Kurs"}. Lesen und in der Pipeline einordnen.</>,
        action: { label: "Chat öffnen", href: `https://www.tutor24.ch/de/conversations/${r.conversation_id}?tab=sent` },
      })),
    ...status.courses
      .filter((c) => c.active && c.gruppe !== "offen")
      .flatMap((c) => {
        const st = courseStats(c, status.log);
        return st.tageBisSchluss >= 0 && st.tageBisSchluss <= 10 && st.zusagen < c.minParticipants
          ? [{ tone: "warn" as const, text: <><b>{c.name}:</b> noch {st.tageBisSchluss} {st.tageBisSchluss === 1 ? "Tag" : "Tage"} bis Anmeldeschluss, {st.zusagen} von {c.minParticipants} Zusagen.</>, action: { label: "Kurs ansehen", onClick: () => { onTab?.("kurse"); selectCourse(c.id); } } }]
          : [];
      }),
    ...(status.courses.length > 0 && !status.courses.some((c) => c.active) ? [{ tone: "warn" as const, text: <><b>Kein Kurs aktiv</b> — niemand bekommt ein Kursangebot.</> }] : []),
  ];

  return (
    <div className="space-y-4">
      {/* Live-Status (Seite /tutor24; /kurse hat seinen eigenen, kurzen) */}
      {view !== "kurse" && status.blockedBy && !running && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          tutor24 ist gerade belegt: <b>{status.blockedBy}</b>. Starten ist möglich, sobald dieser Lauf fertig ist.
        </div>
      )}
      {view !== "kurse" && (running || state.error || state.finishedAt) && (
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
          {state.error && !running && state.details && (
            <details className="mt-1 text-xs text-gray-600">
              <summary className="cursor-pointer text-red-700/80">Details</summary>
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-2 font-mono text-[11px] leading-4">{state.details}</pre>
            </details>
          )}
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
          {/* Laufender oder eben abgebrochener manueller Lauf: kurz, Technisches eingeklappt */}
          {status.blockedBy && !running && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
              tutor24 ist gerade belegt: <b>{status.blockedBy}</b>. Manuelle Schritte gehen, sobald dieser Lauf fertig ist.
            </p>
          )}
          {(running || recentError) && (
            <div className={`rounded-xl border px-4 py-3 text-sm ${running ? "border-blue-200 bg-blue-50" : "border-red-200 bg-red-50"}`}>
              <div className="flex flex-wrap items-center gap-3">
                <b className={running ? "text-gray-900" : "text-red-800"}>{running ? runningLabel[state.mode ?? "preview"] : "Manueller Lauf abgebrochen"}</b>
                {running && <span className="text-gray-600">{state.done} von {state.total || "?"} · {state.progress}</span>}
                {!running && <span className="text-red-800">{state.error}</span>}
                {running && (
                  <button
                    onClick={async () => {
                      await fetch("/api/tutor24/followup", { method: "DELETE" });
                      void fetchStatus();
                    }}
                    className="ml-auto rounded-lg border border-red-300 bg-white px-3 py-1 font-semibold text-red-700 hover:bg-red-50"
                  >
                    Stoppen
                  </button>
                )}
              </div>
              {(state.details || state.log.length > 1) && (
                <details className="mt-1 text-xs text-gray-600">
                  <summary className="cursor-pointer text-[#4A7FC1]">Technische Details</summary>
                  {state.details && <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-2 font-mono text-[11px]">{state.details}</pre>}
                  <div className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-900 p-2 font-mono text-[11px] leading-5 text-green-400">{state.log.join("\n")}</div>
                </details>
              )}
            </div>
          )}

          {tab === "uebersicht" && (
            <Overview
              info={status.autopilot}
              ov={status.uebersicht}
              attention={attention}
              onMode={async (modus) => {
                await post({ action: "autopilot", modus });
                await fetchStatus();
              }}
            />
          )}

          {tab === "protokoll" && <PassTable passes={status.autopilot.durchgaenge} />}

          {tab === "einstellungen" && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-gray-900">Einstellungen</h2>
              <div className={card}>
                <h3 className="font-semibold text-gray-900">Erst-Nachricht</h3>
                <SettingRow title="Kursblock" help="Ist ein passender Kurs offen, steht der konkrete Kurs mit Daten und Preis in der Erst-Nachricht. Die bisherigen Ausschlüsse gelten.">
                  <Toggle id="set-kursblock" checked={draft.settings.newFirstMessage} disabled={running} onChange={(v) => setSettings({ newFirstMessage: v })} />
                </SettingRow>
                <SettingRow title="Kurs-Hinweis" help="Ist kein passender Kurs offen, steht ein kurzer Hinweis auf Academigo drin. Nicht für Erwachsene ohne BM-Bezug.">
                  <Toggle id="set-hinweis" checked={draft.settings.kursHinweis} disabled={running} onChange={(v) => setSettings({ kursHinweis: v })} />
                </SettingRow>
                <SettingRow title="Kurspreis ab" help="„ab CHF … pro Lektion“ im Kurs-Hinweis.">
                  <NumberField id="set-preisab" value={draft.settings.kursPreisAb} min={1} unit="CHF" disabled={running} onChange={(v) => setSettings({ kursPreisAb: v })} />
                </SettingRow>
                <SettingRow title="Einzelunterricht" help="Vergleichspreis im Kursblock beider Nachrichten: „CHF … pro Lektion statt CHF … im Einzelunterricht“.">
                  <NumberField id="set-einzel" value={draft.settings.privatePricePerLesson} min={1} unit="CHF" disabled={running} onChange={(v) => setSettings({ privatePricePerLesson: v })} />
                </SettingRow>
              </div>
              <div className={card}>
                <h3 className="font-semibold text-gray-900">Automatik</h3>
                <SettingRow title="Erst-Nachrichten pro Tag" help="Höchstens so viele neue Inserate pro Tag, über alle Durchgänge und „jetzt senden“ zusammen.">
                  <NumberField id="set-erstlimit" value={draft.settings.autoErstLimit} min={0} disabled={running} onChange={(v) => setSettings({ autoErstLimit: v })} />
                </SettingRow>
                <SettingRow title="Nachfassen pro Tag" help="Höchstens so viele Nachfass-Nachrichten pro Tag (höchstens 25).">
                  <NumberField id="set-nachlimit" value={draft.settings.autoNachfassLimit} min={0} max={25} disabled={running} onChange={(v) => setSettings({ autoNachfassLimit: v })} />
                </SettingRow>
                <SettingRow title="Nachfassen frühestens nach" help="So viele Tage nach der Erst-Nachricht, und nur ohne Antwort (mindestens 3).">
                  <NumberField id="set-tage" value={draft.settings.nachfassNachTagen} min={3} unit="Tagen" disabled={running} onChange={(v) => setSettings({ nachfassNachTagen: v })} />
                </SettingRow>
              </div>
              <div className={card}>
                <h3 className="font-semibold text-gray-900">Meine Fächer</h3>
                <p className="mt-1 text-sm text-gray-500">Nur diese Fächer zählen für Kurse und die Interessentenliste.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {SUBJECTS.map((s) => {
                    const on = draft.settings.mySubjects.includes(s);
                    return (
                      <button
                        key={s}
                        disabled={running}
                        aria-pressed={on}
                        onClick={() => setSettings({ mySubjects: on ? draft.settings.mySubjects.filter((x) => x !== s) : [...draft.settings.mySubjects, s] })}
                        className={`rounded-full border px-3 py-1 text-sm font-medium ${on ? "border-[#4A7FC1] bg-blue-50 text-[#4A7FC1]" : "border-gray-300 bg-white text-gray-600"}`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="sticky bottom-0 pb-[env(safe-area-inset-bottom,0px)]">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-300 bg-white px-4 py-3 shadow-lg">
                  <span className="text-sm text-gray-600">{settingsDirty ? <b className="text-amber-700">Ungespeicherte Änderungen — gelten erst nach Speichern</b> : savedAt.settings ? `Gespeichert um ${savedAt.settings}` : "Alles gespeichert"}</span>
                  <SaveBar dirty={settingsDirty} saving={saving === "settings"} savedAt={undefined} disabled={running} onSave={() => void saveSettings()} onDiscard={discardSettings} />
                </div>
              </div>
            </div>
          )}

          {tab === "kurse" && !courseOpen && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-gray-900">Kurse</h2>
                <button onClick={() => setShowNew(!showNew)} disabled={running} className={btnPrimary}>+ Neuer Kurs</button>
              </div>
              {showNew && (
                <div className={`${card} flex flex-wrap items-center gap-3`}>
                  <label className="flex items-center gap-2 text-sm text-gray-600" htmlFor="new-fach">
                    Fach
                    <select id="new-fach" value={fachForNew} onChange={(e) => setNewFach(e.target.value)} className={inputClass}>
                      {draft.settings.mySubjects.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-600" htmlFor="new-gruppe">
                    Kursgruppe
                    <select id="new-gruppe" value={newGruppe} onChange={(e) => setNewGruppe(e.target.value as CourseGroup)} className={inputClass}>
                      {COURSE_GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
                    </select>
                  </label>
                  <button onClick={() => { setShowNew(false); void addCourse(fachForNew, newGruppe); }} disabled={running || !fachForNew} className={btnPrimary}>Anlegen und bearbeiten</button>
                  <button onClick={() => setShowNew(false)} className="text-sm font-semibold text-gray-500">Abbrechen</button>
                </div>
              )}
              {draft.courses.length > 0 && !draft.courses.some((c) => c.active) && (
                <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800">Kein Kurs aktiv — niemand bekommt ein Kursangebot. Kurs öffnen und „aktiv“ setzen.</p>
              )}
              {errors.length > 0 && <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">Ein gespeicherter Kurs hat einen Fehler, bis dahin wird nichts gesendet: {errors.join(" ")}</p>}
              {activeCount > MAX_ACTIVE_COURSES && (
                <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800">{activeCount} Kurse sind gleichzeitig aktiv. Mehr als {MAX_ACTIVE_COURSES} verteilen die Anmeldungen meist zu dünn.</p>
              )}
              {draft.courses.length === 0 && <p className={`${card} text-sm text-gray-500`}>Noch kein Kurs. Mit „+ Neuer Kurs“ anlegen.</p>}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {draft.courses.map((c) => {
                  const st = courseStats(c, status.log);
                  const saved = savedCourse(c.id);
                  const open = c.gruppe === "offen";
                  const tone = !saved?.active ? "off" : open ? "ok" : st.ampel;
                  return (
                    <button key={c.id} onClick={() => openCourseTab(c.id)} className="grid gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-left hover:border-[#4A7FC1]">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-gray-900">{c.name || "Kurs ohne Namen"}</span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${saved?.active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{saved?.active ? "aktiv" : "pausiert"}</span>
                          {courseDirty(c.id) && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{saved ? "ungespeichert" : "neu"}</span>}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500">
                        {open ? "Fragt nach der genauen Stufe (nur Nachfassen)" : `${formatSaturdays(c.saturdays)} · ${c.time} · ${c.mode === "online" ? "online" : c.place || "vor Ort"} · CHF ${c.pricePerLesson}/Lektion`}
                      </p>
                      {!open && (
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <Meter label="Zusagen" value={`${st.zusagen} / ${c.minParticipants}`} />
                          <Meter label="frei" value={String(Math.max(0, capacity(c) - st.zusagen))} />
                          <Meter label="Anmeldeschluss" value={st.tageBisSchluss >= 0 ? `${st.tageBisSchluss} T.` : "vorbei"} />
                        </div>
                      )}
                      <p className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold ${AMPEL_PILL[tone]}`}>
                          <span className={`h-2 w-2 rounded-full ${tone === "off" ? "bg-gray-400" : AMPEL[tone as keyof typeof AMPEL]}`} />
                          {tone === "off" ? "pausiert" : open ? "läuft" : tone === "gruen" ? "genug Zusagen" : tone === "gelb" ? "erste Zusagen" : "noch keine Zusage"}
                        </span>
                        <span>{readyFor(c).length} bereit · {st.angeschrieben} angeschrieben · {st.geantwortet} Antworten · {st.bezahlt} bezahlt</span>
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "kurse" && courseOpen && selected && (
            <div className="space-y-5">
              <button onClick={() => setCourseOpen(false)} className="text-sm font-semibold text-[#4A7FC1]">← Alle Kurse</button>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-gray-900">{selected.name || "Kurs ohne Namen"}</h2>
                  <p className="text-sm text-gray-500">
                    {selected.fach} · {GROUP_LABEL[selected.gruppe]}
                    {selected.gruppe !== "offen" && ` · ${formatSaturdays(selected.saturdays)} · Anmeldeschluss ${selected.deadline.split("-").reverse().join(".")}`}
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${selectedSaved?.active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{selectedSaved?.active ? "aktiv" : "pausiert"}</span>
              </div>

              <div className={card}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-gray-900">Pipeline</h3>
                  <span className="text-xs text-gray-500">Name öffnet den Chat auf tutor24. „Einordnen“ verschiebt die Person.</span>
                </div>
                {!selectedSaved && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Dieser Kurs ist noch nicht gespeichert: unten „Kurs speichern“, dann erscheint seine Pipeline.</p>}
                {selectedSaved && !selectedSaved.active && (
                  <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Dieser Kurs ist pausiert: „Bereit“ zeigt, wer ihn bekäme. Gesendet wird erst, wenn er aktiv ist.</p>
                )}
                {selected.gruppe === "offen" && <p className="mb-3 text-xs text-gray-500">Wer die Stufe nennt, übernimmst du mit „In Kurs übernehmen“ in den passenden Kurs.</p>}
                {selectedSaved && (
                  <CoursePipeline
                    key={selectedSaved.id}
                    course={selectedSaved}
                    courses={status.courses}
                    ready={readyFor(selectedSaved)}
                    log={status.log.filter((r) => r.kurs === selectedSaved.id)}
                    rows={status.rows}
                    leads={status.leads}
                    privatePrice={status.settings.privatePricePerLesson}
                    disabled={running}
                    onMark={(id, m) => void mark(id, m)}
                    onSkip={(r) => void toggleRow(r)}
                    onAssign={(id, kurs) => void assign(id, kurs)}
                    onAnrede={(id, a) => void setAnrede(id, a)}
                  />
                )}
              </div>

              <CourseEditor
                course={selected}
                all={draft.courses}
                settings={draft.settings}
                log={status.log}
                open={openCourse !== `zu:${selected.id}`}
                disabled={running}
                dirty={courseDirty(selected.id)}
                isNew={!selectedSaved}
                saving={saving === selected.id}
                savedAt={savedAt[selected.id]}
                onSave={() => void saveCourse(selected.id)}
                onDiscard={() => discardCourse(selected.id)}
                onToggle={() => setOpenCourse(openCourse === `zu:${selected.id}` ? null : `zu:${selected.id}`)}
                onChange={(next) => setCourses(draft.courses.map((x) => (x.id === selected.id ? next : x)))}
                onDelete={deleteSelected}
              />

              <details className={card}>
                <summary className="cursor-pointer font-semibold text-gray-900">Manuell ausführen</summary>
                <p className="mt-2 text-sm text-gray-500">
                  Die Automatik macht diese Schritte selbst um 9 und 17 Uhr. Hier nur, wenn du sie für <b>{selected.name || "diesen Kurs"}</b> von Hand starten willst. Es läuft immer nur ein Lauf; er läuft weiter, auch wenn du die Seite neu lädst.
                </p>
                {errors.length > 0 ? (
                  <p className="mt-2 text-sm font-semibold text-red-700">Senden gesperrt: ein Kurs hat einen Fehler.</p>
                ) : (
                  courseDirty(selected.id) && <p className="mt-2 text-sm font-semibold text-amber-700">Ungespeicherte Änderungen — gesendet wird die gespeicherte Fassung.</p>
                )}
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div className="grid content-start gap-2 rounded-xl border border-gray-200 p-4">
                    <h4 className="font-semibold text-gray-900">Kandidaten suchen</h4>
                    <p className="text-sm text-gray-500">Liest die Chats: wer auf die Erst-Nachricht nicht geantwortet hat, kommt nach „Bereit“. Sendet nichts.</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button onClick={() => void start("preview")} disabled={blocked || busy || !(maxChecks >= 1)} className={btnPrimary}>Suchen</button>
                      <label className="flex items-center gap-1 text-xs text-gray-500" htmlFor="max-checks">
                        max.
                        <input id="max-checks" type="number" min={1} value={maxChecks} onChange={(e) => setMaxChecks(Number(e.target.value))} disabled={blocked} className={`${inputClass} w-20`} />
                      </label>
                    </div>
                  </div>
                  <div className="grid content-start gap-2 rounded-xl border border-gray-200 p-4">
                    <h4 className="font-semibold text-gray-900">Nachfassen senden</h4>
                    <p className="text-sm text-gray-500">
                      An alle in „Bereit“{!selected.active && " (Kurs pausiert — erst aktiv setzen)"}. Höchstens {send.limit} pro Tag (heute noch {send.budget}), 1–3 Minuten Pause dazwischen. Alle Texte werden vorher geprüft.
                      {coursePending.length > courseQueue.length && ` ${coursePending.length - courseQueue.length} weitere folgen an einem späteren Tag.`}
                    </p>
                    {courseQueue.length > 0 && (
                      <details className="text-xs" open={badRecipients.length > 0}>
                        <summary className={`cursor-pointer font-semibold ${badRecipients.length ? "text-red-600" : "text-green-700"}`}>
                          {badRecipients.length ? `${badRecipients.length} von ${courseQueue.length} Nachrichten fehlerhaft — so wird nichts gesendet` : `✓ ${courseQueue.length} Nachrichten geprüft — Liste ansehen`}
                        </summary>
                        <ul className="mt-1 max-h-56 space-y-1 overflow-y-auto">
                          {courseQueue.map((r) => (
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
                    <button
                      onClick={() => void start("send")}
                      disabled={blocked || busy || !selectedSaved || errors.length > 0 || badRecipients.length > 0 || courseQueue.length === 0}
                      className="justify-self-start rounded-xl bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {courseQueue.length > 0 ? `${courseQueue.length} ${courseQueue.length === 1 ? "Person" : "Personen"} anschreiben` : "Niemand bereit"}
                    </button>
                    {frenchQueue.length > 0 && (
                      <div className="rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
                        {frenchQueue.length} französische {frenchQueue.length === 1 ? "Person bekommt" : "Personen bekommen"} ein einfaches Nachfassen ohne Kurs
                        {frenchQueue.some((r) => r.problem) && <b className="text-red-600"> — Text fehlerhaft: {frenchQueue.find((r) => r.problem)?.problem}</b>}
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[#4A7FC1]">Text ansehen</summary>
                          <p className="mt-1 whitespace-pre-wrap">{frenchQueue[0].text}</p>
                        </details>
                        <button
                          onClick={() => void start("send", NO_COURSE)}
                          disabled={blocked || busy || frenchQueue.some((r) => r.problem)}
                          className="mt-2 rounded-lg border border-green-600 px-3 py-1 font-semibold text-green-700 hover:bg-green-50 disabled:opacity-50"
                        >
                          Französisch nachfassen
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="grid content-start gap-2 rounded-xl border border-gray-200 p-4">
                    <h4 className="font-semibold text-gray-900">Antworten prüfen</h4>
                    <p className="text-sm text-gray-500">Schaut in den Chats aller, die diesen Kurs bekamen, nach Antworten. Neue erscheinen in der Pipeline unter „Antwort erhalten“. Sendet nichts.</p>
                    <button
                      onClick={() => void start("replies")}
                      disabled={blocked || busy || waiting === 0}
                      className="justify-self-start rounded-xl border border-[#4A7FC1] px-5 py-2 text-sm font-semibold text-[#4A7FC1] hover:bg-blue-50 disabled:opacity-50"
                    >
                      {waiting > 0 ? `${waiting} ${waiting === 1 ? "Chat" : "Chats"} prüfen` : !status.log.some((r) => r.kurs === selected.id) ? "Noch niemand angeschrieben" : "Alle haben geantwortet oder sind eingeordnet"}
                    </button>
                  </div>
                </div>
              </details>
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
                  const msg =
                    eff.course && eff.kind
                      ? followupMessage(eff.kind, followupForm(leadFor(status.leads, r), r.anrede), r.name, eff.course, draft.settings.privatePricePerLesson)
                      : null;
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
                              {msg.anrede}-Form anzeigen{msg.problem ? " ⚠" : ""}
                            </summary>
                            <div className="mt-1 whitespace-pre-wrap rounded-lg bg-gray-50 p-2 leading-5 text-gray-700">{msg.problem && <b className="block text-red-600">{msg.problem}</b>}{msg.text}</div>
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

export type KurseTab = "uebersicht" | "kurse" | "interessenten" | "einstellungen" | "protokoll";

const AMPEL_PILL = { gruen: "bg-green-50 text-green-700", gelb: "bg-amber-50 text-amber-800", rot: "bg-red-50 text-red-700", ok: "bg-green-50 text-green-700", off: "bg-gray-100 text-gray-500" } as const;

function Meter({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-2 py-1.5">
      <span className="block text-xs text-gray-500">{label}</span>
      <b className="tabular-nums text-gray-900">{value}</b>
    </div>
  );
}

/** Eine Einstellung: Titel, ein Satz, was sie bewirkt, und das Feld. */
function SettingRow({ title, help, children }: { title: string; help: string; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-2 border-t border-gray-100 py-3.5 first-of-type:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
      <div className="min-w-0">
        <p className="font-semibold text-gray-900">{title}</p>
        <p className="text-sm text-gray-500">{help}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}

function Toggle({ id, checked, disabled, onChange }: { id: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 rounded-full transition disabled:opacity-50 ${checked ? "bg-[#4A7FC1]" : "bg-gray-300"}`}
    >
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "left-6" : "left-1"}`} />
      <span className="sr-only">{checked ? "an" : "aus"}</span>
    </button>
  );
}

function NumberField({ id, value, min, max, unit, disabled, onChange }: { id: string; value: number; min: number; max?: number; unit?: string; disabled?: boolean; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-600" htmlFor={id}>
      <input id={id} type="number" min={min} max={max} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50" />
      {unit}
    </label>
  );
}

