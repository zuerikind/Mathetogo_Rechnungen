"use client";

import { useEffect, useState } from "react";
import type { AutoMode, AutoState, PassView } from "@/lib/tutor24-autopilot";
import type { HintReply } from "@/lib/tutor24-leads";

/**
 * Automatik auf /kurse (scripts/autopilot.mts, 9 und 17 Uhr): Uebersicht, Modus, Erst-Nachrichten jetzt, Protokoll.
 * Nur Anzeige — die Regeln stehen in lib/tutor24-autopilot.ts. Der Modus wird sofort gespeichert (eigene Datei).
 */
export type AutopilotInfo = Omit<AutoState, "telegramOffset"> & { durchgaenge: PassView[] };
export type OverviewInfo = {
  laptop: { at: string; online: boolean } | null;
  heute: { erst: number; erstLimit: number; nachfassen: number; nachfassenLimit: number; antworten: number; erstWuerde: number; nachfassenWuerde: number };
  naechster: string;
  pauseBis: string | null;
  abstandBis?: string | null;
};
/** Was Aufmerksamkeit braucht, vom Aufrufer berechnet (Kurse, neue Antworten) */
export type Attention = { tone: "info" | "warn" | "bad"; text: React.ReactNode; action?: { label: string; href?: string; onClick?: () => void } };

export const card = "rounded-2xl border border-gray-200 bg-white p-5";
const fmt = (iso: string) => new Date(iso).toLocaleString("de-CH", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
const inputClass = "w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-sm";

export const MODE_LABEL: Record<AutoMode, { text: string; pill: string }> = {
  aus: { text: "Aus · sendet nichts", pill: "bg-red-50 text-red-700" },
  probe: { text: "Probe · sendet nichts", pill: "bg-amber-50 text-amber-800" },
  an: { text: "Ein · sendet 8–20 Uhr", pill: "bg-green-50 text-green-700" },
};
export function ModePill({ modus }: { modus: AutoMode }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${MODE_LABEL[modus].pill}`}><Dot tone={modus === "an" ? "ok" : modus === "probe" ? "warn" : "bad"} />{MODE_LABEL[modus].text}</span>;
}
function Dot({ tone }: { tone: "ok" | "warn" | "bad" | "info" }) {
  const c = { ok: "bg-green-600", warn: "bg-amber-500", bad: "bg-red-600", info: "bg-[#4A7FC1]" }[tone];
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${c}`} />;
}

/** Aus / Probe / Ein — "Ein" erst nach Bestaetigung (sendet ab dem naechsten Durchgang echt). */
export function ModeSwitch({ modus, onMode }: { modus: AutoMode; onMode: (m: AutoMode) => void }) {
  const [ask, setAsk] = useState(false);
  const btn = (m: AutoMode, label: string, on: string) => (
    <button
      key={m}
      onClick={() => (m === "an" && modus !== "an" ? setAsk(true) : (setAsk(false), onMode(m)))}
      aria-pressed={modus === m}
      className={`px-5 py-2.5 text-sm font-semibold first:rounded-l-xl last:rounded-r-xl ${modus === m ? on : "bg-white text-gray-600 hover:bg-gray-50"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-2">
      <div className="inline-flex divide-x divide-gray-300 rounded-xl border border-gray-300" role="group" aria-label="Modus der Automatik">
        {btn("aus", "Aus", "bg-red-50 text-red-700")}
        {btn("probe", "Probe", "bg-amber-50 text-amber-800")}
        {btn("an", "Ein", "bg-green-50 text-green-700")}
      </div>
      {ask && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p><b>Wirklich einschalten?</b> Ab dem nächsten Durchgang werden echte Nachrichten gesendet (8–20 Uhr, Tageslimits gelten).</p>
          <div className="mt-2 flex gap-2">
            <button onClick={() => { setAsk(false); onMode("an"); }} className="rounded-lg bg-green-600 px-4 py-1.5 font-semibold text-white hover:bg-green-700">Ja, einschalten</button>
            <button onClick={() => setAsk(false)} className="rounded-lg border border-gray-300 bg-white px-4 py-1.5 font-semibold text-gray-700">Abbrechen</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, limit, note }: { label: string; value: number; limit?: number; note?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold tabular-nums text-gray-900">
        {value}
        {limit !== undefined && <span className="text-base font-semibold text-gray-400"> / {limit}</span>}
      </p>
      {limit !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full bg-[#4A7FC1]" style={{ width: `${Math.min(100, limit ? (value / limit) * 100 : 0)}%` }} />
        </div>
      )}
      {note && <p className="mt-1.5 text-xs text-gray-500">{note}</p>}
    </div>
  );
}

/** Reiter "Übersicht": Läuft alles? Heute. Braucht deine Aufmerksamkeit. Modus und Erst-Nachrichten jetzt. */
export function Overview({ info, ov, attention, onMode }: { info: AutopilotInfo; ov: OverviewInfo; attention: Attention[]; onMode: (m: AutoMode) => void }) {
  const last = info.durchgaenge[0];
  const probe = info.modus === "probe";
  const [hints, setHints] = useState<HintReply[]>([]);
  useEffect(() => {
    fetch("/api/tutor24/leads")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { hinweisAntworten?: HintReply[] } | null) => setHints(d?.hinweisAntworten ?? []))
      .catch(() => {});
  }, []);
  const items: Attention[] = [
    ...hints.map((h): Attention => ({
      tone: "info",
      text: <><b>Antwort auf den Kurs-Hinweis</b> von {h.name || "ohne Namen"} ({h.stufe || "Stufe unbekannt"}, {h.anrede}). Bekommt nichts Automatisches mehr, bitte selbst antworten.</>,
      action: h.konversationUrl ? { label: "Chat öffnen", href: h.konversationUrl } : undefined,
    })),
    ...attention,
  ];
  return (
    <div className="space-y-5">
      <div className={`${card} grid gap-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-gray-900">Läuft alles?</h2>
            <ModePill modus={info.modus} />
          </div>
          <dl className="mt-3 grid gap-2 text-sm">
            <Fact label="Laptop">
              {ov.laptop ? (
                ov.laptop.online ? (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-green-700"><Dot tone="ok" />online</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-red-700"><Dot tone="bad" />offline seit {fmt(ov.laptop.at)}</span>
                )
              ) : (
                <span className="text-gray-500">kein Lebenszeichen bekannt</span>
              )}
            </Fact>
            <Fact label="Letzter Durchgang">{last ? <>{fmt(last.start)} · {last.fehlerKurz ? `${last.satz.split(" · ")[0]}: ${last.fehlerKurz}` : last.satz}</> : "noch keiner"}</Fact>
            <Fact label="Nächster Durchgang">
              {info.modus === "aus" ? "keiner, die Automatik ist aus" : fmt(ov.naechster)}
              {ov.pauseBis && <span className="text-red-700"> · 429-Pause bis {fmt(ov.pauseBis)}</span>}
              {ov.abstandBis && !ov.pauseBis && <span className="text-amber-700"> · Nächster Lauf frühestens um {new Date(ov.abstandBis).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })} (2 h Abstand)</span>}
            </Fact>
          </dl>
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold text-gray-900">Automatik</h3>
          <ModeSwitch modus={info.modus} onMode={onMode} />
          <p className="text-xs text-gray-500">Läuft zu den eingestellten Zeiten (Einstellungen → Durchgänge um): neue Inserate → Erst-Nachrichten → Antworten prüfen → Nachfassen. Antworten schreibst immer du. Notbremse auch per Telegram: /stop</p>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Heute</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi label="Erst-Nachrichten" value={ov.heute.erst} limit={ov.heute.erstLimit} note={probe ? `Probe: ${ov.heute.erstWuerde} würden gesendet` : undefined} />
          <Kpi label="Nachfassen" value={ov.heute.nachfassen} limit={ov.heute.nachfassenLimit} note={probe ? `Probe: ${ov.heute.nachfassenWuerde} würden gesendet` : undefined} />
          <Kpi label="Neue Antworten" value={ov.heute.antworten} note="aus den heutigen Durchgängen" />
        </div>
      </div>

      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Braucht deine Aufmerksamkeit</h2>
          {items.length > 0 && <span className="text-sm text-gray-500">{items.length} {items.length === 1 ? "Punkt" : "Punkte"}</span>}
        </div>
        {items.length === 0 ? (
          <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-green-50 px-3 py-1 text-sm font-semibold text-green-700"><Dot tone="ok" />Alles in Ordnung</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100">
            {items.map((a, i) => (
              <li key={i} className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-2 py-2.5 text-sm sm:grid-cols-[1rem_minmax(0,1fr)_auto]">
                <span className="mt-1.5"><Dot tone={a.tone === "bad" ? "bad" : a.tone === "warn" ? "warn" : "info"} /></span>
                <div className="text-gray-800">{a.text}</div>
                {a.action &&
                  (a.action.href ? (
                    <a href={a.action.href} target="_blank" rel="noreferrer" className="col-start-2 text-sm font-semibold text-[#4A7FC1] hover:underline sm:col-start-3">{a.action.label}</a>
                  ) : (
                    <button onClick={a.action.onClick} className="col-start-2 justify-self-start text-sm font-semibold text-[#4A7FC1] hover:underline sm:col-start-3">{a.action.label}</button>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-900">Erst-Nachrichten jetzt senden</h2>
        <p className="mt-1 text-sm text-gray-500">Schreibt neue Inserate sofort an statt erst beim nächsten geplanten Durchgang. Modus, Tageslimit, 8–20 Uhr und 429-Pause gelten. Geht auch online, solange der Laptop an ist.</p>
        <ErstNow />
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className="min-w-0 text-gray-900">{children}</dd>
    </div>
  );
}

/** Reiter "Protokoll": alle Durchgaenge, Ergebnis in einem Satz, Technisches eingeklappt, Behobenes grau. */
export function PassTable({ passes }: { passes: PassView[] }) {
  const [hideFixed, setHideFixed] = useState(false);
  const shown = passes.filter((p) => !(hideFixed && p.behoben));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">Protokoll</h2>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={hideFixed} onChange={(e) => setHideFixed(e.target.checked)} />
          Behobene ausblenden
        </label>
      </div>
      <div className={`${card} overflow-x-auto p-0`}>
        {shown.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">Noch kein Durchgang.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr className="border-b border-gray-200">
                <th className="px-4 py-2 font-semibold">Zeit</th>
                <th className="px-4 py-2 font-semibold">Modus</th>
                <th className="px-4 py-2 font-semibold">Ergebnis</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.start} className={`border-b border-gray-100 align-top ${p.behoben ? "text-gray-400" : "text-gray-800"}`}>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{fmt(p.start)}</td>
                  <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${MODE_LABEL[p.modus].pill}`}>{p.modus === "an" ? "Ein" : p.modus === "probe" ? "Probe" : "Aus"}</span></td>
                  <td className="min-w-[16rem] px-4 py-2.5">
                    <p>{p.satz}</p>
                    {p.fehlerKurz && (
                      <p className={p.behoben ? "" : "text-red-700"}>
                        {p.fehlerKurz}
                        {p.behoben && <span className="ml-2 rounded border border-gray-200 px-1.5 text-xs">behoben {p.behoben}</span>}
                      </p>
                    )}
                    {(p.details || (p.probe && p.probe.length > 0)) && (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-[#4A7FC1]">{p.details ? "Technische Details" : `Würde senden (${p.probe?.length})`}</summary>
                        {p.probe && p.probe.length > 0 && <ul className="mt-1 space-y-0.5 text-gray-600">{p.probe.map((x) => <li key={x}>{x}</li>)}</ul>}
                        {p.details && <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-2 font-mono text-[11px] text-gray-600">{p.details}</pre>}
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** Was der Laptop aus dem Befehl gemacht hat (Rueckgabe von lib/tutor24-bot.ts, /erst) */
const ERST_RESULT: Record<string, string> = {
  "erst: gestartet": "Gestartet. Das Ergebnis kommt per Telegram.",
  "erst: aus": "Nicht gestartet: Automatik ist aus.",
  "erst: 429-Pause": "Nicht gestartet: 429-Pause läuft.",
  "erst: ausserhalb 8–20 Uhr": "Nicht gestartet: ausserhalb 8–20 Uhr (Modus Ein).",
  "erst: belegt": "Nicht gestartet: es läuft schon ein Lauf.",
  "erst: ungültig": "Nicht gestartet: ungültige Anzahl.",
  "ignoriert: zu alt": "Nicht gestartet: der Laptop hat den Befehl zu spät abgeholt.",
};

/**
 * Knopf "Erst-Nachrichten jetzt senden": legt /erst N in die Befehlstabelle (app/api/tutor24/erst), der Laptop holt ihn ab.
 * Modus, Tageslimit, 8–20 Uhr, 429-Pause und "nur ein Lauf" prueft der Laptop.
 */
export function ErstNow() {
  const [anzahl, setAnzahl] = useState("5");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/tutor24/erst", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anzahl: anzahl.trim() === "" ? null : Number(anzahl) }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; text?: string; error?: string };
      setMsg(data.text ?? data.error ?? "Fehler");
      if (!data.ok || !data.id) return;
      // Der Laptop holt Befehle alle paar Sekunden ab: bis zu 30 s auf seine Antwort warten.
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const s = (await (await fetch(`/api/tutor24/erst?id=${encodeURIComponent(data.id)}`)).json().catch(() => ({}))) as { abgeholt?: boolean; ergebnis?: string };
        if (s.ergebnis) {
          setMsg(ERST_RESULT[s.ergebnis] ?? s.ergebnis);
          return;
        }
      }
      setMsg("Der Laptop hat den Befehl noch nicht abgeholt. Das Ergebnis kommt per Telegram, falls er ihn noch übernimmt.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm text-gray-600" htmlFor="erst-anzahl">
        Anzahl
        <input id="erst-anzahl" type="number" min={1} max={20} value={anzahl} onChange={(e) => setAnzahl(e.target.value)} placeholder="Tageslimit" className={inputClass} title="1 bis 20; leer = bis zum Tageslimit" />
      </label>
      <button onClick={start} disabled={busy} className="rounded-xl bg-[#4A7FC1] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3a6fb1] disabled:opacity-50">
        {busy ? "Läuft …" : "Erst-Nachrichten jetzt senden"}
      </button>
      {msg && <p className="w-full text-sm text-gray-700">{msg}</p>}
    </div>
  );
}
