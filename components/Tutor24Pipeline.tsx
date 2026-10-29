"use client";

import {
  LEVEL_LABEL,
  MARKS,
  MARK_LABEL,
  STAGES,
  STAGE_LABEL,
  messageProblem,
  pipelineStage,
  renderMessage,
  type Course,
  type LevelCategory,
  type LogRow,
  type PreviewRow,
  type Stage,
} from "@/lib/tutor24-followup";

type Row = Omit<PreviewRow, "nachricht">;

const DAY_MS = 24 * 60 * 60 * 1000;
const chatUrl = (id: string) => `https://www.tutor24.ch/de/conversations/${id}?tab=sent`;
const daysSince = (iso: string) => {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / DAY_MS);
};
const fmtDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getDate()}.${d.getMonth() + 1}.`;
};

const STAGE_STYLE: Record<Stage, string> = {
  bereit: "border-gray-200 bg-gray-50",
  angeschrieben: "border-blue-100 bg-blue-50/40",
  antwort: "border-amber-200 bg-amber-50",
  interessiert: "border-violet-200 bg-violet-50/60",
  zugesagt: "border-green-200 bg-green-50",
  bezahlt: "border-emerald-300 bg-emerald-50",
  abgesagt: "border-gray-200 bg-gray-50",
};

const STAGE_HINT: Partial<Record<Stage, string>> = {
  bereit: "Erhalten beim nächsten „Anschreiben“ das Angebot.",
  angeschrieben: "Noch keine Antwort bekannt. „Antworten prüfen“ schaut nach.",
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

/** Anrede der gesendeten Nachricht steht im Protokoll: "Kursname/du" (nach Uebernahme "… → Kurs"). */
const sentAnrede = (l: LogRow) => l.variante.match(/\/(du|Sie)\b/)?.[1] ?? "";

/** Anrede umschalten und genau den Text zeigen, der beim Senden rausgeht. */
function ReadyMessage({
  course,
  row,
  disabled,
  onAnrede,
}: {
  course: Course;
  row: Row;
  disabled: boolean;
  onAnrede: (id: string, anrede: "du" | "Sie") => void;
}) {
  const want = row.anrede === "du" ? "du" : "Sie";
  const msg = renderMessage(course, row.name, want);
  // Dieselbe Pruefung wie vor dem Senden: so sieht man hier schon, was den Lauf blockieren wuerde.
  const problem = messageProblem(msg.text.trim(), msg.anrede);
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
      {msg.warning && <p className="mt-1 text-amber-700">{msg.warning}</p>}
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
  disabled,
  onMark,
  onSkip,
  onAssign,
  onAnrede,
}: {
  course: Course;
  courses: Course[];
  /** Vorschau-Zeilen, die beim naechsten Senden diesen Kurs bekommen */
  ready: Row[];
  /** Protokoll-Zeilen dieses Kurses */
  log: LogRow[];
  rows: Row[];
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

  return (
    <div className="-mx-1 overflow-x-auto pb-2">
      <div className="flex min-w-max gap-3 px-1">
        {columns.map(({ stage, items }) => {
          const count = stage === "bereit" ? ready.length : items.length;
          return (
            <section key={stage} className={`w-64 shrink-0 rounded-xl border ${STAGE_STYLE[stage]} p-2`}>
              <header className="mb-2 px-1">
                <h3 className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-600">
                  {STAGE_LABEL[stage]}
                  <span className="rounded-full bg-white px-2 py-0.5 text-gray-700 shadow-sm">{count}</span>
                </h3>
                {STAGE_HINT[stage] && <p className="mt-1 text-[11px] leading-4 text-gray-500">{STAGE_HINT[stage]}</p>}
              </header>
              <div className="max-h-[32rem] space-y-2 overflow-y-auto">
                {count === 0 && <p className="px-1 py-3 text-center text-xs text-gray-400">—</p>}

                {stage === "bereit" &&
                  ready.map((r) => (
                    <article key={r.conversation_id} className="rounded-lg border border-gray-100 bg-white p-2 text-xs shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <a href={r.link || chatUrl(r.conversation_id)} target="_blank" rel="noreferrer" className="font-semibold text-gray-800 hover:text-[#4A7FC1]">
                          {r.name || r.conversation_id}
                        </a>
                        <button
                          onClick={() => onSkip(r)}
                          disabled={disabled}
                          title="Diese Person nicht anschreiben"
                          className="text-[11px] text-gray-400 hover:text-red-600 disabled:opacity-50"
                        >
                          nicht anschreiben
                        </button>
                      </div>
                      <p className="mt-0.5 text-gray-500">{meta(r)}</p>
                      <ReadyMessage course={course} row={r} disabled={disabled} onAnrede={onAnrede} />
                    </article>
                  ))}

                {items.map((l) => {
                  const days = daysSince(l.zeitstempel);
                  const failed = l.geantwortet.startsWith("fehler");
                  return (
                    <article key={l.conversation_id} className="rounded-lg border border-gray-100 bg-white p-2 text-xs shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <a href={chatUrl(l.conversation_id)} target="_blank" rel="noreferrer" className="font-semibold text-gray-800 hover:text-[#4A7FC1]">
                          {l.name || l.conversation_id}
                        </a>
                        <span className="shrink-0 text-[11px] text-gray-400">
                          {stage === "angeschrieben" && days !== null
                            ? days === 0 ? "heute" : `seit ${days} ${days === 1 ? "Tag" : "Tagen"}`
                            : fmtDay(l.zeitstempel)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-gray-500">
                        {meta(byId.get(l.conversation_id))}
                        {sentAnrede(l) && <span className="text-gray-400"> · gesendet per {sentAnrede(l)}</span>}
                      </p>
                      {l.status === "unbestaetigt" && <p className="mt-1 text-amber-700">Senden nicht bestätigt — im Chat nachsehen.</p>}
                      {failed && <p className="mt-1 text-amber-700">Antwort konnte nicht gelesen werden, wird erneut geprüft.</p>}
                      {l.antwort && (
                        <p className="mt-1.5 rounded-md bg-gray-50 p-1.5 italic leading-4 text-gray-700">
                          «{l.antwort}»{l.antwort_datum && <span className="not-italic text-gray-400"> — {l.antwort_datum}</span>}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <select
                          value={l.markierung || "offen"}
                          disabled={disabled}
                          onChange={(e) => onMark(l.conversation_id, e.target.value)}
                          className="rounded-md border border-gray-200 px-1.5 py-0.5 text-[11px] disabled:bg-gray-50"
                          aria-label="Einordnen"
                        >
                          {MARKS.map((m) => <option key={m} value={m}>{MARK_LABEL[m]}</option>)}
                        </select>
                        {inquiry && targets.length > 0 && (
                          <select
                            value=""
                            disabled={disabled}
                            onChange={(e) => e.target.value && onAssign(l.conversation_id, e.target.value)}
                            className="rounded-md border border-[#4A7FC1] px-1.5 py-0.5 text-[11px] text-[#4A7FC1] disabled:opacity-50"
                            aria-label="In Kurs übernehmen"
                          >
                            <option value="">In Kurs übernehmen …</option>
                            {targets.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
