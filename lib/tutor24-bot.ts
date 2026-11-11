/**
 * Befehle des Telegram-Bots (scripts/telegram-bot.mts). Alles Aeussere kommt ueber `deps`,
 * damit die Regeln mit simulierten Telegram-Nachrichten testbar sind (lib/tutor24-bot.test.ts).
 *
 * Sicherheit:
 * - nur der private Chat TELEGRAM_CHAT_ID; alles andere wird ignoriert (ohne Antwort)
 * - nur feste Befehle, nie Text als Shell-Befehl
 * - Befehle aelter als MAX_AGE_S werden ignoriert: nach einem Neustart startet ein altes /run nichts
 *   (doppelt zugestellte Updates haelt schon der gespeicherte Offset ab)
 * - /enable braucht "JA EINSCHALTEN" innerhalb von CONFIRM_S; die Bestaetigung lebt nur im Speicher,
 *   ein Neustart verwirft sie
 */
import {
  HELP_LINES,
  RATE_LIMIT_TEXT,
  activePause,
  fmtZurich,
  inSendWindow,
  nextScheduled,
  statusHtml,
  type AutoState,
  type PassLog,
  type TgUpdate,
} from "./tutor24-autopilot";
import { tooSoonText } from "./tutor24-lock";
import { parseRueckfrageKnopf } from "./tutor24-rueckfragen";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const MAX_AGE_S = 120;
export const CONFIRM_S = 120;
export const CONFIRM_WORD = "JA EINSCHALTEN";
/** Umfang von /run: hoechstens so viele Inserate, Chats und Nachfass-Kandidaten */
export const PROBE_MAX = 3;

export type BotDeps = {
  chatId: string;
  now: () => Date;
  reply: (html: string) => Promise<unknown>;
  state: () => AutoState;
  update: (patch: Partial<AutoState>) => AutoState;
  passes: () => PassLog[];
  /** wer gerade mit tutor24 arbeitet (Automatik-Lauf, Lauf von Hand), null = frei */
  busy: () => string | null;
  /** begrenzten Probelauf als eigenen Prozess starten (scripts/autopilot.mts --probe --max PROBE_MAX) */
  startProbe: () => void;
  /** Knopf "Jetzt starten": normaler Durchgang im eingestellten Modus (scripts/autopilot.mts --quelle knopf) */
  startPass: () => void;
  /** /erst N: nur Erst-Nachrichten, bis zu n (null = Tageslimit), im eingestellten Modus (scripts/autopilot.mts --erst n) */
  startErst?: (n: number | null) => void;
  /** Telegram: Knopf-Druck quittieren (sonst dreht sich die Uhr am Knopf) */
  answerCallback?: (id: string, text: string) => Promise<unknown>;
  /** Mindestabstand 2 h zum letzten tutor24-Lauf: frühester Start, null = erlaubt (lib/tutor24-lock.ts earliestNext) */
  gapUntil?: () => Date | null;
  /** laufenden Nachfass-Lauf vor der naechsten Nachricht anhalten (stop.request) */
  requestStop: () => void;
  /** Knopf einer Rueckfrage (lib/tutor24-rueckfragen.ts): Senden/Ueberspringen/du/Sie → Antwort als Klartext */
  rueckfrage?: (aktion: "send" | "skip" | "du" | "sie", id: string) => Promise<{ text: string; knoepfe?: object }>;
  /** Klartext mit Knoepfen (neuer Text nach Anrede-Wechsel) */
  replyKnoepfe?: (text: string, knoepfe: object) => Promise<unknown>;
};

const help = () => HELP_LINES.join("\n");

export const ERST_MAX = 20;
/**
 * "/erst" oder "/erst 5" (auch "/erst@Bot 5"), Zahl 1–ERST_MAX. Alles andere: null (keine freien Eingaben).
 * n = null heisst: Tageslimit.
 */
export function parseErst(text: string): { n: number | null } | null {
  const m = text.trim().match(/^\/erst(?:@\w+)?(?:\s+(\d{1,2}))?$/i);
  if (!m) return null;
  if (m[1] === undefined) return { n: null };
  const n = Number(m[1]);
  return n >= 1 && n <= ERST_MAX ? { n } : null;
}

/** Liefert eine Funktion pro Update; der Rueckgabewert beschreibt, was passiert ist (fuers Protokoll und die Tests). */
export function createBot(deps: BotDeps) {
  let pendingEnable: number | null = null;
  // Der gestartete Durchgang holt seine Sperre erst nach ein paar Sekunden: so lange gilt er schon als laufend.
  let spawnedAt = 0;
  /** zu früh nach dem letzten Lauf: Antwort und true */
  const tooSoon = async () => {
    const d = deps.gapUntil?.();
    if (d) await deps.reply(`⏳ Nicht gestartet. ${tooSoonText(d)}`);
    return !!d;
  };
  const busyNow = () => deps.busy() ?? (deps.now().getTime() - spawnedAt < 90_000 ? "Durchgang wurde eben gestartet" : null);

  /** Knopf "Jetzt starten": wie ein geplanter Durchgang — Modus, Tageslimits, 8–20 Uhr und 429-Pause gelten. */
  async function startNow(): Promise<string> {
    const s = deps.state();
    if (s.modus === "aus") {
      await deps.reply("🔴 Automatik ist aus — „Jetzt starten“ startet nichts. /run für einen Probelauf, /enable zum Einschalten.");
      return "start: aus";
    }
    const pause = activePause(deps.passes(), deps.now());
    if (pause) {
      await deps.reply(`⏸ ${RATE_LIMIT_TEXT}\nFrühester nächster Lauf: ${fmtZurich(pause)}. Nicht gestartet.`);
      return "start: 429-Pause";
    }
    if (await tooSoon()) return "start: zu früh";
    const running = busyNow();
    if (running) {
      await deps.reply(`Läuft schon: ${running}. Kein zweiter Lauf gestartet.`);
      return "start: belegt";
    }
    deps.startPass();
    spawnedAt = deps.now().getTime();
    const h = deps.now().getHours();
    await deps.reply(
      `▶️ <b>Durchgang gestartet</b> (${s.modus === "probe" ? "Probe — sendet nichts" : "EIN — sendet"}).\n` +
        (s.modus === "an" && (h < 8 || h >= 20) ? "Ausserhalb 8–20 Uhr: er liest nur und sendet nichts.\n" : "") +
        "Tageslimits gelten. Schritte: 1 neue Inserate · 2 Antworten prüfen · 3 Nachfassen — ich melde mich nach jedem Schritt und am Ende."
    );
    return "start: gestartet";
  }

  /** Rueckfrage-Knopf (direkt oder vom Webhook als Befehl "rf:send:123"): anwenden, Antwort schicken */
  async function rueckfrage(data: string): Promise<string> {
    const k = parseRueckfrageKnopf(data);
    if (!k) return "ignoriert: unbekannter Knopf";
    if (!deps.rueckfrage) return "rueckfrage: nicht eingerichtet";
    const r = await deps.rueckfrage(k.aktion, k.id);
    if (r.knoepfe && deps.replyKnoepfe) await deps.replyKnoepfe(r.text, r.knoepfe);
    else await deps.reply(esc(r.text));
    return `rueckfrage: ${k.aktion} ${k.id}`;
  }

  return async function handle(u: TgUpdate): Promise<string> {
    const cb = u.callback_query;
    if (cb) {
      if (String(cb.from.id) !== deps.chatId || (cb.message && String(cb.message.chat.id) !== deps.chatId)) return `ignoriert: fremder Knopf ${cb.from.id}`;
      const rf = parseRueckfrageKnopf(cb.data);
      await deps.answerCallback?.(cb.id, cb.data === "start" ? "Wird gestartet …" : rf ? "Wird angewendet …" : "Unbekannter Knopf");
      if (rf) return rueckfrage(cb.data ?? "");
      return cb.data === "start" ? startNow() : "ignoriert: unbekannter Knopf";
    }
    const m = u.message;
    if (!m) return "ignoriert: keine Nachricht";
    if (String(m.chat.id) !== deps.chatId || (m.chat.type && m.chat.type !== "private")) return `ignoriert: fremder Chat ${m.chat.id}`;
    const now = deps.now().getTime();
    if (now - m.date * 1000 > MAX_AGE_S * 1000) return "ignoriert: zu alt";

    const text = (m.text ?? "").trim();
    // Bestaetigung fuer /enable: genau das Wort, rechtzeitig, und nach der Aufforderung geschrieben.
    if (pendingEnable !== null && text.toUpperCase() === CONFIRM_WORD) {
      const asked = pendingEnable;
      pendingEnable = null;
      // asked = Zeitpunkt der /enable-Nachricht: auch richtig, wenn beide zusammen aus der Datenbank kommen.
      if (m.date * 1000 - asked > CONFIRM_S * 1000 || now - asked > (CONFIRM_S + MAX_AGE_S) * 1000 || m.date * 1000 < asked) {
        await deps.reply("Bestätigung abgelaufen. Bitte nochmals /enable senden.");
        return "enable: abgelaufen";
      }
      deps.update({ modus: "an", gestoppt: null, letzterFehler: null });
      const pause = activePause(deps.passes(), deps.now());
      await deps.reply(
        "🟢 <b>Automatik ist EIN.</b>\n" +
          "Jetzt wird nichts gesendet. Gesendet wird erst beim nächsten geplanten Lauf " +
          `(${fmtZurich(nextScheduled(pause ?? deps.now()))}${pause ? ", nach der 429-Pause" : ""}), ` +
          "sofern die Windows-Aufgabe „Mathetogo tutor24 Automatik“ eingerichtet ist.\n/stop schaltet wieder aus."
      );
      return "enable: eingeschaltet";
    }
    const cmd = text.split(/[\s@]/)[0].toLowerCase();
    if (cmd !== "") pendingEnable = null;

    // "start" und "rf:…" kommen vom Webhook auf Vercel (Knopf, als Befehl in die Datenbank gelegt)
    if (cmd === "start") return startNow();
    if (cmd.startsWith("rf:")) return rueckfrage(cmd);

    if (cmd === "/status") {
      await deps.reply(statusHtml(deps.state(), deps.passes(), deps.now()));
      return "status";
    }

    if (cmd === "/stop") {
      deps.update({ modus: "aus", gestoppt: { grund: "per Telegram /stop", am: deps.now().toISOString() } });
      const running = busyNow();
      deps.requestStop();
      await deps.reply(
        "🔴 <b>Automatik ist AUS</b> — dauerhaft, bis du sie mit /enable oder auf /kurse wieder einschaltest.\n" +
          (running
            ? `Gerade läuft: ${running}. Er liest den Schalter vor jeder einzelnen Nachricht und direkt vor dem Senden erneut und sendet danach nichts mehr. Eine Nachricht, die in dieser Sekunde schon abgeschickt wird, kann noch ankommen.\n`
            : "Gerade läuft nichts.\n") +
          "Geplante Läufe starten weiterhin, beenden sich aber sofort ohne Abruf.\n" +
          "Nicht betroffen: ein von Hand auf /tutor24 gestarteter Erst-Nachrichten-Lauf."
      );
      return "stop";
    }

    if (cmd === "/run") {
      const pause = activePause(deps.passes(), deps.now());
      if (pause) {
        await deps.reply(`⏸ ${RATE_LIMIT_TEXT}\nFrühester nächster Lauf: ${fmtZurich(pause)}. Probelauf nicht gestartet.`);
        return "run: 429-Pause";
      }
      if (await tooSoon()) return "run: zu früh";
      const running = busyNow();
      if (running) {
        await deps.reply(`Läuft schon: ${running}. Kein zweiter Lauf gestartet.`);
        return "run: belegt";
      }
      deps.startProbe();
      spawnedAt = deps.now().getTime();
      await deps.reply(
        `🧪 <b>Probelauf gestartet</b> — sendet nichts.\nHöchstens ${PROBE_MAX} Inserate, ${PROBE_MAX} Chats bei „Antworten prüfen“ und ${PROBE_MAX} Nachfass-Kandidaten; Listen nur kurz nachgeladen.\nDas Ergebnis kommt als eigene Meldung; danach /status.`
      );
      return "run: gestartet";
    }

    if (cmd === "/erst") {
      const p = parseErst(text);
      if (!p || !deps.startErst) {
        await deps.reply(`So geht es: /erst (bis zum Tageslimit) oder /erst 5 (1 bis ${ERST_MAX}).`);
        return "erst: ungültig";
      }
      const s = deps.state();
      if (s.modus === "aus") {
        await deps.reply("🔴 Automatik ist aus — /erst startet nichts. /enable zum Einschalten.");
        return "erst: aus";
      }
      const pause = activePause(deps.passes(), deps.now());
      if (pause) {
        await deps.reply(`⏸ ${RATE_LIMIT_TEXT}\nFrühester nächster Lauf: ${fmtZurich(pause)}. Nicht gestartet.`);
        return "erst: 429-Pause";
      }
      if (await tooSoon()) return "erst: zu früh";
      if (s.modus === "an" && !inSendWindow(deps.now())) {
        await deps.reply("Ausserhalb 8–20 Uhr wird nichts gesendet — nicht gestartet.");
        return "erst: ausserhalb 8–20 Uhr";
      }
      const running = busyNow();
      if (running) {
        await deps.reply(`Läuft schon: ${running}. Kein zweiter Lauf gestartet.`);
        return "erst: belegt";
      }
      deps.startErst(p.n);
      spawnedAt = deps.now().getTime();
      await deps.reply(
        `✉️ <b>Erst-Nachrichten gestartet</b> (${s.modus === "probe" ? "Probe — sendet nichts" : "EIN — sendet"}): bis zu ${p.n ?? "Tageslimit"} neue Inserate${p.n ? " (höchstens bis zum Tageslimit)" : ""}.\n` +
          "Ich melde mich am Ende mit Anzahl, davon mit Kursblock und mit Hinweis."
      );
      return "erst: gestartet";
    }

    if (cmd === "/enable") {
      if (deps.state().modus === "an") {
        await deps.reply("Die Automatik ist schon EIN.");
        return "enable: schon an";
      }
      pendingEnable = m.date * 1000;
      await deps.reply(
        `Automatik dauerhaft einschalten? Ab dem nächsten geplanten Lauf werden echte Nachrichten gesendet.\nZum Bestätigen innerhalb von ${CONFIRM_S / 60} Minuten antworten mit:\n<b>${CONFIRM_WORD}</b>`
      );
      return "enable: frage";
    }

    await deps.reply(help());
    return "hilfe";
  };
}
