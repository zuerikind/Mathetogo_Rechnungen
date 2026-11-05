/**
 * Telegram-Steuerung der tutor24-Automatik. Laeuft dauerhaft (Windows-Aufgabe "bei Anmeldung",
 * scripts/telegram-bot.cmd), unabhaengig von `npm run dev`. Befehle und Regeln: lib/tutor24-bot.ts
 *   /status  Stand    /run  Probelauf ohne Versand    /stop  Automatik aus    /enable  ein (mit Bestaetigung)
 *
 * Einrichtung: npx tsx scripts/telegram-bot.mts --chat-id
 *   → zeigt die Chat-ID der letzten Nachricht an den Bot (vorher dem Bot "/start" schreiben).
 */
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local" });

const { getUpdates, loadAutopilot, notify, readPassLog, updateAutopilot } = await import("../lib/tutor24-autopilot");
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

/** Fester Befehl ohne Benutzereingabe: begrenzter Probelauf als eigener Prozess (ueberlebt einen Bot-Neustart). */
const startProbe = () => {
  const dir = join(process.cwd(), "tutor24-followup");
  mkdirSync(dir, { recursive: true });
  const out = openSync(join(dir, "autopilot-run.log"), "a");
  const child = spawn(`npx tsx scripts/autopilot.mts --probe --max ${PROBE_MAX}`, {
    cwd: process.cwd(), detached: true, windowsHide: true, stdio: ["ignore", out, out], shell: true,
  });
  child.unref();
  closeSync(out);
};

const handle = createBot({
  chatId: me,
  now: () => new Date(),
  reply: (html) => notify(html, me, true),
  state: loadAutopilot,
  update: updateAutopilot,
  passes: () => readPassLog(50),
  busy,
  startProbe,
  requestStop,
});

console.log(`${new Date().toLocaleString("de-CH")} Telegram-Bot läuft. Befehle: /status, /run, /stop, /enable`);
for (;;) {
  try {
    const updates = await getUpdates(loadAutopilot().telegramOffset);
    for (const u of updates) {
      // Zuerst weiterschieben: ein Befehl, der abstuerzt, kommt nach einem Neustart nicht nochmals.
      updateAutopilot({ telegramOffset: u.update_id + 1 });
      console.log(`${new Date().toLocaleString("de-CH")} ${u.update_id}: ${await handle(u)}`);
    }
  } catch (err) {
    console.error(`${new Date().toLocaleTimeString("de-CH")} ${err instanceof Error ? err.message : String(err)} — neuer Versuch in 30 s`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
}
