"use client";

import { useEffect, useMemo, useState } from "react";
import { KNOWN_LEVELS, LEVEL_GROUPS, nextLevels } from "@/lib/school-levels";
import type { Student } from "@/lib/ui-types";

const CUSTOM = "__custom__";
const NONE = "Ohne Stufe";

const selectClass =
  "w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none transition focus:border-[#4A7FC1] focus:ring-2 focus:ring-[#4A7FC1]/20";

async function saveLevels(updates: Array<{ id: string; level: string | null }>, markReviewed = false) {
  const res = await fetch("/api/students/levels", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates, markReviewed }),
  });
  return res.ok;
}

/** Auswahl aus den bekannten Stufen, den eigenen Stufen und "+ Eigene Stufe…" zum Eintippen. */
function LevelSelect({
  value,
  customLevels,
  suggestions = [],
  onChange,
}: {
  value: string | null;
  customLevels: string[];
  suggestions?: string[];
  onChange: (level: string | null) => void;
}) {
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");

  if (typing) {
    const commit = () => {
      setTyping(false);
      if (draft.trim()) onChange(draft.trim());
    };
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setTyping(false);
        }}
        placeholder="z.B. Lehre KV 1. Jahr — Enter zum Speichern"
        className={selectClass}
      />
    );
  }

  return (
    <select
      value={value ?? ""}
      onChange={(e) => {
        if (e.target.value === CUSTOM) {
          setDraft("");
          setTyping(true);
        } else onChange(e.target.value || null);
      }}
      className={selectClass}
    >
      <option value="">— keine Stufe —</option>
      {suggestions.length > 0 && (
        <optgroup label="Vorschlag">
          {suggestions.map((l) => <option key={`s-${l}`} value={l}>{l}</option>)}
        </optgroup>
      )}
      {LEVEL_GROUPS.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.levels.map((l) => <option key={l} value={l}>{l}</option>)}
        </optgroup>
      ))}
      {customLevels.length > 0 && (
        <optgroup label="Eigene Stufen">
          {customLevels.map((l) => <option key={l} value={l}>{l}</option>)}
        </optgroup>
      )}
      <option value={CUSTOM}>+ Eigene Stufe…</option>
    </select>
  );
}

type LevelUpdate = { id: string; level: string | null };

export function StudentLevels({
  students,
  onChanged,
}: {
  students: Student[];
  /** Gespeicherte Aenderungen, damit die Seite ohne Neuladen nachziehen kann. */
  onChanged: (updates: LevelUpdate[]) => void;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const [reviewNeeded, setReviewNeeded] = useState(false);
  const [schoolYear, setSchoolYear] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/students/levels")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { reviewNeeded: boolean; schoolYear: number } | null) => {
        if (!d) return;
        setReviewNeeded(d.reviewNeeded);
        setSchoolYear(d.schoolYear);
      });
  }, []);

  // ponytail: eigene Stufen leben an den Schuelern; vergibt sie keiner mehr, verschwindet sie aus der Liste.
  const customLevels = useMemo(
    () => Array.from(new Set(students.map((s) => s.level).filter((l): l is string => !!l && !KNOWN_LEVELS.includes(l)))).sort(),
    [students]
  );

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const s of students) c.set(s.level ?? NONE, (c.get(s.level ?? NONE) ?? 0) + 1);
    const order = (l: string) => (l === NONE ? 1e6 : KNOWN_LEVELS.indexOf(l) === -1 ? 1e5 : KNOWN_LEVELS.indexOf(l));
    return Array.from(c.entries()).sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
  }, [students]);

  const visible = students.filter((s) => filter === null || (s.level ?? NONE) === filter);

  const setOne = async (id: string, level: string | null) => {
    setError("");
    if (!(await saveLevels([{ id, level }]))) return setError("Speichern fehlgeschlagen.");
    onChanged([{ id, level }]);
  };

  const startReview = () => {
    setDraft(Object.fromEntries(students.map((s) => [s.id, nextLevels(s.level)[0] ?? s.level ?? null])));
    setReviewing(true);
  };

  const confirmReview = async () => {
    setBusy(true);
    setError("");
    const updates = students
      .filter((s) => (draft[s.id] ?? null) !== (s.level ?? null))
      .map((s) => ({ id: s.id, level: draft[s.id] ?? null }));
    const ok = await saveLevels(updates, true);
    setBusy(false);
    if (!ok) return setError("Speichern fehlgeschlagen.");
    setReviewing(false);
    setReviewNeeded(false);
    onChanged(updates);
  };

  if (reviewing) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
          <b>Neues Schuljahr {schoolYear}/{schoolYear !== null ? String(schoolYear + 1).slice(2) : ""}:</b> Jeder Schüler
          ist eine Stufe weiter vorgeschlagen. Wo es mehrere Wege gibt (z.B. nach der 6. Primar), stehen sie oben unter
          „Vorschlag“. Prüfe die Liste und bestätige.
        </div>
        <div className="overflow-x-auto rounded-2xl border border-blue-100 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                <th className="px-5 py-3.5">Name</th>
                <th className="px-5 py-3.5">Bisher</th>
                <th className="px-5 py-3.5">Neu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {students.map((s) => {
                const options = nextLevels(s.level);
                return (
                  <tr key={s.id}>
                    <td className="px-5 py-3 font-semibold text-gray-800">{s.name}</td>
                    <td className="px-5 py-3 text-gray-500">{s.level ?? "—"}</td>
                    <td className="min-w-[14rem] px-5 py-3">
                      <LevelSelect
                        value={draft[s.id] ?? null}
                        customLevels={customLevels}
                        suggestions={options}
                        onChange={(level) => setDraft((d) => ({ ...d, [s.id]: level }))}
                      />
                      {options.length > 1 && (
                        <p className="mt-1 text-xs text-amber-700">Mehrere Wege möglich — bitte prüfen.</p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            onClick={() => setReviewing(false)}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300"
          >
            Abbrechen
          </button>
          <button
            disabled={busy}
            onClick={() => void confirmReview()}
            className="rounded-xl bg-[#4A7FC1] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Wird gespeichert…" : "Stufen übernehmen & Schuljahr bestätigen"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {reviewNeeded && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <span>Neues Schuljahr: deine Schüler sind eine Klasse weiter. Bitte die Stufen prüfen.</span>
          <button
            onClick={startReview}
            className="shrink-0 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
          >
            Stufen jetzt prüfen
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter(null)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${filter === null ? "border-[#4A7FC1] bg-[#4A7FC1] text-white" : "border-gray-200 bg-white text-gray-600 hover:border-[#4A7FC1]"}`}
        >
          Alle · {students.length}
        </button>
        {counts.map(([level, n]) => (
          <button
            key={level}
            onClick={() => setFilter(filter === level ? null : level)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${filter === level ? "border-[#4A7FC1] bg-[#4A7FC1] text-white" : level === NONE ? "border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-400" : "border-gray-200 bg-white text-gray-600 hover:border-[#4A7FC1]"}`}
          >
            {level} · {n}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-blue-100 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-100 text-sm">
          <thead>
            <tr className="text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              <th className="px-5 py-3.5">Name</th>
              <th className="px-5 py-3.5">Fach</th>
              <th className="px-5 py-3.5">Stufe</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {visible.map((s) => (
              <tr key={s.id} className="transition-colors hover:bg-[#F8FBFF]">
                <td className="px-5 py-3 font-semibold text-gray-800">{s.name}</td>
                <td className="px-5 py-3 text-gray-600">{s.subject}</td>
                <td className="min-w-[14rem] px-5 py-3">
                  <LevelSelect value={s.level ?? null} customLevels={customLevels} onChange={(l) => void setOne(s.id, l)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!reviewNeeded && (
        <p className="text-xs text-gray-500">
          Änderungen werden sofort gespeichert. Ab 1. August erinnert dich das Dashboard, die Stufen fürs neue Schuljahr
          zu prüfen.
        </p>
      )}
    </div>
  );
}

/** Dashboard-Hinweis nach dem Sommer; verschwindet, sobald das Schuljahr bestaetigt ist. */
export function LevelsReviewBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    void fetch("/api/students/levels")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { reviewNeeded: boolean } | null) => setShow(!!d?.reviewNeeded));
  }, []);
  if (!show) return null;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
      <span>
        <b>Neues Schuljahr:</b> deine Schüler sind in die nächste Klasse gekommen. Bitte die Stufen neu setzen.
      </span>
      <a
        href="/students?tab=stufen"
        className="shrink-0 rounded-xl bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
      >
        Stufen prüfen
      </a>
    </div>
  );
}
