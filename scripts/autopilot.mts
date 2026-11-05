/**
 * Ein Durchgang der tutor24-Automatik (Windows-Aufgabenplanung 9/13/18 Uhr, scripts/autopilot.cmd):
 *   neue Inserate → Erst-Nachrichten → Kandidaten suchen → Antworten prüfen → fälliges Nachfassen.
 *
 *   npx tsx scripts/autopilot.mts           Modus aus tutor24-followup/autopilot.json (aus/probe/an)
 *   npx tsx scripts/autopilot.mts --probe   Probe erzwingen (liest alles, sendet NICHTS)
 *
 * Gesendet wird nur im Modus "an" und nur 8–20 Uhr; Tageslimits zaehlen aus der Datenbank, ein
 * nachgeholter Durchgang sendet also nie doppelt. Regeln und Meldungen: lib/tutor24-autopilot.ts.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const {
  appendPassLog, daySummary, emptyCounts, errorKey, shortError, firstName, inSendWindow, isBusy, loadAutopilot, localDay, notify,
  passSummary, stopReason, updateAutopilot,
} = await import("../lib/tutor24-autopilot");
const { loadCourses, loadLeadInfo, loadLog, loadSettings, sentToday } = await import("../lib/tutor24-followup-store");
const { runFollowup } = await import("../lib/tutor24-followup-runner");
const { runTutor24Messaging } = await import("../lib/tutor24");
const { followupJobState } = await import("../lib/automation-state");

const forcedProbe = process.argv.includes("--probe");
const state = loadAutopilot();
const modus = forcedProbe ? "probe" : state.modus;
if (modus === "aus") {
  console.log("Automatik ist aus — nichts zu tun.");
  process.exit(0);
}
const dryRun = modus === "probe";
const P = dryRun ? "🧪 PROBE · " : "";
const settings = loadSettings();
const log = (s: string) => console.log(`${new Date().toLocaleTimeString("de-CH")} ${s}`);

const pass = {
  start: new Date().toISOString(), ende: "", modus,
  erst: emptyCounts(), nachfassen: emptyCounts(), antworten: 0, fehler: [] as string[], stopp: null as string | null, probe: [] as string[],
};
/** neue Antworten laut Liste "Gesendet" (runFollowup auto) */
const listReplies: { id: string; name: string; absage: boolean }[] = [];

/** Vor jeder einzelnen Nachricht: Zeitfenster und Notbremse (Telegram /stop, Schalter auf /kurse). */
const mayContinue = () => {
  if (!inSendWindow()) return "ausserhalb 8–20 Uhr";
  if (forcedProbe) return null; // von Hand: sendet ohnehin nichts
  const now = loadAutopilot().modus;
  if (now === "aus" || (!dryRun && now !== "an")) return "Automatik wurde ausgeschaltet";
  return null;
};

const repliedBefore = new Set((await loadLog()).filter((r) => r.geantwortet === "ja").map((r) => r.conversation_id));
let fatal: string | null = null;
let busy = false;

try {
  // 1. Erst-Nachrichten an neue Inserate
  const erstLimit = Math.max(0, settings.autoErstLimit - (await sentToday(new Date(), "erst")));
  if (!inSendWindow()) log("Ausserhalb 8–20 Uhr: keine Erst-Nachrichten.");
  else if (erstLimit === 0) log(`Tageslimit Erst-Nachrichten (${settings.autoErstLimit}) erreicht.`);
  else {
    log(`Erst-Nachrichten: höchstens ${erstLimit}${dryRun ? " (PROBE, sendet nichts)" : ""} …`);
    const r = await runTutor24Messaging(true, 10, ["Mathematik", "Physik"], { limit: erstLimit, dryRun, mayContinue, counts: pass.erst, probe: pass.probe });
    for (const l of r.log) console.log(`  ${l}`);
    pass.fehler.push(...r.errors);
  }

  // 2.–4. Kandidaten suchen → Antworten prüfen → Nachfassen (eine Anmeldung)
  const nachLimit = Math.max(0, settings.autoNachfassLimit - (await sentToday()));
  // Notbremse waehrend der Erst-Nachrichten: Durchgang hier ganz beenden.
  if (!forcedProbe && loadAutopilot().modus === "aus") log("Automatik wurde ausgeschaltet — Durchgang beendet.");
  else {
    log(`Nachfassen: höchstens ${nachLimit}, frühestens ${settings.nachfassNachTagen} Tage nach der Erst-Nachricht …`);
    await runFollowup({
      mode: "auto",
      maxChecks: 150,
      headless: true,
      onLog: (l) => console.log(`  ${l}`),
      auto: { limit: nachLimit, minAgeDays: settings.nachfassNachTagen, dryRun, mayContinue, counts: pass.nachfassen, probe: pass.probe, antworten: listReplies },
    });
  }
} catch (err) {
  const msg = followupJobState.error ?? (err instanceof Error ? err.message : String(err));
  if (isBusy(msg)) {
    busy = true;
    log(`Übersprungen: ${msg}`);
  } else {
    fatal = shortError(msg);
    pass.fehler.push(fatal);
    console.error(msg);
    log(`✖ ${msg}`);
  }
}

// Antworten: sofort melden (nur Vorname, Kurs, Link). Zwei Quellen: Liste "Gesendet" (alle, auch ohne Kurs)
// und "Antworten prüfen" (Angeschriebene mit Kurs); pro Konversation nur eine Meldung.
const courses = loadCourses();
const logRows = await loadLog();
const leadInfo = await loadLeadInfo();
const kursOf = (id: string) => {
  const kursId = logRows.find((r) => r.conversation_id === id)?.kurs || leadInfo[id]?.erstKursId;
  return courses.find((c) => c.id === kursId)?.name ?? "ohne Kurs";
};
const toNotify = new Map(listReplies.map((r) => [r.id, r]));
for (const r of logRows.filter((r) => r.geantwortet === "ja" && !repliedBefore.has(r.conversation_id)))
  if (!toNotify.has(r.conversation_id)) toNotify.set(r.conversation_id, { id: r.conversation_id, name: r.name, absage: r.markierung === "Absage" });
pass.antworten = toNotify.size;
for (const r of toNotify.values())
  await notify(`${P}💬 ${r.absage ? "Absage" : "Antwort"} von ${firstName(r.name)} · ${kursOf(r.id)}\nhttps://www.tutor24.ch/de/conversations/${r.id}?tab=sent`);

// Stopp-Regeln
const reason = stopReason({ pruefungFehler: pass.erst.pruefungFehler + pass.nachfassen.pruefungFehler, fehler: fatal, letzterFehler: state.letzterFehler });
if (reason) {
  pass.stopp = reason;
  updateAutopilot({ modus: "aus", gestoppt: { grund: reason, am: new Date().toISOString() }, letzterFehler: null });
  await notify(`${P}⛔ Automatik gestoppt: ${reason}\nWieder einschalten auf /kurse.`);
} else {
  if (!busy) updateAutopilot({ letzterFehler: fatal ? errorKey(fatal) : null });
  if (fatal) await notify(`${P}⚠ Durchgang abgebrochen: ${fatal}\nKommt derselbe Fehler beim nächsten Mal wieder, stoppt die Automatik.`);
}

pass.ende = new Date().toISOString();
appendPassLog(pass);
log(passSummary(pass));

if (dryRun) {
  const list = pass.probe.length ? pass.probe.map((x) => `• ${x}`).join("\n") : "niemand";
  await notify(`${P}Durchgang ${new Date(pass.start).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })} — würde senden:\n${list}`.slice(0, 4000));
}

// Abend-Zusammenfassung: einmal pro Tag, ab dem 18-Uhr-Durchgang
const today = localDay();
if (new Date().getHours() >= 18 && loadAutopilot().zusammenfassungAm !== today) {
  if (await notify(daySummary(today))) updateAutopilot({ zusammenfassungAm: today });
}
process.exit(0);
