/**
 * Telegram-Steuerung der tutor24-Automatik. Laeuft dauerhaft (Windows-Aufgabe "bei Anmeldung",
 * scripts/telegram-bot.cmd), unabhaengig von `npm run dev`. Befehle und Regeln: lib/tutor24-bot.ts
 *   /status  Stand    /run  Probelauf ohne Versand    /stop  Automatik aus    /enable  ein (mit Bestaetigung)
 *
 * Einrichtung: npx tsx scripts/telegram-bot.mts --chat-id
 *   → zeigt die Chat-ID der letzten Nachricht an den Bot (vorher dem Bot "/start" schreiben).
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { uptime } from "node:os";
import { join } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local" });

const { activePause, answerCallback, getUpdates, inSendWindow, laptopSignal, loadAutopilot, notify, readPassLog, runTimes, updateAutopilot } = await import("../lib/tutor24-autopilot");
const { commandResult, takeCommands, writeLaptop } = await import("../lib/tutor24-watch-db");
const { PROBE_MAX, createBot } = await import("../lib/tutor24-bot");
const { readStatus, requestStop } = await import("../lib/tutor24-followup-store");
const { AUTOPILOT_LOCK_PATH, acquireTutor24Lock, earliestNext, pidAlive, readTutor24Lock } = await import("../lib/tutor24-lock");
const { VERFALL_H, sendeLaufFaellig, verfallenLassen } = await import("../lib/tutor24-rueckfragen");
const { rueckfrageAktion } = await import("../lib/tutor24-rueckfragen-aktion");
const { abendZusammenfassung } = await import("../lib/tutor24-abend");
const { speicherProblem } = await import("../lib/tutor24-batch");
const { hasInternet } = await import("../lib/tutor24-network");
const { toMin, zurichParts, zurichTime } = await import("../lib/tutor24-schedule");

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN fehlt in .env.local");
  process.exit(1);
}

if (process.argv.includes("--chat-id")) {
  // Nur lesen, Offset nicht weiterschieben: der Bot sieht die Nachrichten spaeter trotzdem.
  const updates = await getUpdates(0, 0);
  const chats = new Map(updates.flatMap((u) => (u.message ? [[u.message.chat.id, u.message.chat.type ?? ""] as const] : [])));
  if (!chats.size) console.log('Keine Nachricht gefunden — schreib dem Bot zuerst "/start".');
  for (const [id, type] of chats) console.log(`Chat-ID ${id} (${type})`);
  process.exit(0);
}

const me = process.env.TELEGRAM_CHAT_ID;
if (!me) {
  console.error("TELEGRAM_CHAT_ID fehlt in .env.local (ermitteln mit --chat-id)");
  process.exit(1);
}

// Wiederbeleber: die Windows-Aufgabe startet diese Datei alle 5 Minuten (MultipleInstances IgnoreNew).
// Waehrend ein Durchgang laeuft, startet kein Bot — der naechste Versuch kommt 5 Minuten spaeter.
const BOT_LOCK = join(process.cwd(), ".telegram-bot.lock");
const EXIT_MARK = join(process.cwd(), "tutor24-followup", "telegram-bot.exit.json");
const pass = readTutor24Lock(AUTOPILOT_LOCK_PATH);
if (pass && !readTutor24Lock(BOT_LOCK)) {
  console.log(`${new Date().toLocaleString("de-CH")} Durchgang läuft (${pass.owner}) — Bot startet erst danach.`);
  process.exit(0);
}

// Nur ein Bot: zwei Bots wuerden sich die Updates wegnehmen (Telegram erlaubt nur einen getUpdates-Leser).
let crashed: string | null = null;
try {
  // Vorher ausgefallen? Entweder hart beendet (Sperre verwaist) oder per Signal (Marke geschrieben).
  const bootedAt = Date.now() - uptime() * 1000;
  if (existsSync(BOT_LOCK) && !readTutor24Lock(BOT_LOCK)) {
    const old = JSON.parse(readFileSync(BOT_LOCK, "utf8")) as { startedAt?: string };
    if (old.startedAt && new Date(old.startedAt).getTime() > bootedAt) crashed = "ohne Abmeldung beendet";
  }
  if (existsSync(EXIT_MARK)) {
    const m = JSON.parse(readFileSync(EXIT_MARK, "utf8")) as { am: string; grund: string };
    // Neustart des Laptops seither: kein Ausfall, sondern normaler Start bei der Anmeldung.
    if (new Date(m.am).getTime() > bootedAt) crashed = `${m.grund} um ${new Date(m.am).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}`;
    unlinkSync(EXIT_MARK);
  }
} catch {
  // Marke unlesbar: egal
}
try {
  const release = acquireTutor24Lock("Telegram-Bot", BOT_LOCK);
  process.on("exit", release);
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"] as const)
    process.on(sig, () => {
      // Spur fuer die Fehlersuche (6.11.: zweimal Strg+C ohne bekannten Ausloeser) und fuer die Meldung beim Neustart
      console.log(`${new Date().toLocaleString("de-CH")} Beendet durch ${sig}`);
      try {
        writeFileSync(EXIT_MARK, JSON.stringify({ am: new Date().toISOString(), grund: `beendet durch ${sig}` }));
      } catch {
        // egal
      }
      process.exit(0);
    });
} catch (err) {
  console.error(`Bot läuft schon: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(0); // 0: die Aufgabenplanung soll das nicht als Absturz neu starten
}

const busy = (): string | null => {
  const auto = readTutor24Lock(AUTOPILOT_LOCK_PATH);
  if (auto) return auto.owner;
  const lock = readTutor24Lock();
  if (lock) return lock.owner;
  const s = readStatus();
  if (s?.running && pidAlive(s.pid)) return `Nachfass-Lauf (${s.mode})`;
  return null;
};

/** Feste Befehle ohne Benutzereingabe, als eigener Prozess (ueberlebt einen Bot-Neustart). */
const spawnAutopilot = (args: string) => {
  const dir = join(process.cwd(), "tutor24-followup");
  mkdirSync(dir, { recursive: true });
  // Die Ausgabe schreibt autopilot.mts selbst ins Protokoll (--quelle run/knopf): Umleitungen kamen unter Windows nie an.
  appendFileSync(join(dir, "autopilot-run.log"), `==== ${new Date().toLocaleString("de-CH")} vom Handy: ${args}\n`);
  const child = spawn(`npx tsx scripts/autopilot.mts ${args}`, {
    cwd: process.cwd(), detached: true, windowsHide: true, stdio: "ignore", shell: true,
  });
  child.unref();
};
const startProbe = () => spawnAutopilot(`--probe --max ${PROBE_MAX} --quelle run`);
const startPass = () => spawnAutopilot("--quelle knopf");
// n kommt aus parseErst (ganze Zahl 1–20) — nie freier Text in der Befehlszeile.
const startErst = (n: number | null) => spawnAutopilot(`--erst${n && Number.isInteger(n) ? ` ${n}` : ""} --quelle erst`);

const handle = createBot({
  chatId: me,
  now: () => new Date(),
  reply: (html) => notify(html, me, true),
  state: loadAutopilot,
  update: updateAutopilot,
  passes: () => readPassLog(50),
  busy,
  startProbe,
  startPass,
  startErst,
  requestStop,
  gapUntil: () => earliestNext(),
  answerCallback,
  // Rueckfragen (11.11.): Knoepfe Senden / Ueberspringen / du / Sie
  rueckfrage: (aktion, id) => rueckfrageAktion(aktion, id),
  replyKnoepfe: (text, knoepfe) => notify(text, me, false, knoepfe),
});

// ── Selbst wieder anlaufen, Freigaben senden, Verfall, Abend-Zusammenfassung (11.11.) ─────────────
// Alles hoechstens einmal pro Minute, nie waehrend ein Lauf laeuft. Fehler hier duerfen den Bot nicht beenden.
let pflegeAt = 0;
let nachholVersuchAt = 0;
let freigabeVersuchAt = 0;
/** Darf jetzt ein Lauf auf tutor24 starten? null = ja, sonst der Grund (nur fuers Protokoll) */
const startHindernis = async (): Promise<string | null> => {
  const b = busy();
  if (b) return `läuft: ${b}`;
  if (activePause(readPassLog(50))) return "429-Pause";
  const soon = earliestNext();
  if (soon) return `Mindestabstand bis ${soon.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}`;
  const sp = speicherProblem();
  if (sp) return "zu wenig Speicher";
  if (!(await hasInternet())) return "kein Internet";
  return null;
};
const pflege = async () => {
  if (Date.now() - pflegeAt < 60_000) return;
  pflegeAt = Date.now();
  const now = new Date();
  const s = loadAutopilot();
  const z = zurichParts(now);
  const today = z.day;
  const mins = z.h * 60 + z.m;

  // 1. Offene Rueckfragen verfallen (ab 20 Uhr bzw. von gestern) → Liste auf /kurse
  const v = verfallenLassen(now);
  if (v.length) await notify(`⏳ ${v.length} Rückfrage${v.length === 1 ? "" : "n"} unbeantwortet — in der Liste „Von der Automatik markiert“ auf /kurse.`);

  // 2. Freigaben senden: 10 min nach dem letzten Knopf, nur im Modus EIN, 8–20 Uhr, Mindestabstand, kein Lauf
  if (s.modus === "an" && sendeLaufFaellig(now) && inSendWindow(now) && Date.now() - freigabeVersuchAt > 10 * 60_000) {
    const h = await startHindernis();
    if (h) console.log(`${stamp()} Freigaben warten (${h}).`);
    else {
      freigabeVersuchAt = Date.now();
      spawnAutopilot("--freigaben --quelle freigabe");
      console.log(`${stamp()} Sende-Lauf für freigegebene Rückfragen gestartet.`);
    }
    return; // ein Start pro Minute
  }

  // 3. Verpassten Durchgang nachholen: faellige Zeit + 10 min vorbei, kein Durchgang seither, Modus nicht aus
  if (s.modus !== "aus" && Date.now() - nachholVersuchAt > 10 * 60_000 && (s.modus === "probe" || inSendWindow(now))) {
    const due = runTimes().map((t) => toMin(t)).filter((m) => m + 10 <= mins).pop();
    if (due !== undefined) {
      const dueAt = zurichTime(today, Math.floor(due / 60), due % 60);
      const seit = readPassLog(50).some((p) => new Date(p.start).getTime() >= dueAt.getTime() - 30 * 60_000);
      if (!seit) {
        const h = await startHindernis();
        if (h) console.log(`${stamp()} Durchgang von ${String(Math.floor(due / 60)).padStart(2, "0")}:${String(due % 60).padStart(2, "0")} fehlt, warte (${h}).`);
        else {
          nachholVersuchAt = Date.now();
          spawnAutopilot("--quelle nachgeholt");
          console.log(`${stamp()} Verpassten Durchgang nachgeholt (gestartet).`);
          return;
        }
      }
    }
  }

  // 4. Abend-Zusammenfassung um 20:00, einmal pro Tag (auch wenn die Automatik aus ist)
  if (z.h >= VERFALL_H && s.zusammenfassungAm !== today) {
    const { text, texte } = await abendZusammenfassung(now);
    if (await notify(text)) {
      updateAutopilot({ zusammenfassungAm: today });
      for (const t of texte) await notify(t.slice(0, 4000));
    }
  }
};

const stamp = () => new Date().toLocaleString("de-CH");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HEARTBEAT_MS = 2 * 60_000;
let lastBeat = 0;
const heartbeat = async () => {
  if (Date.now() - lastBeat < HEARTBEAT_MS) return;
  try {
    await writeLaptop(laptopSignal());
    lastBeat = Date.now();
  } catch (err) {
    console.error(`${stamp()} Lebenszeichen: ${err instanceof Error ? err.message : String(err)}`);
    lastBeat = Date.now(); // nicht im Sekundentakt wiederholen
  }
};

/** Befehle, die der Webhook auf Vercel in die Datenbank gelegt hat ("start" = Knopf, sonst der getippte Text). */
const fromQueue = async () => {
  for (const c of await takeCommands()) {
    // /stop gilt immer, auch nach Stunden offline; alles, was etwas startet, verfaellt nach MAX_AGE_S.
    const sent = c.cmd === "/stop" ? new Date() : c.createdAt;
    const u = { update_id: 0, message: { date: Math.floor(sent.getTime() / 1000), text: c.cmd, chat: { id: Number(me), type: "private" } } };
    const result = await handle(u);
    await commandResult(c.id, result);
    console.log(`${stamp()} Befehl ${c.cmd}: ${result}`);
    lastBeat = 0; // Zustand kann sich geaendert haben: gleich melden
  }
};

console.log(`${stamp()} Telegram-Bot läuft. Befehle: /status, /run, /stop, /enable, Knopf „Jetzt starten“, Rückfrage-Knöpfe; holt verpasste Durchgänge nach, sendet Freigaben, Abend-Zusammenfassung um ${VERFALL_H}:00`);
if (crashed) {
  console.log(`${stamp()} Neu gestartet nach Ausfall (${crashed})`);
  await notify(`♻️ Telegram-Bot war ausgefallen (${crashed}) und wurde automatisch neu gestartet. Befehle gehen wieder.`).catch(() => {});
}
// Solange kein Webhook gesetzt ist, liest der Bot selbst bei Telegram (getUpdates). Ist der Webhook auf
// Vercel aktiv, antwortet Telegram darauf mit 409 — dann nur noch Befehle aus der Datenbank.
let webhook = false;
let webhookCheckedAt = 0;
let queueFailedAt = 0;
for (;;) {
  try {
    await heartbeat();
    // Datenbank nicht erreichbar (oder Tabelle noch nicht angelegt): 5 Minuten warten statt alle paar Sekunden melden.
    if (Date.now() - queueFailedAt > 5 * 60_000)
      await fromQueue().catch((err) => {
        queueFailedAt = Date.now();
        console.error(`${stamp()} Befehle: ${err instanceof Error ? err.message : String(err)}`);
      });
    await pflege().catch((err) => console.error(`${stamp()} Pflege: ${err instanceof Error ? err.message : String(err)}`));
    if (webhook && Date.now() - webhookCheckedAt < 60 * 60_000) {
      await sleep(4000);
      continue;
    }
    try {
      const updates = await getUpdates(loadAutopilot().telegramOffset, 20);
      webhook = false;
      for (const u of updates) {
        // Zuerst weiterschieben: ein Befehl, der abstuerzt, kommt nach einem Neustart nicht nochmals.
        updateAutopilot({ telegramOffset: u.update_id + 1 });
        console.log(`${stamp()} ${u.update_id}: ${await handle(u)}`);
        lastBeat = 0;
      }
    } catch (err) {
      if (!/409|webhook/i.test(err instanceof Error ? err.message : String(err))) throw err;
      if (!webhook) console.log(`${stamp()} Webhook aktiv: Befehle kommen jetzt über die Datenbank.`);
      webhook = true;
      webhookCheckedAt = Date.now();
    }
  } catch (err) {
    console.error(`${stamp()} ${err instanceof Error ? err.message : String(err)} — neuer Versuch in 30 s`);
    await sleep(30_000);
  }
}
