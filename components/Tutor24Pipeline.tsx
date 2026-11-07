"use client";

import { useState } from "react";
import {
  LEVEL_LABEL,
  MARKS,
  MARK_LABEL,
  STAGES,
  STAGE_LABEL,
  leadFor,
  pipelineStage,
  type Course,
  type FollowupKind,
  type LeadInfo,
  type LeadMap,
  type LevelCategory,
  type LogRow,
  type PreviewRow,
  type Stage,
} from "@/lib/tutor24-followup";
import { followupForm, followupMessage } from "@/lib/tutor24-course-offer";

type Row = Omit<PreviewRow, "nachricht">;
/** "Bereit"-Zeile mit der Nachfass-Art aus effectiveStatus (angebot, erinnerung, …). */
export type ReadyRow = Row & { kind?: FollowupKind };

const DAY_MS = 24 * 60 * 60 * 1000;
// Erst-Nachricht ohne bekannte Konversation: Schluessel "inserat:<id>" → Link aufs Inserat.
const chatUrl = (id: string) =>
  id.startsWith("inserat:") ? `https://www.tutor24.ch/de/jobs/${id.slice(8)}` : `https://www.tutor24.ch/de/conversations/${id}?tab=sent`;
const daysSince = (iso: string) => {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / DAY_MS);
};
const fmtDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getDate()}.${d.getMonth() + 1}.`;
};

const STAGE_HINT: Partial<Record<Stage, string>> = {
  bereit: "Haben die Erst-Nachricht bekommen, nicht geantwortet: erhalten beim nächsten „Nachfassen senden“ das Kursangebot.",
  angeschrieben: "Kurs per Erst-Nachricht oder Nachfassen bekommen (siehe Kärtchen), noch keine Antwort bekannt.",
  antwort: "Neue Antworten: lesen und einordnen.",
};

/** Kurzinfo aus der Inserat-Analyse: "Sek · Klasse 8 · Zürich". */
function meta(r: Row | undefined): string {
  if (!r) return "";
  return [
    LEVEL_LABEL[r.kategorie as LevelCategory] ?? r.kategorie,
    r.gymi_jahr ? `${r.gymi_jahr}. Gymi-Jahr` : r.klasse && `Klasse ${r.klasse}`,
    r.ortsname || (r.ort !== "unbekannt" ? r.ort : ""),
    r.zeitwunsch,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Was die Person schon bekommen hat. `fallbackErst` = letzte Nachricht im Chat laut Probelauf
 * ("22.10.26, 21:31"); nur fuer "Bereit" verlaesslich (noch nicht nachgefasst, keine Antwort).
 */
function History({ lead, fallbackErst = "" }: { lead: LeadInfo | undefined; fallbackErst?: string }) {
  const erst = lead?.erstAm ? fmtDay(lead.erstAm) : fallbackErst.split(",")[0];
  const nach = lead?.nachfassAm ? fmtDay(lead.nachfassAm) : "";
  return (
    <p className="mt-1 flex flex-wrap gap-1 text-[11px]">
      <span className="rounded bg-blue-50 px-1.5 text-blue-800" title={erst ? undefined : "vor Beginn des Protokolls gesendet, genaues Datum unbekannt"}>Erst-Nachricht {erst || "früher"}</span>
      <span className={`rounded px-1.5 ${nach ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-500"}`}>
        {nach ? `Nachfassen ${nach}` : "noch nicht nachgefasst"}
      </span>
    </p>
  );
}

/** Anrede der gesendeten Nachricht steht im Protokoll: "Kursname/du" (nach Uebernahme "… → Kurs"). */
const sentAnrede = (l: LogRow) => l.variante.match(/\/(du|Sie)\b/)?.[1] ?? "";

/** Anrede umschalten und genau den Text zeigen, der beim Senden rausgeht. */
const KIND_LABEL: Record<FollowupKind, string> = {
  angebot: "Kursangebot",
  erinnerung: "Erinnerung (Kurs stand in der Erst-Nachricht)",
  geaendert: "Kurs geändert seit der Erst-Nachricht",
  neuer_durchgang: "neuer Durchgang",
  frage: "Frage nach der Stufe",
  einfach: "einfaches Nachfassen ohne Kurs",
};

function ReadyMessage({
  course,
  row,
  leads,
  privatePrice,
  disabled,
  onAnrede,
}: {
  course: Course;
  row: ReadyRow;
  leads: LeadMap;
  privatePrice: number;
  disabled: boolean;
  onAnrede: (id: string, anrede: "du" | "Sie") => void;
}) {
  const lead = leadFor(leads, row);
  // Dieselbe Pruefung wie vor dem Senden: so sieht man hier schon, was den Lauf blockieren wuerde.
  const form = followupForm(lead, row.anrede);
  // Markierter Knopf = Anrede des Textes darunter (nicht row.anrede: die gespeicherte Anrede der Person geht vor).
  const want = form.typ === "du" ? "du" : "Sie";
  const msg = followupMessage(row.kind ?? "angebot", form, row.name, course, privatePrice);
  const problem = msg.problem;
  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-gray-500">Anrede:</span>
        {(["Sie", "du"] as const).map((a) => (
          <button
            key={a}
            onClick={() => a !== want && onAnrede(row.conversation_id, a)}
            disabled={disabled}
            title={a === want ? "So wird geschrieben" : `Auf „${a}“ umstellen`}
            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50 ${
              a === want ? "border-[#4A7FC1] bg-[#4A7FC1] text-white" : "border-gray-200 text-gray-500 hover:border-[#4A7FC1]"
            }`}
          >
            {a}
          </button>
        ))}
      </div>
      <p className="mt-1 text-gray-500">{KIND_LABEL[row.kind ?? "angebot"]}{lead?.quelle === "erstnachricht" ? " · Anrede aus der Erst-Nachricht" : ""}</p>
      {problem && <p className="mt-1 font-semibold text-red-600">Text fehlerhaft: {problem}</p>}
      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] text-[#4A7FC1]">Nachricht ansehen</summary>
        <p className="mt-1 whitespace-pre-wrap rounded-md bg-gray-50 p-1.5 leading-4 text-gray-700">{msg.text}</p>
      </details>
    </div>
  );
}

export function CoursePipeline({
  course,
  courses,
  ready,
  log,
  rows,
  leads,
  privatePrice,
  disabled,
  onMark,
  onSkip,
  onAssign,
  onAnrede,
}: {
  course: Course;
  courses: Course[];
  /** Vorschau-Zeilen, die beim naechsten Senden diesen Kurs bekommen */
  ready: ReadyRow[];
  /** Protokoll-Zeilen dieses Kurses */
  log: LogRow[];
  rows: Row[];
  leads: LeadMap;
  privatePrice: number;
  disabled: boolean;
  onMark: (id: string, mark: string) => void;
  onSkip: (row: Row) => void;
  onAssign: (id: string, courseId: string) => void;
  onAnrede: (id: string, anrede: "du" | "Sie") => void;
}) {
  const byId = new Map(rows.map((r) => [r.conversation_id, r]));
  const inquiry = course.gruppe === "offen";
  const targets = courses.filter((c) => c.gruppe !== "offen");
  const columns = STAGES.map((stage) => ({
    stage,
    items: stage === "bereit" ? [] : log.filter((r) => pipelineStage(r) === stage),
  }));
  const countOf = (stage: Stage) => (stage === "bereit" ? ready.length : columns.find((c) => c.stage === stage)?.items.length ?? 0);
  const total = STAGES.reduce((n, s) => n + countOf(s), 0);
  // Neue Antworten zuerst: das ist, was zu tun ist.
  const [filter, setFilter] = useState<Stage | "alle">(countOf("antwort") ? "antwort" : "alle");
  const visible = columns.filter(({ stage }) => filter === "alle" || filter === stage);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status filtern">
        {(["alle", ...STAGES] as const).map((s) => {
          const n = s === "alle" ? total : countOf(s);
          const on = filter === s;
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              aria-pressed={on}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                on ? "border-[#4A7FC1] bg-blue-50 text-[#4A7FC1]" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
              } ${n === 0 && !on ? "opacity-60" : ""}`}
            >
              {s === "alle" ? "Alle" : STAGE_LABEL[s]} {n}
            </button>
          );
        })}
      </div>
      {filter !== "alle" && STAGE_HINT[filter] && <p className="mt-2 text-xs text-gray-500">{STAGE_HINT[filter]}</p>}
      {total === 0 && <p className="py-6 text-center text-sm text-gray-400">Noch niemand in diesem Kurs.</p>}
      <ul className="mt-2 divide-y divide-gray-100">
        {visible.flatMap(({ stage, items }) => [
          ...(stage === "bereit"
            ? ready.map((r) => (
                <li key={`b-${r.conversation_id}`} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={r.link || chatUrl(r.conversation_id)} target="_blank" rel="noreferrer" className="font-semibold text-gray-900 hover:text-[#4A7FC1]">
                        {r.name || r.conversation_id}
                      </a>
                      <StagePill stage="bereit" />
                    </div>
                    <p className="text-xs text-gray-500">{meta(r)}</p>
                    <History lead={leadFor(leads, r)} fallbackErst={r.letzte_nachricht} />
                  </div>
                  <div className="text-xs sm:max-w-xs">
                    <ReadyMessage course={course} row={r} leads={leads} privatePrice={privatePrice} disabled={disabled} onAnrede={onAnrede} />
                    <button
                      onClick={() => onSkip(r)}
                      disabled={disabled}
                      title="Diese Person nicht anschreiben"
                      className="mt-1 text-[11px] font-semibold text-gray-500 hover:text-red-600 disabled:opacity-50"
                    >
                      nicht anschreiben
                    </button>
                  </div>
                </li>
              ))
            : []),
          ...items.map((l) => {
            const days = daysSince(l.zeitstempel);
            const failed = l.geantwortet.startsWith("fehler");
            return (
              <li key={`${stage}-${l.conversation_id}`} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={chatUrl(l.conversation_id)} target="_blank" rel="noreferrer" className="font-semibold text-gray-900 hover:text-[#4A7FC1]">
                      {l.name || l.conversation_id}
                    </a>
                    <StagePill stage={stage} />
                    {stage === "angeschrieben" && days !== null && (
                      <span className="text-xs text-gray-400">{days === 0 ? "heute angeschrieben" : `seit ${days} ${days === 1 ? "Tag" : "Tagen"} keine Antwort`}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    {meta(byId.get(l.conversation_id))}
                    {sentAnrede(l) && <span className="text-gray-400"> · {sentAnrede(l)}</span>}
                  </p>
                  <History lead={leadFor(leads, l)} />
                  {l.status === "unbestaetigt" && <p className="mt-1 text-xs text-amber-700">Senden nicht bestätigt — im Chat nachsehen.</p>}
                  {failed && <p className="mt-1 text-xs text-amber-700">Antwort konnte nicht gelesen werden, wird erneut geprüft.</p>}
                  {l.antwort && (
                    <p className="mt-1.5 border-l-2 border-gray-200 pl-2 text-xs italic text-gray-600">
                      «{l.antwort}»{l.antwort_datum && <span className="not-italic text-gray-400"> — {l.antwort_datum}</span>}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <select
                    value={l.markierung || "offen"}
                    disabled={disabled}
                    onChange={(e) => onMark(l.conversation_id, e.target.value)}
                    className="rounded-lg border border-gray-200 px-2 py-1 text-xs disabled:bg-gray-50"
                    aria-label="Einordnen"
                  >
                    {MARKS.map((m) => <option key={m} value={m}>{MARK_LABEL[m]}</option>)}
                  </select>
                  {inquiry && targets.length > 0 && (
                    <select
                      value=""
                      disabled={disabled}
                      onChange={(e) => e.target.value && onAssign(l.conversation_id, e.target.value)}
                      className="rounded-lg border border-[#4A7FC1] px-2 py-1 text-xs text-[#4A7FC1] disabled:opacity-50"
                      aria-label="In Kurs übernehmen"
                    >
                      <option value="">In Kurs übernehmen …</option>
                      {targets.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  )}
                </div>
              </li>
            );
          }),
        ])}
      </ul>
    </div>
  );
}

const PILL: Record<Stage, string> = {
  bereit: "bg-amber-50 text-amber-800",
  angeschrieben: "bg-gray-100 text-gray-600",
  antwort: "bg-blue-50 text-[#4A7FC1]",
  interessiert: "bg-green-50 text-green-700",
  zugesagt: "bg-green-100 text-green-800",
  bezahlt: "bg-green-600 text-white",
  abgesagt: "bg-red-50 text-red-700",
};
function StagePill({ stage }: { stage: Stage }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${PILL[stage]}`}>{STAGE_LABEL[stage]}</span>;
}
