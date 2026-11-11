import { describe, expect, it } from "vitest";
import { createWebhook } from "./tutor24-webhook";
import type { TgUpdate } from "./tutor24-autopilot";
import type { LaptopSignal } from "./tutor24-watch";

const ME = "4711";
const NOW = new Date("2026-11-06T09:00:00Z"); // Fr 10:00 Zuerich

function setup(laptop: LaptopSignal | null) {
  const queued: [string, string][] = [];
  const replies: string[] = [];
  const answers: string[] = [];
  const handle = createWebhook({
    chatId: ME,
    now: () => NOW,
    laptop: async () => laptop,
    passes: async () => [],
    queue: async (id, cmd) => (queued.some(([i]) => i === id) ? false : (queued.push([id, cmd]), true)),
    reply: async (t) => void replies.push(t),
    answerCallback: async (_id, t) => void answers.push(t),
  });
  let n = 1;
  const msg = (text: string, o: { chat?: number; ageS?: number } = {}): TgUpdate => ({
    update_id: n++,
    message: { date: NOW.getTime() / 1000 - (o.ageS ?? 0), text, chat: { id: o.chat ?? Number(ME), type: "private" } },
  });
  const press = (from = Number(ME), id = "c1"): TgUpdate => ({ update_id: n++, callback_query: { id, data: "start", from: { id: from }, message: { chat: { id: from } } } });
  return { handle, queued, replies, answers, msg, press };
}

const on: LaptopSignal = { at: "2026-11-06T08:58:00Z", modus: "probe", gestoppt: null, pauseBis: null };
const off: LaptopSignal = { ...on, at: "2026-11-06T07:12:00Z" };

describe("Telegram-Webhook (Vercel)", () => {
  it("Laptop aus: Knopf und /run sagen sofort 'offline', nichts wird weitergegeben", async () => {
    const w = setup(off);
    expect(await w.handle(w.press())).toBe("start: offline");
    expect(w.answers).toEqual(["Laptop ist offline"]);
    expect(w.replies[0]).toContain("Laptop ist seit Fr., 06.11.2026, 08:12 offline");
    expect(await w.handle(w.msg("/run"))).toBe("/run: offline");
    expect(await w.handle(w.msg("/enable"))).toBe("/enable: offline");
    expect(w.queued).toEqual([]);
  });

  it("Laptop aus: /stop wird gemerkt und gilt beim naechsten Start", async () => {
    const w = setup(off);
    expect(await w.handle(w.msg("/stop"))).toBe("stop: gemerkt (offline)");
    expect(w.queued).toEqual([["u:1", "/stop"]]);
    expect(w.replies[0]).toContain("bevor ein Durchgang startet");
  });

  it("Laptop an: Knopf, /run, /enable und Bestaetigung gehen an den Laptop; doppelt zugestellt nur einmal", async () => {
    const w = setup(on);
    expect(await w.handle(w.press())).toBe("start: weitergegeben");
    expect(await w.handle(w.press(Number(ME), "c1"))).toBe("start: doppelt");
    await w.handle(w.msg("/run"));
    await w.handle(w.msg("/enable"));
    await w.handle(w.msg("ja einschalten"));
    expect(w.queued.map(([, c]) => c)).toEqual(["start", "/run", "/enable", "JA EINSCHALTEN"]);
  });

  it("Rueckfrage-Knoepfe gehen geprueft an den Laptop; offline bleibt die Rueckfrage offen; fremde Daten nicht", async () => {
    const w = setup(on);
    const press = (data: string, id = "r1"): TgUpdate => ({ update_id: 50, callback_query: { id, data, from: { id: Number(ME) }, message: { chat: { id: Number(ME) } } } });
    expect(await w.handle(press("rf:send:6302015"))).toBe("rf:send:6302015: weitergegeben");
    expect(await w.handle(press("rf:du:6302015", "r2"))).toBe("rf:du:6302015: weitergegeben");
    expect(await w.handle(press("rf:send:6302015; drop", "r3"))).toBe("ignoriert: unbekannter Knopf");
    expect(w.queued.map(([, c]) => c)).toEqual(["rf:send:6302015", "rf:du:6302015"]);
    const o = setup(off);
    expect(await o.handle(press("rf:skip:1"))).toBe("rf:skip:1: offline");
    expect(o.replies[0]).toMatch(/bleibt offen; bis 20 Uhr/);
    expect(o.queued).toHaveLength(0);
  });
  it("/status antwortet auch offline, mit Laptop-Zeile", async () => {
    const w = setup(off);
    await w.handle(w.msg("/status"));
    const lines = w.replies[0].split("\n");
    expect(lines[0]).toBe("<b>Mathetogo · tutor24</b>");
    expect(lines[1]).toContain("Laptop ist seit");
    expect(w.replies[0]).toContain("🟡 <b>Probe-Modus (sendet nichts)</b>");
    expect(w.replies[0]).toContain("Noch kein Lauf erfasst");
  });

  it("/status zeigt einen laufenden Durchgang; alter Stand (abgestuerzt) nicht", async () => {
    const { remoteStatus } = await import("./tutor24-webhook");
    const p = { start: "2026-11-06T08:41:00Z", modus: "probe" as const, schritt: "1/3 Kandidaten suchen", zaehler: "31 von 40", at: "2026-11-06T08:57:00Z" };
    const s = remoteStatus(on, [], NOW, p);
    expect(s).toContain("⏳ <b>Durchgang läuft gerade</b> (Probe, sendet nichts) · seit 09:41 (19 min)");
    expect(s).toContain("Schritt 1/3 Kandidaten suchen · 31 von 40");
    expect(remoteStatus(on, [], NOW, { ...p, at: "2026-11-06T08:45:00Z" })).not.toContain("läuft gerade");
    expect(remoteStatus(on, [], NOW, null)).not.toContain("läuft gerade");
  });

  it("fremde Chats, fremde Knoepfe, alte Befehle: nichts", async () => {
    const w = setup(on);
    expect(await w.handle(w.msg("/run", { chat: 1 }))).toBe("ignoriert: fremder Chat");
    expect(await w.handle(w.press(1))).toBe("ignoriert: fremder Knopf");
    expect(await w.handle(w.msg("/run", { ageS: 600 }))).toBe("ignoriert: zu alt");
    expect(w.queued).toEqual([]);
    expect(w.replies).toEqual([]);
  });
});

describe("Webhook: /erst", () => {
  it("nur die gepruefte Zahl geht an den Laptop; offline sofort 'offline'", async () => {
    const w = setup(on);
    expect(await w.handle(w.msg("/erst 5"))).toBe("/erst: weitergegeben");
    expect(await w.handle(w.msg("/erst"))).toBe("/erst: weitergegeben");
    expect(await w.handle(w.msg("/erst 5; rm -rf"))).toBe("erst: ungültig");
    expect(w.queued.map(([, c]) => c)).toEqual(["/erst 5", "/erst"]);
    const o = setup(off);
    expect(await o.handle(o.msg("/erst 3"))).toBe("/erst: offline");
    expect(o.replies[0]).toContain("Laptop ist seit");
    expect(o.queued).toEqual([]);
  });
});
