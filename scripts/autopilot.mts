/**
 * Ein Durchgang der tutor24-Automatik (Windows-Aufgabenplanung 9/13/18 Uhr, scripts/autopilot.cmd):
 *   neue Inserate → Erst-Nachrichten → Kandidaten suchen → Antworten prüfen → fälliges Nachfassen.
 *
 *   npx tsx scripts/autopilot.mts                  Modus aus tutor24-followup/autopilot.json (aus/probe/an)
 *   npx tsx scripts/autopilot.mts --probe          Probe erzwingen (liest alles, sendet NICHTS)
 *   npx tsx scripts/autopilot.mts --probe --max 3  begrenzter Probelauf (Telegram /run): je höchstens 3, Listen kurz
 *
 * Gesendet wird nur im Modus "an" und nur 8–20 Uhr; Tageslimits zaehlen aus der Datenbank, ein
 * nachgeholter Durchgang sendet also nie doppelt. Nach einem 429 startet 12 h lang kein Durchgang.
 * Regeln und Meldungen: lib/tutor24-autopilot.ts.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const {
  RATE_LIMIT_TEXT, activePause, appendPassLog, daySummary, emptyCounts, errorKey, firstName, fmtZurich, inSendWindow, is429, isBusy,
  loadAutopilot, localDay, nextScheduled, notify, passResult, passSummary, rateLimitUntil, readPassLog, shortError, stopReason, updateAutopilot,
} = await import("../lib/tutor24-autopilot");
const { loadCourses, loadLeadInfo, loadLog, loadSettings, sentToday } = await import("../lib/tutor24-followup-store");
const { runFollowup } = await import("../lib/tutor24-followup-runner");
const { runTutor24Messaging } = await import("../lib/tutor24");
const { followupJobState } = await import("../lib/automation-state");
const { AUTOPILOT_LOCK_PATH, acquireTutor24Lock } = await import("../lib/tutor24-lock");

const log = (s: string) => console.log(`${new Date().toLocaleString("de-CH")} ${s}`);
const forcedProbe = process.argv.includes("--probe");
const maxArg = process.argv.indexOf("--max");
const max = maxArg > -1 ? Number(process.argv[maxArg + 1]) : undefined;
if (max !== undefined && !(Number.isInteger(max) && max >= 1 && max <= 20)) {
  console.error("--max braucht eine ganze Zahl von 1 bis 20");
  process.exit(1);
}

const state = loadAutopilot();
const modus = forcedProbe ? "probe" : state.modus;
if (modus === "aus") {
  log("Automatik ist aus — nichts zu tun.");
  process.exit(0);
}
const pause = activePause(readPassLog(50));
if (pause) {
  log(`${RATE_LIMIT_TEXT} Pause bis ${fmtZurich(pause)} — kein Abruf.`);
  process.exit(0);
}
// Ein Durchgang zur Zeit (Aufgabenplanung und Telegram /run koennen sich ueberschneiden).
try {
  const release = acquireTutor24Lock(forcedProbe ? "Probelauf" : "Automatik-Durchgang", AUTOPILOT_LOCK_PATH);
  process.on("exit", release);
} catch (err) {
  log(`Läuft schon, nicht gestartet: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(0);
}

const dryRun = modus === "probe";
const P = dryRun ? "🧪 PROBE · " : "";
const settings = loadSettings();

const pass = {
  start: new Date().toISOString(), ende: "", modus,
  erst: emptyCounts(), nachfassen: emptyCounts(), antworten: 0, fehler: [] as string[], stopp: null as string | null, probe: [] as string[],
};
/** neue Antworten laut Liste "Gesendet" (runFollowup auto) */
const listReplies: { id: string; name: string; absage: boolean }[] = [];

/** Vor jeder einzelnen Nachricht und direkt vor dem Senden: Zeitfenster und Notbremse (Telegram /stop, /kurse). */
const mayContinue = () => {
  if (forcedProbe) return null; // von Hand / Telegram /run: sendet ohnehin nichts
  if (!inSendWindow()) return "ausserhalb 8–20 Uhr";
  const now = loadAutopilot().modus;
  if (now === "aus" || (!dryRun && now !== "an")) return "Automatik wurde ausgeschaltet";
  return null;
};

const repliedBefore = new Set((await loadLog()).filter((r) => r.geantwortet === "ja").map((r) => r.conversation_id));
let fatal: string | null = null;
let busy = false;

try {
  // 1. Erst-Nachrichten an neue Inserate (begrenzt: nur Mathematik, eine Suchseite)
  const erstLimit = Math.min(max ?? Infinity, Math.max(0, settings.autoErstLimit - (await sentToday(new Date(), "erst"))));
  if (!inSendWindow() && !forcedProbe) log("Ausserhalb 8–20 Uhr: keine Erst-Nachrichten.");
  else if (erstLimit === 0) log(`Tageslimit Erst-Nachrichten (${settings.autoErstLimit}) erreicht.`);
  else {
    log(`Erst-Nachrichten: höchstens ${erstLimit}${dryRun ? " (PROBE, sendet nichts)" : ""} …`);
    const r = await runTutor24Messaging(true, max ? 1 : 10, max ? ["Mathematik"] : ["Mathematik", "Physik"], {
      limit: erstLimit, dryRun, mayContinue, counts: pass.erst, probe: pass.probe, ...(max ? { maxOpen: max * 2 } : {}),
    });
    for (const l of r.log) console.log(`  ${l}`);
    pass.fehler.push(...r.errors);
  }

  // 2.–4. Kandidaten suchen → Antworten prüfen → Nachfassen (eine Anmeldung)
  const nachLimit = Math.min(max ?? Infinity, Math.max(0, settings.autoNachfassLimit - (await sentToday())));
  // Notbremse waehrend der Erst-Nachrichten: Durchgang hier ganz beenden.
  if (!forcedProbe && loadAutopilot().modus === "aus") log("Automatik wurde ausgeschaltet — Durchgang beendet.");
  else {
    log(`Nachfassen: höchstens ${nachLimit}, frühestens ${settings.nachfassNachTagen} Tage nach der Erst-Nachricht …`);
    await runFollowup({
      mode: "auto",
      maxChecks: max ?? 150,
      headless: true,
      onLog: (l) => console.log(`  ${l}`),
      auto: {
        limit: nachLimit, minAgeDays: settings.nachfassNachTagen, dryRun, mayContinue, counts: pass.nachfassen, probe: pass.probe, antworten: listReplies,
        // begrenzt: hoechstens 2 Nachlade-Runden pro Liste, der Rest kommt aus dem Zwischenspeicher
        ...(max ? { maxScrollRounds: 2, maxReplyChecks: max } : {}),
      },
    });
  }
} catch (err) {
  const msg = followupJobState.error ?? (err instanceof Error ? err.message : String(err));
  if (isBusy(msg) || /^Vom Benutzer gestoppt/.test(msg)) {
    busy = true;
    log(`Beendet ohne Fehler: ${msg}`);
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
pass.ende = new Date().toISOString();
const reason = stopReason({ pruefungFehler: pass.erst.pruefungFehler + pass.nachfassen.pruefungFehler, fehler: fatal, letzterFehler: state.letzterFehler });
if (reason) {
  pass.stopp = reason;
  updateAutopilot({ modus: "aus", gestoppt: { grund: reason, am: pass.ende }, letzterFehler: null });
  const until = rateLimitUntil([pass]);
  await notify(
    is429(reason) && until
      ? `${P}⛔ ${RATE_LIMIT_TEXT}\nAutomatik ist AUS. Frühester nächster Lauf: ${fmtZurich(nextScheduled(until))}.\nWieder einschalten mit /enable oder auf /kurse.`
      : `${P}⛔ Automatik gestoppt: ${reason}\nWieder einschalten mit /enable oder auf /kurse.`
  );
} else {
  if (!busy) updateAutopilot({ letzterFehler: fatal ? errorKey(fatal) : null });
  if (fatal) await notify(`${P}⚠ Durchgang abgebrochen: ${fatal}\nKommt derselbe Fehler beim nächsten Mal wieder, stoppt die Automatik.`);
}

appendPassLog(pass);
log(passSummary(pass));

if (dryRun) {
  const list = pass.probe.length ? pass.probe.map((x) => `• ${x}`).join("\n") : "niemand";
  await notify(
    `${P}Lauf ${new Date(pass.start).toLocaleTimeString("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" })} fertig\nErgebnis: ${passResult(pass)}\nWürde senden:\n${list}`.slice(0, 4000)
  );
}

// Abend-Zusammenfassung: einmal pro Tag, ab dem 18-Uhr-Durchgang (nicht beim begrenzten Probelauf)
const today = localDay();
if (!max && new Date().getHours() >= 18 && loadAutopilot().zusammenfassungAm !== today) {
  if (await notify(daySummary(today))) updateAutopilot({ zusammenfassungAm: today });
}
process.exit(0);
