"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LEVEL_LABEL,
  OFFER_LEVELS,
  PLACEHOLDERS,
  isOfferLevel,
  renderMessage,
  validateSettings,
  type FollowupSettings,
  type LevelCategory,
  type LevelSettings,
  type OfferLevel,
  type PreviewRow,
} from "@/lib/tutor24-followup";

type Row = Omit<PreviewRow, "nachricht">;

type StatusResponse = {
  state: {
    running: boolean;
    mode: "preview" | "send" | null;
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
  rows: Row[];
  send: { limit: number; sentToday: number; budget: number; pending: number; queue: number; levels: string[] };
};

const CATEGORIES: LevelCategory[] = [...OFFER_LEVELS, "unklar", "ausgeschlossen"];
const inputClass = "rounded-lg border border-gray-200 px-2 py-1 text-sm disabled:bg-gray-50";
const cardClass = "rounded-2xl border border-blue-100 bg-white p-5 shadow-sm";

const levelBadge = (c: string) =>
  isOfferLevel(c)
    ? "bg-blue-50 text-[#4A7FC1]"
    : c === "unklar"
      ? "bg-amber-50 text-amber-700"
      : "bg-gray-100 text-gray-500";

function LevelEditor({
  level,
  value,
  disabled,
  onChange,
}: {
  level: OfferLevel;
  value: LevelSettings;
  disabled: boolean;
  onChange: (v: LevelSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  const [previewDu, setPreviewDu] = useState(false);
  const set = <K extends keyof LevelSettings>(k: K, v: LevelSettings[K]) => onChange({ ...value, [k]: v });
  const preview = renderMessage(value, "Lea", previewDu ? "du" : "Sie");

  return (
    <div className="rounded-xl border border-gray-100">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-gray-800">
          <input
            type="checkbox"
            checked={value.enabled}
            disabled={disabled}
            onChange={(e) => set("enabled", e.target.checked)}
            className="accent-[#4A7FC1]"
          />
          {LEVEL_LABEL[level]} anschreiben
        </label>
        <span className="text-xs text-gray-400">
          CHF {value.pricePerLesson} × {value.lessons} = CHF {value.pricePerLesson * value.lessons}, {value.mode}
        </span>
        <button onClick={() => setOpen((o) => !o)} className="ml-auto text-xs text-[#4A7FC1] underline underline-offset-2">
          {open ? "Einklappen" : "Kursdaten & Text bearbeiten"}
        </button>
      </div>

      {open && (
        <div className="grid gap-4 border-t border-gray-100 p-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
              <label>Start</label>
              <input type="date" value={value.startDate} disabled={disabled} onChange={(e) => set("startDate", e.target.value)} className={inputClass} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
              <label>Samstage</label>
              {value.saturdays.map((d, i) => (
                <input
                  key={i}
                  type="date"
                  value={d}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = [...value.saturdays] as LevelSettings["saturdays"];
                    next[i] = e.target.value;
                    set("saturdays", next);
                  }}
                  className={inputClass}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
              <label className="flex items-center gap-2">
                Uhrzeit
                <input value={value.time} disabled={disabled} onChange={(e) => set("time", e.target.value)} className={`${inputClass} w-36`} />
              </label>
              <label className="flex items-center gap-2">
                CHF/Lektion
                <input type="number" min={1} value={value.pricePerLesson} disabled={disabled} onChange={(e) => set("pricePerLesson", Number(e.target.value))} className={`${inputClass} w-20`} />
              </label>
              <label className="flex items-center gap-2">
                Lektionen
                <input type="number" min={1} value={value.lessons} disabled={disabled} onChange={(e) => set("lessons", Number(e.target.value))} className={`${inputClass} w-16`} />
              </label>
              <select value={value.mode} disabled={disabled} onChange={(e) => set("mode", e.target.value as LevelSettings["mode"])} className={inputClass}>
                <option value="online">online</option>
                <option value="vor Ort">vor Ort</option>
              </select>
            </div>
            <div>
              <textarea
                value={value.template}
                disabled={disabled}
                onChange={(e) => set("template", e.target.value)}
                rows={14}
                className="w-full rounded-xl border border-gray-200 p-3 font-mono text-xs leading-5 outline-none focus:border-[#4A7FC1]"
              />
              <p className="mt-1 text-xs text-gray-400">
                Sie-Form schreiben, die du-Form wird automatisch abgeleitet. Platzhalter: {PLACEHOLDERS.join(" ")}
              </p>
            </div>
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
            <div className="whitespace-pre-wrap rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs leading-5 text-gray-700">
              {preview.text}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function Tutor24Followup() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [draft, setDraft] = useState<FollowupSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [maxChecks, setMaxChecks] = useState(150);
  const [filter, setFilter] = useState<"alle" | LevelCategory>("alle");
  const [onlySend, setOnlySend] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/tutor24/followup");
      if (!res.ok) return;
      const data = (await res.json()) as StatusResponse;
      setStatus(data);
      // Entwurf nur beim ersten Laden setzen, sonst ueberschreibt das Polling ungespeicherte Eingaben.
      setDraft((d) => d ?? data.settings);
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
    () => !!draft && !!status && JSON.stringify(draft) !== JSON.stringify(status.settings),
    [draft, status]
  );
  const settingsErrors = useMemo(() => (draft ? validateSettings(draft) : []), [draft]);
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

  const saveSettings = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const data = await post({ action: "settings", settings: draft });
      if (data?.settings) setDraft(data.settings);
      await fetchStatus();
    } finally {
      setSaving(false);
    }
  };

  const start = async (action: "preview" | "send") => {
    if (!status) return;
    if (action === "send") {
      const s = status.send;
      if (!window.confirm(`${s.queue} Nachrichten an Stufen ${s.levels.join(", ")} senden?\n\nZwischen den Nachrichten wartet die Automation 60–180 Sekunden.`)) return;
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

  if (!status || !draft) return <div className="h-64 animate-pulse rounded-2xl border border-blue-100 bg-white" />;

  const { state, send } = status;
  const rows = status.rows.filter((r) => (filter === "alle" || r.kategorie === filter) && (!onlySend || r.status === "send"));
  const counts = CATEGORIES.map((c) => ({
    c,
    ready: status.rows.filter((r) => r.kategorie === c && r.status === "send").length,
    total: status.rows.filter((r) => r.kategorie === c).length,
  }));
  const lastLine = state.log.at(-1) ?? "";

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
              {running ? (state.mode === "send" ? "Senden läuft" : "Probelauf läuft") : state.error ? "Abgebrochen" : "Letzter Lauf fertig"}
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

      {/* Stufen */}
      <div className={cardClass}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="font-semibold text-gray-900">Stufen</h2>
          <p className="text-xs text-gray-500">Gesendet wird nur an Stufen mit Haken. Standard: alle aus.</p>
          <button
            onClick={() => void saveSettings()}
            disabled={!dirty || saving || running || settingsErrors.length > 0}
            className="ml-auto rounded-xl bg-[#4A7FC1] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#3a6fb1] disabled:opacity-50"
          >
            {saving ? "Speichert…" : dirty ? "Einstellungen speichern" : "Gespeichert"}
          </button>
        </div>
        {settingsErrors.length > 0 && (
          <ul className="mb-3 space-y-0.5 rounded-lg bg-red-50 p-3 text-xs text-red-600">
            {settingsErrors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
        <div className="space-y-2">
          {OFFER_LEVELS.map((l) => (
            <LevelEditor key={l} level={l} value={draft[l]} disabled={running} onChange={(v) => setDraft({ ...draft, [l]: v })} />
          ))}
        </div>
      </div>

      {/* Probelauf */}
      <div className={cardClass}>
        <h2 className="mb-1 font-semibold text-gray-900">Probelauf</h2>
        <p className="mb-3 text-sm text-gray-500">
          Liest die Konversationen und ordnet jede einer Stufe zu, unabhängig von den Haken. Sendet nichts. Ein neuer Lauf
          setzt dort fort, wo der letzte aufgehört hat. Pro Konversation etwa 25 Sekunden.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            max. Konversationen
            <input type="number" min={1} value={maxChecks} onChange={(e) => setMaxChecks(Number(e.target.value))} disabled={blocked} className={`${inputClass} w-20`} />
          </label>
          <button
            onClick={() => void start("preview")}
            disabled={blocked || busy || !(maxChecks >= 1)}
            className="rounded-xl bg-[#4A7FC1] px-5 py-2 text-sm font-semibold text-white hover:bg-[#3a6fb1] disabled:opacity-50"
          >
            Probelauf starten
          </button>
        </div>
      </div>

      {/* Vorschau */}
      <div className={cardClass}>
        <h2 className="mb-3 font-semibold text-gray-900">Vorschau ({status.rows.length} Konversationen)</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {counts.filter((x) => x.total > 0).map(({ c, ready, total }) => (
            <button
              key={c}
              onClick={() => setFilter(filter === c ? "alle" : c)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === c ? "border-[#4A7FC1] bg-[#4A7FC1] text-white" : "border-gray-200 bg-white text-gray-600"}`}
              title={isOfferLevel(c) ? `${ready} würden angeschrieben, falls „${LEVEL_LABEL[c]}“ angehakt ist` : "wird nie gesendet"}
            >
              {LEVEL_LABEL[c]}: {isOfferLevel(c) ? `${ready} bereit` : total}
              {isOfferLevel(c) && !draft[c].enabled ? " (aus)" : ""}
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
                  <th className="py-2 pr-3">Begründung</th>
                  <th className="py-2 pr-3">Datum</th>
                  <th className="py-2 pr-3">Nachricht</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r) => {
                  const msg = isOfferLevel(r.kategorie) ? renderMessage(draft[r.kategorie], r.name, r.anrede === "du" ? "du" : "Sie") : null;
                  return (
                    <tr key={r.conversation_id} className="align-top">
                      <td className="py-2 pr-3">
                        <a href={r.link} target="_blank" rel="noopener noreferrer" className="font-medium text-gray-800 hover:text-[#4A7FC1] hover:underline">
                          {r.name || "—"}
                        </a>
                      </td>
                      <td className="py-2 pr-3">
                        {r.kategorie && (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${levelBadge(r.kategorie)}`}>
                            {LEVEL_LABEL[r.kategorie as LevelCategory] ?? r.kategorie}
                          </span>
                        )}
                      </td>
                      <td className="max-w-xs py-2 pr-3 text-xs text-gray-600">
                        {r.begruendung}
                        {r.status !== "send" && r.grund && <span className="block text-gray-400">{r.grund}</span>}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-xs text-gray-500">{r.letzte_nachricht}</td>
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
                      </td>
                    </tr>
                  );
                })}
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
          Bereit in angehakten Stufen: <b>{send.pending}</b>
          {send.pending > send.queue && ` (davon heute ${send.queue}, der Rest an einem späteren Tag)`}.
        </p>
        {dirty && <p className="mb-2 text-xs text-amber-700">Bitte zuerst die Einstellungen speichern — gesendet wird mit den gespeicherten Texten.</p>}
        <button
          onClick={() => void start("send")}
          disabled={blocked || busy || dirty || send.queue === 0}
          className="rounded-xl bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {send.queue > 0 ? `${send.queue} Nachrichten senden` : "Nichts zu senden"}
        </button>
      </div>
    </div>
  );
}
