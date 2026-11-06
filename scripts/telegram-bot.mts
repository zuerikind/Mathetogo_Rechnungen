/**
 * Telegram-Steuerung der tutor24-Automatik. Laeuft dauerhaft (Windows-Aufgabe "bei Anmeldung",
 * scripts/telegram-bot.cmd), unabhaengig von `npm run dev`. Befehle und Regeln: lib/tutor24-bot.ts
 *   /status  Stand    /run  Probelauf ohne Versand    /stop  Automatik aus    /enable  ein (mit Bestaetigung)
 *
 * Einrichtung: npx tsx scripts/telegram-bot.mts --chat-id
 *   → zeigt die Chat-ID der letzten Nachricht an den Bot (vorher dem Bot "/start" schreiben).
 */
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local" });

const { answerCallback, getUpdates, laptopSignal, loadAutopilot, notify, readPassLog, updateAutopilot } = await import("../lib/tutor24-autopilot");
const { commandResult, takeCommands, writeLaptop } = await import("../lib/tutor24-watch-db");
const { PROBE_MAX, createBot } = await import("../lib/tutor24-bot");
const { readStatus, requestStop } = await import("../lib/tutor24-followup-store");
const { AUTOPILOT_LOCK_PATH, acquireTutor24Lock, pidAlive, readTutor24Lock } = await import("../lib/tutor24-lock");

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

// Nur ein Bot: zwei Bots wuerden sich die Updates wegnehmen (Telegram erlaubt nur einen getUpdates-Leser).
try {
  const release = acquireTutor24Lock("Telegram-Bot", join(process.cwd(), ".telegram-bot.lock"));
  process.on("exit", release);
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) process.on(sig, () => process.exit(0));
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
  requestStop,
  answerCallback,
});

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

console.log(`${stamp()} Telegram-Bot läuft. Befehle: /status, /run, /stop, /enable, Knopf „Jetzt starten“`);
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
