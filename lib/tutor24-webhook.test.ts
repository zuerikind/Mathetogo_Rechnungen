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

  it("/status antwortet auch offline, mit Laptop-Zeile", async () => {
    const w = setup(off);
    await w.handle(w.msg("/status"));
    const lines = w.replies[0].split("\n");
    expect(lines[0]).toBe("<b>Mathetogo · tutor24</b>");
    expect(lines[1]).toContain("Laptop ist seit");
    expect(w.replies[0]).toContain("🟡 <b>Probe-Modus (sendet nichts)</b>");
    expect(w.replies[0]).toContain("Noch kein Lauf erfasst");
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
