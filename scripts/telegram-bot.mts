/**
 * Telegram-Notbremse fuer die tutor24-Automatik. Laeuft dauerhaft (Windows-Aufgabe "bei Anmeldung").
 *   /stop    Automatik sofort aus (+ laufender Durchgang hoert vor der naechsten Nachricht auf)
 *   /status  Modus und letzter Durchgang
 * Nur Nachrichten aus TELEGRAM_CHAT_ID werden beachtet, alle anderen ignoriert.
 *
 * Einrichtung: npx tsx scripts/telegram-bot.mts --chat-id
 *   → zeigt die Chat-ID der letzten Nachricht an den Bot (vorher dem Bot "/start" schreiben).
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const { getUpdates, loadAutopilot, notify, statusText, updateAutopilot } = await import("../lib/tutor24-autopilot");
const { requestStop } = await import("../lib/tutor24-followup-store");

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN fehlt in .env.local");
  process.exit(1);
}

if (process.argv.includes("--chat-id")) {
  // Nur lesen, Offset nicht weiterschieben: der Bot sieht die Nachrichten spaeter trotzdem.
  const updates = await getUpdates(0, 0);
  const chats = new Map(updates.flatMap((u) => (u.message ? [[u.message.chat.id, u.message.from?.first_name ?? ""] as const] : [])));
  if (!chats.size) console.log('Keine Nachricht gefunden — schreib dem Bot zuerst "/start".');
  for (const [id, name] of chats) console.log(`Chat-ID ${id} (${name})`);
  process.exit(0);
}

const me = process.env.TELEGRAM_CHAT_ID;
if (!me) {
  console.error("TELEGRAM_CHAT_ID fehlt in .env.local (ermitteln mit --chat-id)");
  process.exit(1);
}

console.log("Telegram-Bot läuft. Befehle: /stop, /status");
for (;;) {
  try {
    const updates = await getUpdates(loadAutopilot().telegramOffset);
    for (const u of updates) {
      // Zuerst weiterschieben: ein Befehl, der abstuerzt, kommt nicht in einer Schleife wieder.
      updateAutopilot({ telegramOffset: u.update_id + 1 });
      const m = u.message;
      if (!m) continue;
      if (String(m.chat.id) !== me) {
        console.log(`Ignoriert: Nachricht aus fremdem Chat ${m.chat.id}`);
        continue;
      }
      const cmd = (m.text ?? "").trim().split(/[\s@]/)[0].toLowerCase();
      if (cmd === "/stop") {
        updateAutopilot({ modus: "aus", gestoppt: { grund: "per Telegram /stop", am: new Date().toISOString() } });
        requestStop();
        await notify("⛔ Automatik ist AUS. Ein laufender Durchgang hört vor der nächsten Nachricht auf.\nWieder einschalten auf /kurse.", me);
      } else if (cmd === "/status") {
        await notify(statusText(), me);
      } else {
        await notify("Befehle: /stop (Automatik aus), /status", me);
      }
    }
  } catch (err) {
    console.error(`${new Date().toLocaleTimeString("de-CH")} ${err instanceof Error ? err.message : String(err)} — neuer Versuch in 30 s`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
}
