import { describe, expect, it } from "vitest";
import { CONFIRM_WORD, createBot } from "./tutor24-bot";
import {
  RATE_LIMIT_TEXT,
  emptyCounts,
  nextScheduled,
  statusHtml,
  stopReason,
  type AutoState,
  type PassLog,
  type TgUpdate,
} from "./tutor24-autopilot";

const ME = "4711";
// Simulierte tutor24-Antwort: genau der Text vom 5.11.2026, 12:29
const PAGE_429 =
  "Fehlermeldung «429 Too Many Requests You have sent too many requests in a given amount of time.» auf der Seite (Inserat 6289130): https://tutor24.ch/de/jobs/6289130";

const pass = (start: Date, p: Partial<PassLog> = {}): PassLog => ({
  start: start.toISOString(), ende: new Date(start.getTime() + 60_000).toISOString(), modus: "probe",
  erst: emptyCounts(), nachfassen: emptyCounts(), antworten: 0, fehler: [], stopp: null, ...p,
});

function setup(now: Date, passes: PassLog[] = [], busy: string | null = null) {
  let state: AutoState = { modus: "aus", gestoppt: null, letzterFehler: null, zusammenfassungAm: null, telegramOffset: 0 };
  const replies: string[] = [];
  const calls = { probe: 0, stop: 0, pass: 0, answered: 0 };
  const clock = { now };
  const deps = {
    chatId: ME,
    now: () => clock.now,
    reply: async (t: string) => void replies.push(t),
    state: () => state,
    update: (p: Partial<AutoState>) => (state = { ...state, ...p }),
    passes: () => passes,
    busy: () => busy,
    startProbe: () => void calls.probe++,
    startPass: () => void calls.pass++,
    requestStop: () => void calls.stop++,
    answerCallback: async () => void calls.answered++,
  };
  let id = 1;
  const msg = (text: string, o: { chat?: number; type?: string; ageS?: number } = {}): TgUpdate => ({
    update_id: id++,
    message: { date: Math.floor(clock.now.getTime() / 1000) - (o.ageS ?? 0), text, chat: { id: o.chat ?? Number(ME), type: o.type ?? "private" } },
  });
  return { handle: createBot(deps), deps, replies, calls, clock, msg, get state() { return state; } };
}

const NOW = new Date(2026, 10, 5, 15, 0); // Do 5.11.2026 15:00 (Ortszeit = Europe/Zurich)

describe("Telegram-Bot", () => {
  it("nur mein privater Chat; alte Befehle nach einem Neustart starten nichts", async () => {
    const b = setup(NOW);
    expect(await b.handle(b.msg("/run", { chat: 999 }))).toMatch(/fremder Chat/);
    expect(await b.handle(b.msg("/run", { type: "group" }))).toMatch(/fremder Chat/);
    expect(await b.handle(b.msg("/run", { ageS: 600 }))).toBe("ignoriert: zu alt");
    expect(await b.handle(b.msg(`/enable`, { ageS: 600 }))).toBe("ignoriert: zu alt");
    expect(b.calls.probe).toBe(0);
    expect(b.replies).toEqual([]);
    expect(b.state.modus).toBe("aus");
  });

  it("/status ohne Lauf und Hilfe nur mit echten Befehlen", async () => {
    const b = setup(NOW);
    await b.handle(b.msg("/status"));
    const t = b.replies[0];
    expect(t).toContain("<b>Mathetogo · tutor24</b>\n🔴 <b>Automatik ausgeschaltet</b>");
    expect(t).toContain("Noch kein Lauf erfasst");
    expect(t).toContain("/run startet einen Probelauf ohne Versand.");
    expect(t).toContain("/stop schaltet die Automatik aus.");
    const commands = t.match(/^\/\w+/gm) ?? [];
    expect(commands.sort()).toEqual(["/enable", "/run", "/status", "/stop"]);
    await b.handle(b.msg("/irgendwas; rm -rf /"));
    expect(b.replies[1]).not.toContain("rm");
    expect(b.calls).toEqual({ probe: 0, stop: 0, pass: 0, answered: 0 });
  });

  it("429 von tutor24: Stopp, Meldung, Pause; /run erst danach", async () => {
    expect(stopReason({ pruefungFehler: 0, fehler: PAGE_429, letzterFehler: null })).toMatch(/^tutor24:/);
    const hit = pass(new Date(2026, 10, 5, 12, 28), { fehler: [PAGE_429], stopp: `tutor24: ${PAGE_429}` });
    const b = setup(NOW, [hit]);
    await b.handle(b.msg("/status"));
    expect(b.replies[0]).toContain(`<b>Ergebnis</b> ${RATE_LIMIT_TEXT}`);
    expect(b.replies[0].split(RATE_LIMIT_TEXT).length).toBe(2); // nur einmal
    // Nach einem spaeteren Lauf ohne 429 (z.B. Lauf von Hand), aber noch in der Pause: Hinweis eigens
    const later = statusHtml(b.state, [hit, pass(new Date(2026, 10, 5, 14, 0))], NOW);
    expect(later).toContain(`⏸ ${RATE_LIMIT_TEXT}`);
    expect(b.replies[0]).toMatch(/<b>Frühester nächster Lauf<\/b> Fr\.?,? 06\.11\.2026,? 00:29/);
    expect(b.replies[0]).toContain("<b>Gesendete Nachrichten</b> 0 (Probe: 0 wären gesendet worden)");
    expect(await b.handle(b.msg("/run"))).toBe("run: 429-Pause");
    expect(b.calls.probe).toBe(0);
    b.clock.now = new Date(2026, 10, 6, 0, 30);
    expect(await b.handle(b.msg("/run"))).toBe("run: gestartet");
    expect(b.calls.probe).toBe(1);
  });

  it("/run startet keinen zweiten Lauf", async () => {
    const b = setup(NOW, [], "Automatik-Durchgang");
    expect(await b.handle(b.msg("/run"))).toBe("run: belegt");
    expect(b.calls.probe).toBe(0);
  });

  it("/stop: dauerhaft aus, laufender Lauf wird angehalten, Antwort sagt was passiert", async () => {
    const b = setup(NOW, [], "Automatik-Durchgang");
    b.deps.update({ modus: "an" });
    await b.handle(b.msg("/stop"));
    expect(b.state.modus).toBe("aus");
    expect(b.state.gestoppt?.grund).toBe("per Telegram /stop");
    expect(b.calls.stop).toBe(1);
    expect(b.replies[0]).toContain("Automatik ist AUS");
    expect(b.replies[0]).toContain("Gerade läuft: Automatik-Durchgang");
    expect(b.replies[0]).toContain("vor jeder einzelnen Nachricht und direkt vor dem Senden");
  });

  it("/enable nur mit Bestaetigung, rechtzeitig, ohne sofortigen Lauf", async () => {
    const b = setup(NOW);
    // Bestaetigung ohne vorheriges /enable: nichts
    await b.handle(b.msg(CONFIRM_WORD));
    expect(b.state.modus).toBe("aus");
    // /enable, dann anderer Befehl: Bestaetigung verfaellt
    await b.handle(b.msg("/enable"));
    await b.handle(b.msg("/status"));
    await b.handle(b.msg(CONFIRM_WORD));
    expect(b.state.modus).toBe("aus");
    // zu spaet
    await b.handle(b.msg("/enable"));
    b.clock.now = new Date(NOW.getTime() + 3 * 60_000);
    expect(await b.handle(b.msg(CONFIRM_WORD))).toBe("enable: abgelaufen");
    expect(b.state.modus).toBe("aus");
    // richtig
    await b.handle(b.msg("/enable"));
    expect(await b.handle(b.msg("ja einschalten"))).toBe("enable: eingeschaltet");
    expect(b.state.modus).toBe("an");
    expect(b.calls.probe).toBe(0);
    expect(b.replies[b.replies.length - 1]).toContain("Jetzt wird nichts gesendet");
    // Neustart des Bots: offene Bestaetigung ist weg
    const c = setup(NOW);
    await c.handle(c.msg("/enable"));
    const restarted = createBot(c.deps);
    await restarted(c.msg(CONFIRM_WORD));
    expect(c.state.modus).toBe("aus");
  });

  it("Knopf 'Jetzt starten': Modus, 429-Pause und laufender Lauf gelten; fremde Knoepfe nicht", async () => {
    const press = (from = Number(ME)): TgUpdate => ({ update_id: 1, callback_query: { id: "cb", data: "start", from: { id: from }, message: { chat: { id: from } } } });
    const b = setup(NOW);
    expect(await b.handle(press(999))).toMatch(/fremder Knopf/);
    expect(await b.handle(press())).toBe("start: aus"); // Automatik aus: nichts
    expect(b.calls.answered).toBe(1); // trotzdem quittiert
    b.deps.update({ modus: "probe" });
    expect(await b.handle(press())).toBe("start: gestartet");
    expect(b.calls.pass).toBe(1);
    expect(b.replies[b.replies.length - 1]).toContain("Probe — sendet nichts");
    expect(b.replies[b.replies.length - 1]).toContain("ich melde mich nach jedem Schritt");
    // zweimal schnell gedrueckt (Sperre noch nicht geholt): kein zweiter Start
    expect(await b.handle(press())).toBe("start: belegt");
    expect(b.replies[b.replies.length - 1]).toContain("eben gestartet");
    expect(b.calls.pass).toBe(1);
    // als Befehl aus der Datenbank (Webhook) genauso, sobald die 90 s vorbei sind
    const later = setup(new Date(NOW.getTime() + 91_000));
    later.deps.update({ modus: "probe" });
    expect(await later.handle(later.msg("start"))).toBe("start: gestartet");
    const busy = setup(NOW, [], "Automatik-Durchgang");
    busy.deps.update({ modus: "an" });
    expect(await busy.handle(press())).toBe("start: belegt");
    const hit = pass(new Date(2026, 10, 5, 12, 28), { stopp: "tutor24: 429 Too Many Requests" });
    const paused = setup(NOW, [hit]);
    paused.deps.update({ modus: "an" });
    expect(await paused.handle(press())).toBe("start: 429-Pause");
    expect(paused.calls.pass + busy.calls.pass).toBe(0);
  });

  it("naechster geplanter Lauf 9 und 17 Uhr", () => {
    expect(nextScheduled(new Date(2026, 10, 5, 8, 0)).getHours()).toBe(9);
    expect(nextScheduled(new Date(2026, 10, 5, 13, 0)).getHours()).toBe(17);
    expect(nextScheduled(new Date(2026, 10, 5, 17, 1))).toEqual(new Date(2026, 10, 6, 9, 0));
  });

  it("/status nach einem normalen Lauf", () => {
    const ok = pass(new Date(2026, 10, 5, 9, 0), { modus: "an", erst: { ...emptyCounts(), gesendet: 4 }, nachfassen: { ...emptyCounts(), gesendet: 2 }, antworten: 1 });
    const t = statusHtml({ modus: "an", gestoppt: null, letzterFehler: null, zusammenfassungAm: null, telegramOffset: 0 }, [ok], NOW);
    expect(t).toContain("🟢 <b>Automatik eingeschaltet</b>");
    expect(t).toContain("<b>Ergebnis</b> Ohne Fehler · 1 neue Antwort");
    expect(t).toContain("<b>Gesendete Nachrichten</b> 6 (Erst-Nachricht 4 · Nachfassen 2)");
    expect(t).toMatch(/<b>Nächster geplanter Lauf<\/b> Do\.?,? 05\.11\.2026,? 17:00/);
  });
});
