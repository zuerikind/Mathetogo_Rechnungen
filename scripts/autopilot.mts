/**
 * Ein Durchgang der tutor24-Automatik (Windows-Aufgabenplanung 9 und 17 Uhr, scripts/autopilot.cmd):
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
  RATE_LIMIT_TEXT, SUMMARY_FROM_HOUR, activePause, appendPassLog, daySummary, emptyCounts, errorKey, firstName, fmtZurich, inSendWindow, is429, isBusy,
  loadAutopilot, localDay, nextScheduled, notify, passResult, passSummary, rateLimitUntil, readPassLog, shortError, stopReason, updateAutopilot,
} = await import("../lib/tutor24-autopilot");
const { loadCourses, loadLeadInfo, loadLog, loadSettings, sentToday } = await import("../lib/tutor24-followup-store");
const { runFollowup } = await import("../lib/tutor24-followup-runner");
const { runTutor24Messaging } = await import("../lib/tutor24");
const { followupJobState } = await import("../lib/automation-state");
const { AUTOPILOT_LOCK_PATH, acquireTutor24Lock } = await import("../lib/tutor24-lock");
const { laptopSignal } = await import("../lib/tutor24-autopilot");
const { finishRun, startRun, takeStops, writeLaptop } = await import("../lib/tutor24-watch-db");
const { START_BUTTON } = await import("../lib/tutor24-watch");

/** Datenbank fuer den Waechter: ein Fehler dort darf den Durchgang weder verhindern noch abbrechen. */
const db = async <T,>(what: string, f: () => Promise<T>): Promise<T | null> => {
  try {
    return await f();
  } catch (err) {
    console.error(`[db] ${what}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
};

const log = (s: string) => console.log(`${new Date().toLocaleString("de-CH")} ${s}`);
const forcedProbe = process.argv.includes("--probe");
const maxArg = process.argv.indexOf("--max");
const max = maxArg > -1 ? Number(process.argv[maxArg + 1]) : undefined;
if (max !== undefined && !(Number.isInteger(max) && max >= 1 && max <= 20)) {
  console.error("--max braucht eine ganze Zahl von 1 bis 20");
  process.exit(1);
}

const quelleArg = process.argv.indexOf("--quelle");
/** plan (Aufgabenplanung, autopilot.cmd) | run (Telegram /run) | knopf ("Jetzt starten") | hand */
const quelle = quelleArg > -1 ? process.argv[quelleArg + 1] : forcedProbe && max ? "run" : "hand";
/** vom Handy gestartet: auch ein "nicht gestartet" melden, sonst wartet man vergeblich */
const asked = quelle === "knopf" || quelle === "run";
if (asked) {
  // Vom Bot gestartet: Ausgabe selbst ins Protokoll schreiben (weder vererbter Handle noch cmd-Umleitung kamen an).
  const { appendFileSync } = await import("node:fs");
  for (const k of ["log", "error"] as const) {
    const orig = console[k].bind(console);
    console[k] = (...a: unknown[]) => {
      orig(...a);
      try {
        appendFileSync("tutor24-followup/autopilot-run.log", a.map(String).join(" ") + "\n");
      } catch {
        // Protokoll ist Nebensache
      }
    };
  }
}
const hhmm = (d: string) => new Date(d).toLocaleTimeString("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" });
const minutes = (from: string) => `${Math.max(1, Math.round((Date.now() - new Date(from).getTime()) / 60000))} min`;

// /stop vom Handy, waehrend der Laptop aus war: gilt, bevor irgendetwas laeuft.
if ((await db("Stopp-Befehle", takeStops)) && loadAutopilot().modus !== "aus") {
  updateAutopilot({ modus: "aus", gestoppt: { grund: "per Telegram /stop", am: new Date().toISOString() } });
  log("/stop vom Handy angewendet: Automatik ist AUS.");
  await notify("🔴 /stop angewendet: Automatik ist AUS. Der Durchgang wurde nicht gestartet.");
}
const state = loadAutopilot();
const modus = forcedProbe ? "probe" : state.modus;
if (modus === "aus") {
  log("Automatik ist aus — nichts zu tun.");
  if (asked) await notify("🔴 Automatik ist aus — Durchgang nicht gestartet.");
  process.exit(0);
}
const pause = activePause(readPassLog(50));
if (pause) {
  log(`${RATE_LIMIT_TEXT} Pause bis ${fmtZurich(pause)} — kein Abruf.`);
  if (asked) await notify(`⏸ ${RATE_LIMIT_TEXT} Pause bis ${fmtZurich(pause)} — Durchgang nicht gestartet.`);
  process.exit(0);
}
// Ein Durchgang zur Zeit (Aufgabenplanung und Telegram /run koennen sich ueberschneiden).
try {
  const release = acquireTutor24Lock(forcedProbe ? "Probelauf" : "Automatik-Durchgang", AUTOPILOT_LOCK_PATH);
  process.on("exit", release);
} catch (err) {
  log(`Läuft schon, nicht gestartet: ${err instanceof Error ? err.message : String(err)}`);
  if (asked) await notify("Es läuft schon ein Durchgang — kein zweiter gestartet. Sein Ergebnis kommt als eigene Meldung.");
  process.exit(0);
}

const dryRun = modus === "probe";
const P = dryRun ? "🧪 PROBE · " : "";
const runId = await db("Durchgang anlegen", () => startRun(modus, quelle));
await db("Lebenszeichen", () => writeLaptop(laptopSignal()));
const settings = loadSettings();

const pass = {
  start: new Date().toISOString(), ende: "", modus,
  erst: emptyCounts(), nachfassen: emptyCounts(), antworten: 0, fehler: [] as string[], stopp: null as string | null, probe: [] as string[],
  /** z. B. "alter Text als Rueckfall" — steht in der Schlussmeldung */
  notes: [] as string[],
};
/** neue Antworten laut Liste "Gesendet" (runFollowup auto) */
const listReplies: { id: string; name: string; absage: boolean }[] = [];

/** Vor jeder einzelnen Nachricht und direkt vor dem Senden: Zeitfenster und Notbremse (Telegram /stop, /kurse). */
const mayContinue = () => {
  if (forcedProbe) return null; // von Hand / Telegram /run: sendet ohnehin nichts
  // Probe sendet nichts: das Fenster gilt nur im echten Betrieb; die Liste vermerkt "würde ab 8:00 gesendet".
  if (!dryRun && !inSendWindow()) return "ausserhalb 8–20 Uhr";
  const now = loadAutopilot().modus;
  if (now === "aus" || (!dryRun && now !== "an")) return "Automatik wurde ausgeschaltet";
  return null;
};

// Meldungen unterwegs: Start (geplant; vom Handy meldet das schon der Bot), nach jedem Schritt, am Ende.
if (!asked)
  await notify(
    `${P}▶️ Geplanter Durchgang ${hhmm(pass.start)} gestartet${dryRun ? " (sendet nichts)" : ""}.\n` +
      "Schritte: 1 neue Inserate · 2 Antworten prüfen · 3 Nachfassen. Ich melde mich nach jedem Schritt."
  );
const sentOrWould = (c: { gesendet: number; wuerde: number }) => (dryRun ? `${c.wuerde} würden gesendet` : `${c.gesendet} gesendet`);
const erstKinds = () => `${pass.erst.kurs ?? 0} mit Kursblock, ${pass.erst.hinweis ?? 0} mit Hinweis`;
let erstNote = "";

const repliedBefore = new Set((await loadLog()).filter((r) => r.geantwortet === "ja").map((r) => r.conversation_id));
let fatal: string | null = null;
let busy = false;

try {
  // 1. Erst-Nachrichten an neue Inserate (begrenzt: nur Mathematik, eine Suchseite)
  const erstLimit = Math.min(max ?? Infinity, Math.max(0, settings.autoErstLimit - (await sentToday(new Date(), "erst"))));
  if (!inSendWindow() && !dryRun) log((erstNote = "Ausserhalb 8–20 Uhr: keine Erst-Nachrichten."));
  else if (erstLimit === 0) log((erstNote = `Tageslimit Erst-Nachrichten (${settings.autoErstLimit}) erreicht.`));
  else {
    log(`Erst-Nachrichten: höchstens ${erstLimit}${dryRun ? " (PROBE, sendet nichts)" : ""} …`);
    const r = await runTutor24Messaging(true, max ? 1 : 10, max ? ["Mathematik"] : ["Mathematik", "Physik"], {
      limit: erstLimit, dryRun, mayContinue, counts: pass.erst, probe: pass.probe, notes: pass.notes, ...(max ? { maxOpen: max * 2 } : {}),
    });
    for (const l of r.log) console.log(`  ${l}`);
    pass.fehler.push(...r.errors);
    erstNote =
      `Erst-Nachrichten: ${sentOrWould(pass.erst)} (${erstKinds()}), ${pass.erst.uebersprungen} übersprungen` +
      (r.errors.length ? `, ⚠ ${r.errors.length} Inserate mit Fehler: ${shortError(r.errors[0]).slice(0, 120)}` : "") +
      ".";
  }

  // 2.–4. Kandidaten suchen → Antworten prüfen → Nachfassen (eine Anmeldung)
  const nachLimit = Math.min(max ?? Infinity, Math.max(0, settings.autoNachfassLimit - (await sentToday())));
  // Notbremse waehrend der Erst-Nachrichten: Durchgang hier ganz beenden.
  if (!forcedProbe && loadAutopilot().modus === "aus") log("Automatik wurde ausgeschaltet — Durchgang beendet.");
  else {
    log(`Nachfassen: höchstens ${nachLimit}, frühestens ${settings.nachfassNachTagen} Tage nach der Erst-Nachricht …`);
    await runFollowup({
      mode: "auto",
      // ponytail: 40 neue/geaenderte Chats pro Durchgang reichen bei ~20 Erst-Nachrichten am Tag; der Rest folgt beim naechsten
      maxChecks: max ?? 40,
      headless: true,
      onLog: (l) => console.log(`  ${l}`),
      auto: {
        limit: nachLimit, minAgeDays: settings.nachfassNachTagen, dryRun, mayContinue, counts: pass.nachfassen, probe: pass.probe, antworten: listReplies,
        // begrenzt: hoechstens 2 Nachlade-Runden pro Liste, der Rest kommt aus dem Zwischenspeicher
        ...(max ? { maxScrollRounds: 2, maxReplyChecks: max } : {}),
        onStep: (step) =>
          notify(
            step === "antworten"
              ? `${P}✓ 1/3 Neue Inserate fertig (nach ${minutes(pass.start)}). ${erstNote}\n… 2/3 Antworten prüfen (höchstens ${max ?? 40} Chats).`
              : `${P}✓ 2/3 Antworten geprüft (nach ${minutes(pass.start)}).\n… 3/3 Nachfassen (höchstens ${nachLimit}).`
          ),
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
for (const r of toNotify.values()) {
  const link = `https://www.tutor24.ch/de/conversations/${r.id}?tab=sent`;
  const lead = leadInfo[r.id];
  await notify(
    lead?.erstHinweis && !r.absage
      ? `${P}💬 Antwort auf Kurs-Hinweis von ${firstName(r.name)} · Stufe ${lead.stufe || "unbekannt"}\n${link}\nBekommt keine automatischen Nachrichten mehr.`
      : `${P}💬 ${r.absage ? "Absage" : "Antwort"} von ${firstName(r.name)} · ${kursOf(r.id)}\n${link}`
  );
}

// Stopp-Regeln
pass.ende = new Date().toISOString();
const reason = stopReason({ pruefungFehler: pass.erst.pruefungFehler + pass.nachfassen.pruefungFehler, fehler: fatal, letzterFehler: state.letzterFehler });
if (reason) {
  pass.stopp = reason;
  updateAutopilot({ modus: "aus", gestoppt: { grund: reason, am: pass.ende }, letzterFehler: null });
  const until = rateLimitUntil([pass]);
  await notify(
    is429(reason) && until
      ? `${P}⛔ ${RATE_LIMIT_TEXT}\n429 um ${fmtZurich(new Date(pass.ende))}. Pausiert bis ${fmtZurich(until)}; vorher startet kein Lauf.\n` +
        `Automatik ist AUS. Frühester geplanter Lauf nach dem Einschalten: ${fmtZurich(nextScheduled(until))}.\nWieder einschalten mit /enable oder auf /kurse.`
      : `${P}⛔ Automatik gestoppt: ${reason}\nWieder einschalten mit /enable oder auf /kurse.`
  );
} else {
  if (!busy) updateAutopilot({ letzterFehler: fatal ? errorKey(fatal) : null });
  if (fatal) await notify(`${P}⚠ Durchgang abgebrochen: ${fatal}\nKommt derselbe Fehler beim nächsten Mal wieder, stoppt die Automatik.`);
}

appendPassLog(pass);
log(passSummary(pass));
if (runId) await db("Durchgang abschliessen", () => finishRun(runId, pass));
await db("Lebenszeichen", () => writeLaptop(laptopSignal()));

// Schlussmeldung immer, auch im Modus EIN (Stopp und Abbruch haben oben zusaetzlich ihre eigene).
const later = inSendWindow() ? "" : " — würde ab 8:00 gesendet";
const list = dryRun ? `\nWürde senden:\n${pass.probe.length ? pass.probe.map((x) => `• ${x}${later}`).join("\n") : "niemand"}` : "";
await notify(
  `${P}${pass.stopp || fatal || busy ? "■" : "✅"} Durchgang ${hhmm(pass.start)} fertig (${minutes(pass.start)})\n` +
    `Ergebnis: ${busy ? "vorzeitig beendet (gestoppt)" : passResult(pass)}\n` +
    `Erst-Nachrichten ${sentOrWould(pass.erst)} (${erstKinds()}) · Nachfassen ${sentOrWould(pass.nachfassen)} · Antworten ${pass.antworten}` +
    (pass.notes.length ? `\n${pass.notes.join("\n")}` : "") +
    list.slice(0, 3500)
);

// Abend-Zusammenfassung: einmal pro Tag, ab dem letzten geplanten Durchgang (nicht beim begrenzten Probelauf)
const today = localDay();
if (!max && new Date().getHours() >= SUMMARY_FROM_HOUR && loadAutopilot().zusammenfassungAm !== today) {
  if (await notify(daySummary(today), undefined, false, START_BUTTON)) updateAutopilot({ zusammenfassungAm: today });
}
process.exit(0);
