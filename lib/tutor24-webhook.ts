/**
 * Telegram-Webhook auf Vercel (app/api/telegram/webhook): nimmt jede Nachricht und jeden Knopf-Druck an,
 * auch wenn der Laptop aus ist.
 * - /status beantwortet er selbst (aus der Datenbank)
 * - /run, /enable, die Bestaetigung und "Jetzt starten" gibt er an den Laptop weiter (Tutor24Command) —
 *   ist der Laptop offline, sagt er das sofort, statt dass nichts passiert
 * - /stop merkt er sich immer; der Laptop wendet ihn an, sobald er an ist, vor jedem Durchgang
 * Gleiche Schutzregeln wie der Laptop-Bot (lib/tutor24-bot.ts): nur mein privater Chat, keine alten Befehle.
 */
import { CONFIRM_WORD, MAX_AGE_S } from "./tutor24-bot";
import { HELP_LINES, fmtZurich, statusHtml, type AutoState, type PassLog, type TgUpdate } from "./tutor24-autopilot";
import { laptopOnline, offlineText, type LaptopSignal } from "./tutor24-watch";

export type WebhookDeps = {
  chatId: string;
  now: () => Date;
  laptop: () => Promise<LaptopSignal | null>;
  passes: () => Promise<PassLog[]>;
  /** false = gab es schon (doppelt zugestellt) */
  queue: (id: string, cmd: string) => Promise<boolean>;
  reply: (html: string) => Promise<unknown>;
  answerCallback: (id: string, text: string) => Promise<unknown>;
};

const FORWARD = new Set(["/run", "/enable"]);

/** /status ohne Laptop: Zustand aus dem letzten Lebenszeichen, Laeufe aus Tutor24Run */
export function remoteStatus(l: LaptopSignal | null, passes: PassLog[], now: Date): string {
  const state: AutoState = { modus: l?.modus ?? "aus", gestoppt: l?.gestoppt ?? null, letzterFehler: null, zusammenfassungAm: null, telegramOffset: 0 };
  const laptop = laptopOnline(l, now) ? "💻 Laptop ist an." : `💻 ${offlineText(l)}`;
  const [head, ...rest] = statusHtml(state, passes, now).split("\n");
  return [head, laptop, ...rest].join("\n");
}

export function createWebhook(deps: WebhookDeps) {
  return async function handle(u: TgUpdate): Promise<string> {
    const l = await deps.laptop();
    const now = deps.now();
    const online = laptopOnline(l, now);
    // "offline" heisst: kein Lebenszeichen seit 6 min — aus, im Ruhezustand oder ohne Internet (WLAN).
    const offline = `💻 ${offlineText(l)} Er ist aus, schläft oder hat kein Internet (WLAN prüfen). Sobald er wieder verbunden ist, meldet er sich innert 2 Minuten; dann nochmals versuchen.`;

    const cb = u.callback_query;
    if (cb) {
      if (String(cb.from.id) !== deps.chatId || (cb.message && String(cb.message.chat.id) !== deps.chatId)) return "ignoriert: fremder Knopf";
      if (cb.data !== "start") {
        await deps.answerCallback(cb.id, "Unbekannter Knopf");
        return "ignoriert: unbekannter Knopf";
      }
      if (!online) {
        await deps.answerCallback(cb.id, "Laptop ist offline");
        await deps.reply(offline);
        return "start: offline";
      }
      const fresh = await deps.queue(`cb:${cb.id}`, "start");
      await deps.answerCallback(cb.id, fresh ? "An den Laptop übergeben …" : "Schon übergeben");
      return fresh ? "start: weitergegeben" : "start: doppelt";
    }

    const m = u.message;
    if (!m) return "ignoriert: keine Nachricht";
    if (String(m.chat.id) !== deps.chatId || (m.chat.type && m.chat.type !== "private")) return "ignoriert: fremder Chat";
    if (now.getTime() - m.date * 1000 > MAX_AGE_S * 1000) return "ignoriert: zu alt";
    const text = (m.text ?? "").trim();
    const cmd = text.split(/[\s@]/)[0].toLowerCase();
    const id = `u:${u.update_id}`;

    if (cmd === "/status") {
      await deps.reply(remoteStatus(l, await deps.passes(), now));
      return "status";
    }
    if (cmd === "/stop") {
      // immer merken: der Laptop wendet den Stopp an, sobald er an ist (auch vor einem nachgeholten Durchgang)
      if (!(await deps.queue(id, "/stop"))) return "stop: doppelt";
      if (!online) {
        await deps.reply(
          `🔴 Stopp ist gemerkt. ${offlineText(l)}\nSobald er an ist, wird die Automatik ausgeschaltet, bevor ein Durchgang startet${l ? ` (Stand ${fmtZurich(new Date(l.at))}: ${l.modus.toUpperCase()})` : ""}.`
        );
        return "stop: gemerkt (offline)";
      }
      return "stop: weitergegeben";
    }
    if (FORWARD.has(cmd) || text.toUpperCase() === CONFIRM_WORD) {
      if (!online) {
        await deps.reply(offline);
        return `${cmd || "bestaetigung"}: offline`;
      }
      return (await deps.queue(id, FORWARD.has(cmd) ? cmd : CONFIRM_WORD)) ? `${cmd || "bestaetigung"}: weitergegeben` : "doppelt";
    }
    await deps.reply(HELP_LINES.join("\n"));
    return "hilfe";
  };
}
