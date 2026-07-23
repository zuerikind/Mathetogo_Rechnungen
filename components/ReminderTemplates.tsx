"use client";

import { useEffect, useRef, useState } from "react";
import { useReminderTemplates, type ReminderTemplates as Templates } from "@/hooks/useReminderTemplates";

const STAGES: { key: keyof Templates; label: string }[] = [
  { key: "stage1", label: "1. Erinnerung (nach dem 15.)" },
  { key: "stage2", label: "2. Erinnerung (ca. 10 Tage später)" },
  { key: "stage3", label: "Mahnung (Monatsende)" },
];

const TOKENS = ["{name}", "{betrag}", "{rechnungsnummer}", "{faelligkeit}", "{periode}"];

export function ReminderTemplates() {
  const { templates, status, save } = useReminderTemplates();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Templates | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const areaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // Textareas beim Wechsel in den Edit-Modus oben ausrichten (erste Zeile sichtbar).
  useEffect(() => {
    if (!editing) return;
    Object.values(areaRefs.current).forEach((el) => {
      if (el) el.scrollTop = 0;
    });
  }, [editing]);

  function startEditing() {
    if (!templates) return;
    setDraft({ ...templates });
    setError("");
    setEditing(true);
  }

  async function onSave() {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      await save(draft);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="text-xs font-semibold text-slate-700">Erinnerungs-Vorlagen</span>
        <span className="shrink-0 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs text-slate-500">
          {open ? "Ausblenden ▴" : "Anzeigen ▾"}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-200 p-3">
          {status === "error" ? (
            <p className="text-xs text-red-600">Vorlagen konnten nicht geladen werden.</p>
          ) : !templates ? (
            <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-slate-500">
                  Platzhalter:{" "}
                  {TOKENS.map((t) => (
                    <code key={t} className="mx-0.5 rounded bg-white px-1 py-0.5 text-[10px] text-slate-600">
                      {t}
                    </code>
                  ))}
                </p>
                {!editing ? (
                  <button
                    type="button"
                    onClick={startEditing}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
                  >
                    Bearbeiten
                  </button>
                ) : (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => { setEditing(false); setError(""); }}
                      disabled={saving}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:text-slate-700 disabled:opacity-40"
                    >
                      Abbrechen
                    </button>
                    <button
                      type="button"
                      onClick={() => void onSave()}
                      disabled={saving}
                      className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-40"
                    >
                      {saving ? "Speichern…" : "Speichern"}
                    </button>
                  </div>
                )}
              </div>

              {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

              <div className="space-y-3">
                {STAGES.map(({ key, label }) => (
                  <div key={key}>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      {label}
                    </label>
                    {editing && draft ? (
                      <textarea
                        ref={(el) => {
                          areaRefs.current[key] = el;
                        }}
                        value={draft[key]}
                        maxLength={2000}
                        onChange={(e) => setDraft((d) => (d ? { ...d, [key]: e.target.value } : d))}
                        rows={12}
                        className="w-full resize-y rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
                      />
                    ) : (
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-100 bg-white px-2.5 py-2 text-sm text-slate-600">
                        {templates[key]}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
