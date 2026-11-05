"use client";

import type { AutoMode, AutoState, PassLog } from "@/lib/tutor24-autopilot";
import type { FollowupSettings } from "@/lib/tutor24-followup";

export type AutopilotInfo = Omit<AutoState, "telegramOffset"> & { durchgaenge: PassLog[] };

const fmt = (iso: string) => new Date(iso).toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" });
const inputClass = "w-16 rounded-lg border border-gray-200 px-2 py-1 text-sm disabled:bg-gray-50";

/**
 * Automatik (scripts/autopilot.mts, 9/13/18 Uhr): Notbremse, Modus, Tageslimits, Protokoll.
 * Modus wird sofort gespeichert (eigene Datei); Limits und X gehoeren zu den Einstellungen ("Einstellungen speichern").
 */
export function AutopilotPanel({
  info,
  settings,
  onSettings,
  saveButton,
  onMode,
}: {
  info: AutopilotInfo;
  settings: FollowupSettings;
  onSettings: (patch: Partial<FollowupSettings>) => void;
  saveButton: React.ReactNode;
  onMode: (m: AutoMode) => void;
}) {
  const on = info.modus !== "aus";
  const num = (key: "autoErstLimit" | "autoNachfassLimit" | "nachfassNachTagen", label: string, min: number, max?: number) => (
    <label className="flex items-center gap-1.5 text-sm text-gray-600">
      {label}
      <input type="number" min={min} max={max} value={settings[key]} onChange={(e) => onSettings({ [key]: Number(e.target.value) })} className={inputClass} />
    </label>
  );
  return (
    <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold text-gray-900">Automatik</h2>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            info.modus === "an" ? "bg-green-100 text-green-800" : info.modus === "probe" ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600"
          }`}
        >
          {info.modus === "an" ? "AN — sendet" : info.modus === "probe" ? "PROBE — sendet nichts" : "AUS"}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            onClick={() => onMode("aus")}
            disabled={!on}
            className="rounded-xl bg-red-600 px-6 py-2.5 text-base font-bold text-white shadow hover:bg-red-700 disabled:opacity-40"
          >
            Automatik aus
          </button>
          {info.modus !== "probe" && (
            <button onClick={() => onMode("probe")} className="rounded-xl border border-amber-500 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50">
              Probe (nichts senden)
            </button>
          )}
          {info.modus !== "an" && (
            <button onClick={() => onMode("an")} className="rounded-xl border border-green-600 px-4 py-2 text-sm font-semibold text-green-700 hover:bg-green-50">
              Einschalten (sendet)
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-sm text-gray-500">
        Läuft über die Windows-Aufgabenplanung um 9, 13 und 18 Uhr: neue Inserate → Erst-Nachrichten → Antworten prüfen → Nachfassen. Gesendet wird nur
        8–20 Uhr und nur im Modus AN. Automatisch nachgefasst werden nur sichere Fälle mit passendem offenem Kurs; Antworten schreibst immer du. Notbremse auch per Telegram: <b>/stop</b>.
      </p>
      {info.gestoppt && (
        <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">
          Gestoppt {fmt(info.gestoppt.am)}: {info.gestoppt.grund}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {num("autoErstLimit", "Erst-Nachrichten pro Tag", 0)}
        {num("autoNachfassLimit", "Nachfassen pro Tag", 0, 25)}
        {num("nachfassNachTagen", "Nachfassen frühestens nach Tagen", 3)}
        {saveButton}
      </div>
      <details className="mt-3 text-xs" open={info.durchgaenge.length > 0}>
        <summary className="cursor-pointer font-semibold text-gray-600">Letzte Durchgänge ({info.durchgaenge.length})</summary>
        {info.durchgaenge.length === 0 ? (
          <p className="mt-1 text-gray-400">Noch kein Durchgang.</p>
        ) : (
          <table className="mt-1 w-full">
            <thead className="text-left text-gray-400">
              <tr>
                <th className="py-1 pr-2 font-medium">Start</th>
                <th className="py-1 pr-2 font-medium">Modus</th>
                <th className="py-1 pr-2 font-medium">Erst-Nachricht</th>
                <th className="py-1 pr-2 font-medium">Nachfassen</th>
                <th className="py-1 pr-2 font-medium">Antworten</th>
                <th className="py-1 font-medium">Fehler / Stopp</th>
              </tr>
            </thead>
            <tbody className="text-gray-700">
              {info.durchgaenge.map((p) => {
                const c = (x: PassLog["erst"]) =>
                  `${p.modus === "probe" ? `${x.wuerde} würden` : `${x.gesendet} gesendet`} · ${x.uebersprungen} übersprungen${x.pruefungFehler ? ` · ${x.pruefungFehler} Prüfung ✖` : ""}`;
                return (
                  <tr key={p.start} className="border-t border-gray-100 align-top">
                    <td className="py-1 pr-2 whitespace-nowrap">{fmt(p.start)}</td>
                    <td className="py-1 pr-2">{p.modus}</td>
                    <td className="py-1 pr-2">{c(p.erst)}</td>
                    <td className="py-1 pr-2">{c(p.nachfassen)}</td>
                    <td className="py-1 pr-2">{p.antworten}</td>
                    <td className="py-1 text-red-700">
                      {p.stopp && <b>Stopp: {p.stopp} </b>}
                      {p.fehler.join(" | ")}
                      {p.probe && p.probe.length > 0 && (
                        <details className="text-gray-600">
                          <summary className="cursor-pointer">würde senden ({p.probe.length})</summary>
                          {p.probe.map((x) => <div key={x}>{x}</div>)}
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </details>
    </div>
  );
}
