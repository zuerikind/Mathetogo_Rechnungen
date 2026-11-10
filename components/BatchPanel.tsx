"use client";

import { useCallback, useEffect, useState } from "react";
import type { Batch, BatchItem, Markiert } from "@/lib/tutor24-batch";

type State = { batch: Batch | null; laeuft: boolean; pause: string | null; vorbereitenGesperrt: string | null; sendenGesperrt: string | null; online?: boolean; markiert?: Markiert[] };

const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50";
const SPRACHE = { de: "Deutsch", en: "Englisch", fr: "Französisch" } as const;
const SATZ: Record<string, string> = { ki: "KI", fallback: "Ersatzsatz", fest: "fester Satz", ohne: "ohne" };
const ANREDE: Record<string, string> = { du: "du (Schüler/in)", Tochter: "Eltern · Ihre Tochter", Sohn: "Eltern · Ihr Sohn", Kind: "Eltern · Ihr Kind", unklar: "unklar (Sie, neutral)" };

/**
 * Reiter "Batch" auf /kurse (nur Laptop): Anzahl → "Batch vorbereiten" (liest Inserate, sendet nichts) →
 * Vorschau pro Nachricht (abhaken, entfernen, Anrede umstellen) → "Ausgewählte senden".
 */
export function BatchPanel() {
  const [s, setS] = useState<State | null>(null);
  const [n, setN] = useState("5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/tutor24/batch", { cache: "no-store" });
    if (r.ok) setS(await r.json());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!s?.laeuft && s?.batch?.zustand !== "vorbereiten" && s?.batch?.zustand !== "sendet") return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [s, load]);

  const post = async (body: object) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/tutor24/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) setError(j.error ?? "Fehler");
      else setS(j);
      if (j.gestartet) setTimeout(load, 2500);
    } finally {
      setBusy(false);
    }
  };

  if (!s) return <div className="h-40 animate-pulse rounded-2xl border border-gray-200 bg-white" />;
  if (s.online) return <p className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600">Den Batch startest du auf dem Laptop: <b>localhost:3000/kurse</b> → Reiter Batch.</p>;

  const b = s.batch;
  const running = s.laeuft || b?.zustand === "vorbereiten" || b?.zustand === "sendet";
  const chosen = b?.items.filter((i) => i.ausgewaehlt && !i.problem && !i.ergebnis) ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-gray-900">Batch von Hand</h2>
        <p className="mt-1 text-sm text-gray-500">
          Vorbereiten liest neue Inserate und erstellt die Nachrichten, sendet aber nichts. Gesendet wird erst mit „Ausgewählte senden“ (8–15 s zwischen den Inseraten).
          Vorbereiten und Senden zählen als ein Lauf: Senden innert 60 min nach dem Vorbereiten.
        </p>
        {s.pause && <p className="mt-2 text-sm font-semibold text-red-700">{s.pause}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input type="number" min={1} max={20} value={n} onChange={(e) => setN(e.target.value)} className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-sm" aria-label="Anzahl" />
          <button className={`${btn} bg-[#4A7FC1] text-white`} disabled={busy || running || !!s.vorbereitenGesperrt} onClick={() => post({ action: "prepare", anzahl: Number(n) })}>
            Batch vorbereiten
          </button>
          <button
            className={`${btn} bg-green-600 text-white`}
            disabled={busy || running || !!s.sendenGesperrt}
            onClick={() => post({ action: "send" })}
          >
            Ausgewählte senden ({chosen.length})
          </button>
          {running && <span className="text-sm text-gray-600">{b?.zustand === "sendet" ? "Sendet …" : "Läuft …"}</span>}
        </div>
        {!running && s.vorbereitenGesperrt && <p className="mt-2 text-xs text-gray-500">Vorbereiten: {s.vorbereitenGesperrt}</p>}
        {!running && b?.zustand === "bereit" && s.sendenGesperrt && <p className="mt-1 text-xs text-gray-500">Senden: {s.sendenGesperrt}</p>}
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        {b?.fehler && <p className="mt-2 text-sm text-red-700">⚠ {b.fehler}</p>}
        {b && b.log.length > 0 && (
          <details className="mt-2 text-xs text-gray-600">
            <summary className="cursor-pointer text-[#4A7FC1]">Protokoll</summary>
            <div className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-900 p-2 font-mono text-[11px] leading-5 text-green-400">{b.log.join("\n")}</div>
          </details>
        )}
      </div>

      {!!s.markiert?.length && (
        <div className="rounded-2xl border border-amber-300 bg-white p-5">
          <h2 className="text-lg font-semibold text-gray-900">Von der Automatik markiert ({s.markiert.length})</h2>
          <p className="mt-1 text-sm text-gray-500">Nicht angeschrieben. Anschreiben geht über den Batch (das Inserat erscheint dort mit Hinweis), „Erledigt“ blendet es hier aus.</p>
          <ul className="mt-3 space-y-2">
            {s.markiert.map((m) => (
              <li key={m.id} className="flex flex-wrap items-start justify-between gap-2 border-t border-gray-100 pt-2 text-sm">
                <span>
                  <a href={m.link} target="_blank" rel="noreferrer" className="font-semibold text-[#4A7FC1] underline">{m.titel}</a>
                  <span className="block text-xs text-amber-700">⚠ {m.grund} · {new Date(m.am).toLocaleDateString("de-CH")}</span>
                </span>
                <button className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-600" disabled={busy} onClick={() => post({ action: "markiert-erledigt", id: m.id })}>
                  Erledigt
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {b?.items.map((it) => <Item key={it.id} it={it} locked={busy || running || b.zustand !== "bereit"} post={post} />)}
      {b && !running && b.items.length === 0 && <p className="text-sm text-gray-500">Keine neuen Inserate gefunden.</p>}
    </div>
  );
}

function Item({ it, locked, post }: { it: BatchItem; locked: boolean; post: (b: object) => Promise<void> }) {
  const fixed = locked || !!it.ergebnis;
  return (
    <div className={`rounded-2xl border bg-white p-5 ${it.problem ? "border-red-300" : it.ausgewaehlt ? "border-[#4A7FC1]" : "border-gray-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={it.ausgewaehlt} disabled={fixed || !!it.problem} onChange={(e) => post({ action: "select", id: it.id, ausgewaehlt: e.target.checked })} />
          <span>
            <span className="font-semibold text-gray-900">{it.titel}</span>
            <span className="block text-xs text-gray-500">
              {it.art === "erst" ? "Erst-Nachricht" : "Nachfassen"} · Stufe: {it.stufe || "–"} · Ort: {it.ort || "–"} · {SPRACHE[it.sprache]} · {it.block}
              {it.art === "erst" && ` · Satz: ${SATZ[it.satz] ?? it.satz}`} ·{" "}
              <a href={it.link} target="_blank" rel="noreferrer" className="text-[#4A7FC1] underline">
                {it.art === "erst" ? "Inserat" : "Chat"}
              </a>
            </span>
          </span>
        </label>
        <div className="flex items-center gap-2">
          {it.art === "erst" && it.sprache === "de" ? (
            <select className="rounded-lg border border-gray-300 px-2 py-1 text-xs" value={it.anrede} disabled={fixed} onChange={(e) => post({ action: "anrede", id: it.id, anrede: e.target.value })}>
              {Object.entries(ANREDE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          ) : it.art === "nachfassen" ? (
            <select className="rounded-lg border border-gray-300 px-2 py-1 text-xs" value={it.anrede === "du" ? "du" : "unklar"} disabled={fixed} onChange={(e) => post({ action: "anrede", id: it.id, anrede: e.target.value })}>
              <option value="du">du</option>
              <option value="unklar">Sie</option>
            </select>
          ) : (
            <span className="text-xs text-gray-500">Anrede: you/vous</span>
          )}
          {!fixed && (
            <button className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-600 hover:border-red-400 hover:text-red-700" onClick={() => post({ action: "remove", id: it.id })}>
              Entfernen
            </button>
          )}
        </div>
      </div>
      {it.problem && <p className="mt-2 text-sm font-semibold text-red-700">Nicht sendbar: {it.problem}</p>}
      {it.agentur && <p className="mt-2 text-sm font-semibold text-amber-700">⚠ Möglicherweise Agentur: {it.agentur}</p>}
      {it.nebenfach && <p className="mt-2 text-sm font-semibold text-amber-700">⚠ Mathe nur Nebenfach: {it.nebenfach}</p>}
      {it.ergebnis && (
        <p className={`mt-2 text-sm font-semibold ${it.ergebnis === "gesendet" ? "text-green-700" : it.ergebnis === "fehler" ? "text-red-700" : "text-amber-700"}`}>
          {it.ergebnis === "gesendet" ? "✓ Gesendet" : it.ergebnis === "fehler" ? `Fehler: ${it.meldung}` : `Übersprungen: ${it.meldung}`}
        </p>
      )}
      <div className="mt-3 whitespace-pre-wrap rounded-xl bg-gray-50 p-4 text-sm leading-6 text-gray-800">{it.text}</div>
    </div>
  );
}
