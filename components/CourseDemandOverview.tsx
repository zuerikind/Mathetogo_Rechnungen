"use client";

import { useCallback, useEffect, useState } from "react";
import { GROUP_LABEL, isCourseGroup } from "@/lib/tutor24-followup";

type Group = {
  kursgruppe: string;
  fach: string;
  hoch: number;
  mittel: number;
  perWeek: number[];
  gruende: Record<string, number>;
  beispiele: Array<{ auszug: string; url: string; sicherheit: string }>;
};

const GRUND: Record<string, string> = {
  kein_kurs: "kein Kurs",
  anmeldeschluss_vorbei: "Anmeldeschluss vorbei",
  ausgebucht: "ausgebucht",
  nur_vor_ort: "will vor Ort",
  kurs_vorhanden_unsicher: "Kurs da, Stufe unsicher",
};
const FILTERS = [["offen", "Offen"], ["kurs_angelegt", "Kurs angelegt"], ["ignoriert", "Ignoriert"], ["alle", "Alle"]] as const;
const kw = (iso: string) => {
  const d = new Date(iso);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + 3 - ((d.getDay() + 6) % 7)));
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
};

/** Nachfrage ohne passenden Kurs (Erst-Nachricht tutor24): wo sich ein neuer Kurs lohnt. */
export function CourseDemandOverview() {
  const [status, setStatus] = useState<string>("offen");
  const [data, setData] = useState<{ weeks: string[]; groups: Group[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/course-demand?status=${status}`);
    if (!res.ok) return setError("Nachfrage konnte nicht geladen werden.");
    setError(null);
    setData(await res.json());
  }, [status]);
  useEffect(() => void load(), [load]);

  const setRowStatus = async (g: Group, next: string) => {
    setBusy(`${g.kursgruppe}|${g.fach}`);
    try {
      const res = await fetch("/api/course-demand", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kursgruppe: g.kursgruppe, fach: g.fach, status: next }),
      });
      if (!res.ok) setError("Status konnte nicht gesetzt werden.");
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h2 className="font-semibold text-gray-900">Nachfrage ohne Kurs</h2>
        <div className="ml-auto flex gap-1">
          {FILTERS.map(([v, label]) => (
            <button
              key={v}
              onClick={() => setStatus(v)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${status === v ? "bg-[#4A7FC1] text-white" : "border border-gray-200 text-gray-600 hover:border-[#4A7FC1]"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-3 text-sm text-gray-500">
        Inserate, bei denen die Erst-Nachricht die Stufe erkannt, aber keinen Kurs angeboten hat. „sicher“ = Stufe und Jahr stehen im Inserat, „unsicher“ = abgeleitet.
      </p>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {!data ? (
        <div className="h-24 animate-pulse rounded-xl bg-gray-50" />
      ) : data.groups.length === 0 ? (
        <p className="text-sm text-gray-500">Keine Einträge.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-gray-400">
              <tr>
                <th className="py-2 pr-3">Kursgruppe · Fach</th>
                <th className="px-2">sicher</th>
                <th className="px-2">unsicher</th>
                {data.weeks.map((w) => (
                  <th key={w} className="px-1 text-center">KW {kw(w)}</th>
                ))}
                <th className="px-2">Gründe</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.groups.map((g) => {
                const key = `${g.kursgruppe}|${g.fach}`;
                return (
                  <tr key={key} className="border-t border-gray-100 align-top">
                    <td className="py-2 pr-3">
                      <details>
                        <summary className="cursor-pointer font-medium text-gray-900">
                          {isCourseGroup(g.kursgruppe) ? GROUP_LABEL[g.kursgruppe] : g.kursgruppe} · {g.fach}
                        </summary>
                        <ul className="mt-1 space-y-1 text-xs text-gray-600">
                          {g.beispiele.map((b) => (
                            <li key={b.url}>
                              <a href={b.url} target="_blank" rel="noreferrer" className="text-[#4A7FC1] hover:underline">Inserat</a>
                              {b.sicherheit !== "hoch" && " (unsicher)"}: {b.auszug || "—"}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </td>
                    <td className="px-2 font-semibold">{g.hoch}</td>
                    <td className="px-2 text-gray-500">{g.mittel}</td>
                    {g.perWeek.map((n, i) => (
                      <td key={i} className={`px-1 text-center ${n ? "text-gray-900" : "text-gray-300"}`}>{n}</td>
                    ))}
                    <td className="px-2 text-xs text-gray-500">
                      {Object.entries(g.gruende).map(([k, n]) => `${GRUND[k] ?? k} ${n}`).join(", ")}
                    </td>
                    <td className="whitespace-nowrap py-2 pl-2 text-right">
                      {status === "offen" ? (
                        <>
                          <button disabled={busy === key} onClick={() => void setRowStatus(g, "kurs_angelegt")} className="mr-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:border-green-300 hover:text-green-700 disabled:opacity-40">
                            Kurs angelegt
                          </button>
                          <button disabled={busy === key} onClick={() => void setRowStatus(g, "ignoriert")} className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:border-gray-400 disabled:opacity-40">
                            Ignorieren
                          </button>
                        </>
                      ) : (
                        <button disabled={busy === key} onClick={() => void setRowStatus(g, "offen")} className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:border-[#4A7FC1] disabled:opacity-40">
                          Wieder öffnen
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
    </div>
  );
}
