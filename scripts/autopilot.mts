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
  RATE_LIMIT_TEXT, activePause, appendPassLog, emptyCounts, errorKey, firstName, fmtZurich, inSendWindow, is429, isBusy,
  loadAutopilot, nextScheduled, notify, passResult, passSummary, rateLimitUntil, readPassLog, shortError, stopReason, updateAutopilot,
} = await import("../lib/tutor24-autopilot");
const { loadCourses, loadLeadInfo, loadLog, loadSettings, sentToday } = await import("../lib/tutor24-followup-store");
const { runFollowup } = await import("../lib/tutor24-followup-runner");
const { runTutor24Messaging, sendBatchErst } = await import("../lib/tutor24");
const { followupJobState } = await import("../lib/automation-state");
const { AUTOPILOT_LOCK_PATH, acquireTutor24Lock, earliestNext, tooSoonText } = await import("../lib/tutor24-lock");
const { laptopSignal } = await import("../lib/tutor24-autopilot");
const { finishRun, startRun, takeStops, writeLaptop, writeProgress } = await import("../lib/tutor24-watch-db");
const { freigegebene, heuteGestellt, loadRueckfragen, rueckfrageAnlegen, rueckfrageKnoepfe, rueckfrageText, setzeStatus, zurichDay } = await import("../lib/tutor24-rueckfragen");
type Rueckfrage = import("../lib/tutor24-rueckfragen").Rueckfrage;
const { agentPass, agentProtokoll, agentZaehlen, pruefAgent, urteilLabel } = await import("../lib/tutor24-pruefagent");
const { addMarkiert } = await import("../lib/tutor24-batch");

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

// --erst [N]: nur Erst-Nachrichten (Telegram /erst N, Knopf auf /kurse), bis zu N (ohne N: Tageslimit), N 1–20.
const erstArg = process.argv.indexOf("--erst");
const erstOnly = erstArg > -1;
const erstRaw = erstOnly ? process.argv[erstArg + 1] : undefined;
const erstN = erstRaw && /^\d+$/.test(erstRaw) ? Number(erstRaw) : undefined;
if (erstN !== undefined && !(erstN >= 1 && erstN <= 20)) {
  console.error("--erst braucht eine ganze Zahl von 1 bis 20 (oder keine)");
  process.exit(1);
}

const quelleArg = process.argv.indexOf("--quelle");
/** plan (Aufgabenplanung, autopilot.cmd) | run (Telegram /run) | knopf ("Jetzt starten") | nachgeholt / freigabe (Bot, 11.11.) | hand */
const quelle = quelleArg > -1 ? process.argv[quelleArg + 1] : forcedProbe && max ? "run" : "hand";
/** vom Handy gestartet: auch ein "nicht gestartet" melden, sonst wartet man vergeblich */
const asked = quelle === "knopf" || quelle === "run" || quelle === "erst";
/** vom Bot gestartet (nachholen, Freigaben): der hat Speicher, Abstand und Internet schon geprueft — kein "nicht gestartet" melden */
const quiet = quelle === "nachgeholt" || quelle === "freigabe";
// --freigaben: nur die per Telegram/auf /kurse freigegebenen Rueckfragen senden (Bot, 10 min nach dem letzten Knopf)
const FREIGABEN = process.argv.includes("--freigaben");
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
// Mindestabstand 2 h zum letzten tutor24-Lauf (gilt fuer alle: geplant, /run, /erst, Knopf, von Hand).
const soon = earliestNext();
if (soon) {
  log(`Zu früh, nicht gestartet: ${tooSoonText(soon)}`);
  if (!quiet) await notify(`⏳ Durchgang nicht gestartet. ${tooSoonText(soon)}`);
  process.exit(0);
}
// Speicher vor dem Browserstart (wie beim Batch, mind. 1.5 GB frei). Der Bot holt den Durchgang nach, sobald es wieder geht.
const { speicherProblem } = await import("../lib/tutor24-batch");
const zuWenig = speicherProblem();
if (zuWenig) {
  log(`Nicht gestartet: ${zuWenig}`);
  if (!quiet) await notify(`🧠 Durchgang nicht gestartet. ${zuWenig}\nDer Bot versucht es alle 10 Minuten nochmals, sobald genug frei ist.`);
  process.exit(0);
}
// Kein Internet: nicht als Fehler werten, sondern verschieben — alle 2 min pruefen, hoechstens 30 min.
// Kommt es nicht zurueck, endet der Durchgang still; der Waechter (Vercel) erinnert wie bei "Laptop offline".
const { currentSsid, hasInternet, isHotspot, megabytes, netBytes } = await import("../lib/tutor24-network");
const plannedAt = new Date();
let offlineChecks = 0;
while (!(await hasInternet())) {
  if (++offlineChecks > 15) {
    log("Kein Internet seit 30 min — Durchgang ausgefallen.");
    process.exit(0);
  }
  if (offlineChecks === 1) log("Kein Internet, Durchgang verschoben (prüfe alle 2 min, höchstens 30 min).");
  await new Promise((r) => setTimeout(r, 2 * 60_000));
}
const settings = loadSettings();
const dryRun = modus === "probe";
// Meldungen (11.11.): "wenig" = nur Rueckfragen, Antworten, Stopps/Fehler, Abend-Zusammenfassung (Bot); Probe immer alles.
const laut = dryRun || settings.meldungen === "alle";
if (offlineChecks && laut)
  await notify(`📶 Um ${hhmm(plannedAt.toISOString())} kein Internet, Durchgang verschoben. Jetzt wieder verbunden — er startet.`);
const hotspot = isHotspot(currentSsid());
const netWarn = hotspot ? "\n⚠ Laptop hängt am iPhone-Hotspot." : "";
// Ein Durchgang zur Zeit (Aufgabenplanung und Telegram /run koennen sich ueberschneiden).
try {
  const release = acquireTutor24Lock(forcedProbe ? "Probelauf" : FREIGABEN ? "Freigaben senden" : erstOnly ? "Erst-Nachrichten-Lauf" : "Automatik-Durchgang", AUTOPILOT_LOCK_PATH);
  process.on("exit", release);
} catch (err) {
  log(`Läuft schon, nicht gestartet: ${err instanceof Error ? err.message : String(err)}`);
  if (asked) await notify("Es läuft schon ein Durchgang — kein zweiter gestartet. Sein Ergebnis kommt als eigene Meldung.");
  process.exit(0);
}

// ── Freigaben senden (--freigaben, vom Bot): genau die freigegebenen Rueckfragen, Text wie in der Rueckfrage ──
if (FREIGABEN) {
  if (modus !== "an" || !inSendWindow()) {
    log(`Freigaben: nicht gesendet (${modus !== "an" ? "Automatik nicht EIN" : "ausserhalb 8–20 Uhr"}).`);
    process.exit(0);
  }
  const limit = Math.max(0, settings.autoErstLimit - (await sentToday(new Date(), "erst")));
  const items = freigegebene().slice(0, limit).map((r) => ({
    id: r.id, art: "erst" as const, titel: r.titel, stufe: r.stufe, ort: "", link: r.link, sprache: r.sprache, anrede: r.anrede, block: "",
    kursId: r.kursId, hint: r.hint, satz: r.satz, text: r.text, problem: null, ausgewaehlt: true, info: r.info,
  }));
  if (!items.length) {
    log(limit === 0 ? `Freigaben: Tageslimit (${settings.autoErstLimit}) erreicht — morgen.` : "Freigaben: nichts offen.");
    process.exit(0);
  }
  const start = new Date().toISOString();
  const counts = emptyCounts();
  let fehler: string | null = null;
  try {
    // sendBatchErst prueft vor jedem Inserat: schon angeschrieben, Konversation vorhanden; sendet genau item.text.
    await sendBatchErst(items, log, (it) => {
      if (it.ergebnis === "gesendet") counts.gesendet++;
      else counts.uebersprungen++;
      setzeStatus(it.id, it.ergebnis === "gesendet" ? "gesendet" : "fehler", it.meldung ?? "");
    });
  } catch (err) {
    fehler = shortError(err instanceof Error ? err.message : String(err));
    log(`✖ ${fehler}`);
  }
  appendPassLog({ start, ende: new Date().toISOString(), modus, erst: counts, nachfassen: emptyCounts(), antworten: 0, fehler: fehler ? [fehler] : [], stopp: fehler && is429(fehler) ? fehler : null });
  const rest = items.filter((i) => i.ergebnis !== "gesendet").map((i) => `• ${i.titel}: ${i.ergebnis ?? "nicht versucht"} ${i.meldung ?? ""}`.trim());
  await notify(`✉️ Freigaben gesendet: ${counts.gesendet} von ${items.length}.${rest.length ? `\n${rest.join("\n")}` : ""}${fehler ? `\n⚠ ${fehler}` : ""}`);
  process.exit(0);
}

const P = dryRun ? "🧪 PROBE · " : "";
const runId = await db("Durchgang anlegen", () => startRun(modus, quelle));
await db("Lebenszeichen", () => writeLaptop(laptopSignal()));

const pass = {
  start: new Date().toISOString(), ende: "", modus,
  erst: emptyCounts(), nachfassen: emptyCounts(), antworten: 0, fehler: [] as string[], stopp: null as string | null, probe: [] as string[],
  /** nur Probe: vollstaendige Erst-Nachrichten (je eine Telegram-Meldung am Schluss, nicht im Protokoll) */
  texte: [] as string[],
  /** z. B. "alter Text als Rueckfall" — steht in der Schlussmeldung */
  notes: [] as string[],
  /** Datenmenge des Durchgangs (ganzer Laptop, Hotspot-Verbrauch), MB */
  mb: null as number | null,
  /** Pruef-Agent: Zaehler des Durchgangs (Erst-Nachrichten und Nachfassen) */
  agent: agentPass(),
  /** Pruefung nach dem Senden: 3 zufaellige gesendete Chats nur lesend verglichen */
  kontrolliert: [] as { conversationId: string; name: string; ok: boolean; hinweis: string }[],
};
const bytesAtStart = netBytes();
/** neue Antworten laut Liste "Gesendet" (runFollowup auto) */
const listReplies: { id: string; name: string; absage: boolean }[] = [];

/** Vor jeder einzelnen Nachricht und direkt vor dem Senden: Zeitfenster und Notbremse (Telegram /stop, /kurse). */
const mayContinue = () => {
  if (forcedProbe) return null; // von Hand / Telegram /run: sendet ohnehin nichts
  if (!dryRun && pass.agent.halt) return pass.agent.halt;
  // Probe sendet nichts: das Fenster gilt nur im echten Betrieb; die Liste vermerkt "würde ab 8:00 gesendet".
  if (!dryRun && !inSendWindow()) return "ausserhalb 8–20 Uhr";
  const now = loadAutopilot().modus;
  if (now === "aus" || (!dryRun && now !== "an")) return "Automatik wurde ausgeschaltet";
  return null;
};

// Meldungen unterwegs: Start (geplant; vom Handy meldet das schon der Bot), nach jedem Schritt, am Ende — nur bei "alle" oder Probe.
if (!asked && laut)
  await notify(
    `${P}▶️ ${quelle === "nachgeholt" ? "Nachgeholter" : "Geplanter"} Durchgang ${hhmm(pass.start)} gestartet${dryRun ? " (sendet nichts)" : ""}.\n` +
      "Schritte: 1 neue Inserate · 2 Antworten prüfen · 3 Nachfassen. Ich melde mich nach jedem Schritt." +
      netWarn
  );
else if (hotspot && laut) await notify(`${P}⚠ Laptop hängt am iPhone-Hotspot.`);

/** Unsichere Erst-Nachricht als Rueckfrage per Telegram (hoechstens 5 am Tag, sonst Liste auf /kurse) */
const rueckfrage = async (r: Omit<Rueckfrage, "tag" | "erstelltAm" | "status">) => {
  const erg = rueckfrageAnlegen(r);
  if (erg === "gestellt") {
    const nr = heuteGestellt(loadRueckfragen(), zurichDay(new Date()));
    const voll = { ...r, tag: "", erstelltAm: "", status: "offen" as const };
    await notify(rueckfrageText(voll, nr), undefined, false, rueckfrageKnoepfe(voll));
  }
  return erg;
};
/** Pruef-Agent beim Nachfassen: Inserat aus dem Lead (Datenbank); auffaellig → nicht senden, Meldung, Liste auf /kurse */
const pruefeNachfassen = async (r: { conversation_id: string; inserat_id: string; name: string; text: string }) => {
  const { prisma } = await import("../lib/prisma");
  const lead = await prisma.tutor24Lead.findFirst({ where: { OR: [{ conversationId: r.conversation_id }, ...(r.inserat_id ? [{ inseratId: r.inserat_id }] : [])] } });
  const u = await pruefAgent({ art: "nachfassen", titel: lead?.name || r.name, fach: lead?.faecher, stufe: lead?.stufe, beschreibung: lead?.auszug ?? "", text: r.text });
  const vorher = pass.agent.halt;
  agentZaehlen(pass.agent, u);
  agentProtokoll({ id: r.conversation_id, art: "nachfassen", titel: lead?.name || r.name, urteil: u.urteil, grund: u.grund, probe: dryRun || undefined });
  const link = `https://www.tutor24.ch/de/conversations/${r.conversation_id}?tab=sent`;
  if (dryRun) {
    pass.notes.push(`Nachfassen ${firstName(r.name)}: ${urteilLabel(u)}`);
    if (pass.agent.halt && !vorher) pass.notes.push(`⛔ Im echten Betrieb würde hier gestoppt: ${pass.agent.halt}`);
    return u.urteil === "ok";
  }
  if (u.urteil !== "ok") {
    addMarkiert({ id: r.conversation_id, titel: `Nachfassen: ${r.name}`, link, grund: u.urteil === "auffaellig" ? `Prüf-Agent: ${u.grund}` : u.grund, am: new Date().toISOString() });
    await notify(`❓ Nachfassen an ${firstName(r.name)} nicht gesendet — ${urteilLabel(u)}
${link}
Steht auf /kurse unter „Von der Automatik markiert“; senden nur von Hand.

${r.text}`.slice(0, 4000));
  }
  return u.urteil === "ok";
};
/** Pruefung nach dem Senden: 3 zufaellig gewaehlte, in diesem Durchgang gesendete Chats */
const nachkontrolle = async () => {
  const { prisma } = await import("../lib/prisma");
  const m = await prisma.tutor24Message.findMany({ where: { sentAt: { gte: new Date(pass.start) }, status: "gesendet", lead: { conversationId: { not: null } } }, include: { lead: true } });
  return m.sort(() => Math.random() - 0.5).slice(0, 3).map((x) => ({ conversationId: x.lead.conversationId!, name: x.lead.name, text: x.text }));
};
/** Optionen fuer Schritt 1; in der Probe sammelt runTutor24Messaging hier Probe-Rueckfragen bzw. ein Beispiel */
const erstAuto: import("../lib/tutor24").AutoErst = {
  limit: 0, dryRun, mayContinue, counts: pass.erst, probe: pass.probe, notes: pass.notes, texte: pass.texte, rueckfrage, agent: pass.agent,
  ...(max ? { maxOpen: max * 2 } : {}),
  ...(dryRun ? { probeRueckfragen: [] } : {}),
};
// Unterwegs: der Stand in der Datenbank fuer /status ("läuft gerade"), alle 5 min erneuert.
let schritt = "1/3 Neue Inserate";
let zaehler = "";
const setStep = (s: string) => {
  schritt = s;
  zaehler = "";
  void db("Fortschritt", () => writeProgress({ start: pass.start, modus, schritt, at: new Date().toISOString() }));
};
setStep(schritt);
// nur fuer /status, keine Telegram-Meldung (Start und Ende reichen, Entscheid 7.11.)
const ticker = setInterval(() => {
  void db("Fortschritt", () => writeProgress({ start: pass.start, modus, schritt, zaehler, at: new Date().toISOString() }));
}, 5 * 60_000);
const sentOrWould = (c: { gesendet: number; wuerde: number }) => (dryRun ? `${c.wuerde} würden gesendet` : `${c.gesendet} gesendet`);
const erstKinds = () => `${pass.erst.kurs ?? 0} mit Kursblock, ${pass.erst.hinweis ?? 0} mit Hinweis`;
let erstNote = "";

const repliedBefore = new Set((await loadLog()).filter((r) => r.geantwortet === "ja").map((r) => r.conversation_id));
let fatal: string | null = null;
let busy = false;

try {
  // 1. Erst-Nachrichten an neue Inserate (begrenzt: nur Mathematik, eine Suchseite)
  const erstLimit = Math.min(max ?? erstN ?? Infinity, Math.max(0, settings.autoErstLimit - (await sentToday(new Date(), "erst"))));
  if (!inSendWindow() && !dryRun) log((erstNote = "Ausserhalb 8–20 Uhr: keine Erst-Nachrichten."));
  else if (erstLimit === 0) log((erstNote = `Tageslimit Erst-Nachrichten (${settings.autoErstLimit}) erreicht.`));
  else {
    log(`Erst-Nachrichten: höchstens ${erstLimit}${dryRun ? " (PROBE, sendet nichts)" : ""} …`);
    erstAuto.limit = erstLimit;
    const r = await runTutor24Messaging(true, max ? 1 : 10, max ? ["Mathematik"] : ["Mathematik", "Physik"], erstAuto);
    for (const l of r.log) console.log(`  ${l}`);
    pass.fehler.push(...r.errors);
    erstNote =
      `Erst-Nachrichten: ${sentOrWould(pass.erst)} (${erstKinds()}), ${pass.erst.rueckfragen ?? 0} Rückfragen, ${pass.erst.uebersprungen} übersprungen` +
      (r.errors.length ? `, ⚠ ${r.errors.length} Inserate mit Fehler: ${shortError(r.errors[0]).slice(0, 120)}` : "") +
      ".";
  }

  // 2.–4. Kandidaten suchen → Antworten prüfen → Nachfassen (eine Anmeldung)
  const nachLimit = Math.min(max ?? Infinity, Math.max(0, settings.autoNachfassLimit - (await sentToday())));
  // Notbremse waehrend der Erst-Nachrichten: Durchgang hier ganz beenden. /erst: nur Schritt 1.
  if (erstOnly) log("Nur Erst-Nachrichten (/erst) — fertig.");
  else if (!forcedProbe && loadAutopilot().modus === "aus") log("Automatik wurde ausgeschaltet — Durchgang beendet.");
  else {
    log(`Nachfassen: höchstens ${nachLimit}, frühestens ${settings.nachfassNachTagen} Tage nach der Erst-Nachricht …`);
    setStep("1/3 Kandidaten suchen");
    await runFollowup({
      mode: "auto",
      // ponytail: 40 neue/geaenderte Chats pro Durchgang reichen bei ~20 Erst-Nachrichten am Tag; der Rest folgt beim naechsten
      maxChecks: max ?? 40,
      headless: true,
      onLog: (l) => {
        console.log(`  ${l}`);
        const m = /^\[(\d+)\/(\d+)\]/.exec(l);
        if (m) zaehler = `${m[1]} von ${m[2]}`;
      },
      auto: {
        limit: nachLimit, minAgeDays: settings.nachfassNachTagen, dryRun, mayContinue, counts: pass.nachfassen, probe: pass.probe, antworten: listReplies,
        // begrenzt: hoechstens 2 Nachlade-Runden pro Liste, der Rest kommt aus dem Zwischenspeicher
        ...(max ? { maxScrollRounds: 2, maxReplyChecks: max } : {}),
        ...(settings.pruefAgent ? { pruefen: pruefeNachfassen } : {}),
        ...(dryRun ? {} : { nachkontrolle, kontrolliert: pass.kontrolliert }),
        onStep: (step) => (
          setStep(step === "antworten" ? "2/3 Antworten prüfen" : "3/3 Nachfassen"),
          laut
            ? notify(
                step === "antworten"
                  ? `${P}✓ 1/3 Neue Inserate fertig (nach ${minutes(pass.start)}). ${erstNote}\n… 2/3 Antworten prüfen (höchstens ${max ?? 40} Chats).`
                  : `${P}✓ 2/3 Antworten geprüft (nach ${minutes(pass.start)}).\n… 3/3 Nachfassen (höchstens ${nachLimit}).`
              )
            : Promise.resolve()),
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
clearInterval(ticker);
pass.mb = megabytes(bytesAtStart, netBytes());
await db("Fortschritt", () => writeProgress(null));
pass.ende = new Date().toISOString();
const agentGrund = !dryRun && pass.agent.aus ? pass.agent.halt : null;
if (!dryRun && pass.agent.halt && !pass.agent.aus) await notify(`⚠ ${pass.agent.halt}. Automatik bleibt an; der nächste Durchgang versucht es wieder.`);
const abweichend = pass.kontrolliert.filter((k) => !k.ok);
if (abweichend.length)
  await notify(`⚠ Nachkontrolle: ${abweichend.length} von ${pass.kontrolliert.length} gesendeten Chats weichen vom gespeicherten Text ab\n` +
    abweichend.map((k) => `• ${firstName(k.name)}: ${k.hinweis}\nhttps://www.tutor24.ch/de/conversations/${k.conversationId}?tab=sent`).join("\n"));
const reason = agentGrund ?? stopReason({ pruefungFehler: pass.erst.pruefungFehler + pass.nachfassen.pruefungFehler, fehler: fatal, letzterFehler: state.letzterFehler });
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

const { texte, ...passOhneTexte } = pass;
appendPassLog(passOhneTexte);
log(passSummary(pass));
if (runId) await db("Durchgang abschliessen", () => finishRun(runId, passOhneTexte));
await db("Lebenszeichen", () => writeLaptop(laptopSignal()));

// Schlussmeldung: bei "alle" und in der Probe immer; bei "wenig" nur, wenn etwas schiefging (Stopp, Abbruch, gestoppt).
const later = inSendWindow() ? "" : " — würde ab 8:00 gesendet";
const list = dryRun ? `\nWürde senden:\n${pass.probe.length ? pass.probe.map((x) => `• ${x}${later}`).join("\n") : "niemand"}` : "";
const n = dryRun ? pass.erst.wuerde : pass.erst.gesendet;
const daten = pass.mb !== null ? `\nDaten ≈ ${pass.mb} MB (ganzer Laptop)` : "";
if (laut || pass.stopp || fatal || busy)
await notify(
  erstOnly
    ? `${P}${pass.stopp || fatal || busy ? "■" : "✉️"} Erst-Nachrichten ${hhmm(pass.start)} fertig (${minutes(pass.start)})\n` +
        `${n} ${dryRun ? "würden angeschrieben" : "angeschrieben"}: ${pass.erst.kurs ?? 0} mit Kursblock, ${pass.erst.hinweis ?? 0} mit Hinweis, ${n - (pass.erst.kurs ?? 0) - (pass.erst.hinweis ?? 0)} ohne beides.\n` +
        `${pass.erst.uebersprungen} übersprungen${erstNote && !n ? ` · ${erstNote}` : ""} · Ergebnis: ${busy ? "vorzeitig beendet (gestoppt)" : passResult(pass)}` +
        (pass.notes.length ? `\n${pass.notes.join("\n")}` : "") +
        daten +
        list.slice(0, 3500)
    : `${P}${pass.stopp || fatal || busy ? "■" : "✅"} Durchgang ${hhmm(pass.start)} fertig (${minutes(pass.start)})\n` +
        `Ergebnis: ${busy ? "vorzeitig beendet (gestoppt)" : passResult(pass)}\n` +
        `Erst-Nachrichten ${sentOrWould(pass.erst)} (${erstKinds()}) · Rückfragen ${pass.erst.rueckfragen ?? 0} · Nachfassen ${sentOrWould(pass.nachfassen)} · Antworten ${pass.antworten}` +
        (pass.notes.length ? `\n${pass.notes.join("\n")}` : "") +
        daten +
        list.slice(0, 3500)
);
// Probe: jede Erst-Nachricht vollstaendig als eigene Meldung, mit "✅ sicher" oder "❓ Rückfrage: Grund" (Telegram: hoechstens 4096 Zeichen)
for (const [i, t] of texte.entries()) await notify(`${P}✉️ Erst-Nachricht ${i + 1}/${texte.length} (würde gesendet)\n${t}`.slice(0, 4000));
// Probe: Rueckfragen mit Knoepfen zum Ausprobieren (nichts wird gesendet, gezaehlt oder notiert); ohne unsichere ein Beispiel
if (dryRun) {
  const probeRf = (erstAuto.probeRueckfragen ?? []).slice(0, 5);
  if (!probeRf.length && erstAuto.probeBeispiel) probeRf.push(erstAuto.probeBeispiel);
  for (const [i, r] of probeRf.entries()) {
    rueckfrageAnlegen({ ...r, probe: true });
    const voll = { ...r, probe: true, tag: "", erstelltAm: "", status: "offen" as const };
    await notify(rueckfrageText(voll, i + 1, probeRf.length), undefined, false, rueckfrageKnoepfe(voll));
  }
  if (!probeRf.length && pass.erst.wuerde === 0) await notify(`${P}Keine Erst-Nachricht in diesem Lauf — darum auch keine Beispiel-Rückfrage.`);
}

// Abend-Zusammenfassung um 20:00 schickt seit 11.11. der Telegram-Bot (scripts/telegram-bot.mts, lib/tutor24-abend.ts).
process.exit(0);
