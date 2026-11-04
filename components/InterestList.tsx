"use client";

import { useCallback, useEffect, useState } from "react";
import { LEVEL_LABEL, type LevelCategory } from "@/lib/tutor24-followup";
import type { CourseFunnel, InterestGroup, InterestPerson } from "@/lib/tutor24-leads";

type Data = {
  weeks: string[];
  groups: InterestGroup[];
  funnel: CourseFunnel[];
  courses: Array<{ id: string; name: string; active: boolean; gruppe: string; fach: string }>;
};

const cardClass = "rounded-2xl border border-blue-100 bg-white p-5 shadow-sm";
const btn = "rounded-lg border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:border-[#4A7FC1] hover:text-[#4A7FC1] disabled:opacity-50";
/** ISO-Kalenderwoche eines Montags "YYYY-MM-DD": Donnerstag derselben Woche / Woche mit dem 4. Januar. */
const kw = (iso: string) => {
  const thu = new Date(`${iso}T00:00:00Z`);
  thu.setUTCDate(thu.getUTCDate() + 3);
  const jan4 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4));
  jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + 3);
  return `KW ${1 + Math.round((thu.getTime() - jan4.getTime()) / (7 * 86400000))}`;
};
const fmt = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}.${Number(m)}.${y.slice(2)}`;
};

/**
 * Interessentenliste auf /kurse: wer Interesse an Gruppenunterricht hat, aber (noch) keinen offenen Kurs bekam.
 * Ohne meine Freigabe wird niemand aus dieser Liste angeschrieben.
 */
export function InterestList() {
  const [data, setData] = useState<Data | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/tutor24/leads${showIgnored ? "?ignorierte=1" : ""}`);
    if (res.ok) setData((await res.json()) as Data);
  }, [showIgnored]);
  useEffect(() => void load(), [load]);

  const patch = async (ids: string[], body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/tutor24/leads", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, ...body }) });
    if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Speichern fehlgeschlagen.");
    await load();
    setBusy(false);
  };

  if (!data) return <div className={`${cardClass} h-32 animate-pulse`} />;
  const courseName = (id: string | null) => data.courses.find((c) => c.id === id)?.name ?? "";
  const total = data.groups.reduce((n, g) => n + g.sicher + g.unsicher, 0);

  return (
    <div className={cardClass}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold text-gray-800">Interessentenliste</h2>
        <span className="text-xs text-gray-500">{total} Personen ohne offenen Kurs · ohne meine Freigabe wird niemand aus dieser Liste angeschrieben</span>
        <label className="ml-auto flex items-center gap-1 text-xs text-gray-500">
          <input type="checkbox" checked={showIgnored} onChange={(e) => setShowIgnored(e.target.checked)} />
          Ignorierte zeigen
        </label>
      </div>
      {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}

      {data.funnel.length > 0 && (
        <table className="mt-4 w-full text-left text-xs">
          <thead className="text-gray-400">
            <tr>
              <th className="py-1 pr-3 font-medium">Kurs</th>
              <th className="py-1 pr-3 font-medium">angeboten</th>
              <th className="py-1 pr-3 font-medium">geantwortet</th>
              <th className="py-1 pr-3 font-medium">angemeldet</th>
              <th className="py-1 pr-3 font-medium">freie Plätze</th>
              <th className="py-1 font-medium">passende Interessenten (freigegeben)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 text-gray-700">
            {data.funnel.map((f) => (
              <tr key={f.courseId}>
                <td className="py-1 pr-3">
                  {courseName(f.courseId)}
                  {!data.courses.find((c) => c.id === f.courseId)?.active && <span className="text-gray-400"> · pausiert</span>}
                </td>
                <td className="py-1 pr-3">{f.angeboten}</td>
                <td className="py-1 pr-3">{f.geantwortet}</td>
                <td className="py-1 pr-3">{f.angemeldet}</td>
                <td className="py-1 pr-3">{f.frei}</td>
                <td className="py-1">
                  {f.passend} ({f.freigegeben})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <table className="mt-4 w-full text-left text-xs">
        <thead className="text-gray-400">
          <tr>
            <th className="py-1 pr-3 font-medium">Kursgruppe · Fach</th>
            <th className="py-1 pr-3 font-medium">sicher</th>
            <th className="py-1 pr-3 font-medium">unsicher</th>
            {data.weeks.map((w) => (
              <th key={w} className="py-1 pr-2 text-right font-medium">{kw(w)}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 text-gray-700">
          {data.groups.length === 0 && (
            <tr>
              <td colSpan={data.weeks.length + 4} className="py-4 text-center text-gray-400">Niemand in der Liste.</td>
            </tr>
          )}
          {data.groups.map((g) => (
            <Group
              key={g.key}
              g={g}
              open={open === g.key}
              busy={busy}
              colSpan={data.weeks.length + 4}
              courseName={courseName}
              onToggle={() => setOpen(open === g.key ? null : g.key)}
              onPatch={patch}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Group({
  g,
  open,
  busy,
  colSpan,
  courseName,
  onToggle,
  onPatch,
}: {
  g: InterestGroup;
  open: boolean;
  busy: boolean;
  colSpan: number;
  courseName: (id: string | null) => string;
  onToggle: () => void;
  onPatch: (ids: string[], body: Record<string, unknown>) => Promise<void>;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const listIds = g.people.filter((p) => p.status === "offen").map((p) => p.id);
  // Freigabe zaehlt nur fuer Personen aus der Erst-Nachricht; aeltere Kontakte stehen im Nachfassen unter "Bereit".
  const releasable = g.people.filter((p) => p.passtZu && p.quelle === "erstnachricht" && p.freigabeKursId !== p.passtZu && p.status === "offen");
  const togglePick = (id: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  return (
    <>
      <tr>
        <td className="py-1.5 pr-3">
          <button onClick={onToggle} className="font-semibold text-gray-800 hover:text-[#4A7FC1]">
            {open ? "▾" : "▸"} {g.label} · {g.fach}
          </button>
        </td>
        <td className="py-1.5 pr-3">{g.sicher}</td>
        <td className="py-1.5 pr-3 text-gray-500">{g.unsicher}</td>
        {g.perWeek.map((n, i) => (
          <td key={i} className={`py-1.5 pr-2 text-right ${n ? "" : "text-gray-300"}`}>{n}</td>
        ))}
        <td className="py-1.5 text-right">
          {listIds.length > 0 && (
            <button disabled={busy} className={btn} onClick={() => void onPatch(listIds, { status: "ignoriert" })} title="Ganze Liste ignorieren (bleibt im Verlauf)">
              Liste ignorieren
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={colSpan} className="pb-3">
            {releasable.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-blue-50 p-2 text-[11px] text-gray-700">
                Passender Kurs offen: Personen ankreuzen und freigeben — erst dann bekommen sie das Angebot im Nachfassen.
                <button
                  disabled={busy || picked.size === 0}
                  className={btn}
                  onClick={async () => {
                    for (const kurs of Array.from(new Set(releasable.filter((p) => picked.has(p.id)).map((p) => p.passtZu as string))))
                      await onPatch(releasable.filter((p) => picked.has(p.id) && p.passtZu === kurs).map((p) => p.id), { freigabeKursId: kurs });
                    setPicked(new Set());
                  }}
                >
                  {picked.size} markierte freigeben
                </button>
              </div>
            )}
            <table className="w-full text-[11px]">
              <thead className="text-gray-400">
                <tr>
                  <th />
                  <th className="py-1 pr-2 text-left font-medium">Datum</th>
                  <th className="py-1 pr-2 text-left font-medium">Name</th>
                  <th className="py-1 pr-2 text-left font-medium">Stufe · Anlass</th>
                  <th className="py-1 pr-2 text-left font-medium">Ort</th>
                  <th className="py-1 pr-2 text-left font-medium">Anrede</th>
                  <th className="py-1 pr-2 text-left font-medium">sicher</th>
                  <th className="py-1 pr-2 text-left font-medium">Grund</th>
                  <th className="py-1 pr-2 text-left font-medium">Links</th>
                  <th className="py-1 pr-2 text-left font-medium">geantw.</th>
                  <th className="py-1 pr-2 text-left font-medium">Einzel&shy;unterricht</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {g.people.map((p) => (
                  <Person key={p.id} p={p} busy={busy} picked={picked.has(p.id)} canPick={releasable.includes(p)} courseName={courseName} onPick={() => togglePick(p.id)} onPatch={onPatch} />
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function Person({
  p,
  busy,
  picked,
  canPick,
  courseName,
  onPick,
  onPatch,
}: {
  p: InterestPerson;
  busy: boolean;
  picked: boolean;
  canPick: boolean;
  courseName: (id: string | null) => string;
  onPick: () => void;
  onPatch: (ids: string[], body: Record<string, unknown>) => Promise<void>;
}) {
  const ignored = p.status === "ignoriert";
  return (
    <tr className={`align-top ${ignored ? "text-gray-400" : "text-gray-700"}`}>
      <td className="py-1 pr-1">{canPick && <input type="checkbox" checked={picked} onChange={onPick} />}</td>
      <td className="py-1 pr-2 whitespace-nowrap">{fmt(p.datum)}</td>
      <td className="py-1 pr-2">
        {p.name || "—"}
        {p.sprache !== "de" && <span className="text-gray-400"> · {p.sprache}</span>}
      </td>
      <td className="py-1 pr-2">
        {LEVEL_LABEL[p.kategorie as LevelCategory] ?? p.kategorie}
        {p.stufe && <span className="text-gray-400"> ({p.stufe})</span>}
        {p.anlass && p.anlass !== "unbekannt" && <span> · {p.anlass}</span>}
      </td>
      <td className="py-1 pr-2">{p.ort || "—"}</td>
      <td className="py-1 pr-2">{p.anrede}</td>
      <td className="py-1 pr-2">{p.sicher ? "sicher" : <span className="text-amber-700">unsicher</span>}</td>
      <td className="py-1 pr-2">
        {p.grund}
        {p.freigabeKursId && <span className="block text-green-700">freigegeben: {courseName(p.freigabeKursId)}</span>}
        {p.passtZu && p.quelle !== "erstnachricht" && <span className="block text-gray-400">steht im Nachfassen unter „Bereit“</span>}
      </td>
      <td className="py-1 pr-2 whitespace-nowrap">
        {p.inseratUrl && <a href={p.inseratUrl} target="_blank" rel="noreferrer" className="text-[#4A7FC1] underline">Inserat</a>}
        {p.inseratUrl && p.konversationUrl && " · "}
        {p.konversationUrl && <a href={p.konversationUrl} target="_blank" rel="noreferrer" className="text-[#4A7FC1] underline">Chat</a>}
      </td>
      <td className="py-1 pr-2">{p.geantwortet ? "ja" : "—"}</td>
      <td className="py-1 pr-2">
        <input type="checkbox" checked={p.einzelunterricht} disabled={busy} onChange={(e) => void onPatch([p.id], { einzelunterricht: e.target.checked })} title="Nur von Hand: hat bei mir Einzelunterricht" />
      </td>
      <td className="py-1 whitespace-nowrap text-right">
        {p.freigabeKursId && (
          <button disabled={busy} className={`${btn} mr-1`} onClick={() => void onPatch([p.id], { freigabeKursId: null })}>
            Freigabe zurück
          </button>
        )}
        <button disabled={busy} className={btn} onClick={() => void onPatch([p.id], { status: ignored ? "offen" : "ignoriert" })}>
          {ignored ? "wieder aufnehmen" : "ignorieren"}
        </button>
      </td>
    </tr>
  );
}
