import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Alles, was die beiden offenen Routen ausloesen koennten: Datenbank und Telegram.
vi.mock("@/lib/tutor24-watch-db", () => ({
  readLaptop: vi.fn(async () => null),
  runsSince: vi.fn(async () => []),
  readReminders: vi.fn(async () => []),
  markReminder: vi.fn(async () => {}),
  lastPasses: vi.fn(async () => []),
  readProgress: vi.fn(async () => null),
  queueCommand: vi.fn(async () => true),
}));
vi.mock("@/lib/tutor24-autopilot", async (orig) => ({
  ...(await orig<typeof import("@/lib/tutor24-autopilot")>()),
  notify: vi.fn(async () => {}),
  answerCallback: vi.fn(async () => {}),
}));

import * as db from "@/lib/tutor24-watch-db";
import * as ap from "@/lib/tutor24-autopilot";
import { isOpenPath, secretOk } from "./open-routes";
import * as watch from "@/app/api/tutor24/watch/route";
import * as webhook from "@/app/api/telegram/webhook/route";

const ME = "4711";
const SIDE_EFFECTS = [db.readLaptop, db.runsSince, db.readReminders, db.markReminder, db.lastPasses, db.readProgress, db.queueCommand, ap.notify, ap.answerCallback];

function req(path: string, headers: Record<string, string>, body?: unknown, method = "POST") {
  return new NextRequest(`https://app.example${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}
const tgMsg = (text: string, chat = Number(ME)) => ({
  update_id: 1,
  message: { date: Math.floor(Date.now() / 1000), text, chat: { id: chat, type: "private" } },
});
const nothingHappened = () => SIDE_EFFECTS.forEach((f) => expect(f).not.toHaveBeenCalled());

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WATCH_SECRET", "w-geheim-123");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "t-geheim-456");
  vi.stubEnv("TELEGRAM_CHAT_ID", ME);
});

describe("middleware: nur zwei Adressen ohne Login", () => {
  it("offen: genau Webhook und Waechter (plus Login/NextAuth wie bisher)", () => {
    for (const p of ["/api/telegram/webhook", "/api/tutor24/watch", "/login", "/api/auth/session"]) expect(isOpenPath(p)).toBe(true);
  });
  it("alles andere braucht eine Sitzung, auch aehnliche Pfade", () => {
    for (const p of [
      "/", "/kurse", "/rechnungen", "/api/invoices", "/api/invoice/generate", "/api/students", "/api/tutor24/followup",
      "/api/telegram", "/api/telegram/webhook/x", "/api/telegram/webhookx", "/api/tutor24/watch/x", "/api/tutor24/watchx",
      "/api/tutor24", "/API/telegram/webhook", "/api/telegram/webhook/../../invoices", "/api/tutor24/erst",
    ])
      expect(isOpenPath(p), p).toBe(false);
  });
});

describe("Waechter /api/tutor24/watch ohne richtiges Geheimnis", () => {
  const bad: [string, Record<string, string>][] = [
    ["ohne Kopf", {}],
    ["falsches Geheimnis", { authorization: "Bearer falsch" }],
    ["Geheimnis ohne Bearer", { authorization: "w-geheim-123" }],
    ["Geheimnis mit Anhang", { authorization: "Bearer w-geheim-123x" }],
    ["Telegram-Geheimnis", { authorization: "Bearer t-geheim-456" }],
  ];
  for (const [name, headers] of bad)
    for (const method of ["GET", "POST"] as const)
      it(`${method} ${name}: 401, verraet nichts, loest nichts aus`, async () => {
        const res = await watch[method](req("/api/tutor24/watch", headers, undefined, method));
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "Unauthorized" });
        nothingHappened();
      });

  it("WATCH_SECRET nicht gesetzt: auch 'Bearer undefined' oder 'Bearer ' gehen nicht", async () => {
    vi.stubEnv("WATCH_SECRET", "");
    for (const a of ["Bearer undefined", "Bearer ", "Bearer"]) expect((await watch.POST(req("/api/tutor24/watch", { authorization: a }))).status).toBe(401);
    nothingHappened();
  });

  it("Gegenprobe: mit richtigem Geheimnis laeuft die Pruefung", async () => {
    const res = await watch.POST(req("/api/tutor24/watch", { authorization: "Bearer w-geheim-123" }));
    expect(res.status).toBe(200);
  });
});

describe("Telegram-Webhook /api/telegram/webhook ohne richtiges Geheimnis", () => {
  const bad: [string, Record<string, string>][] = [
    ["ohne Kopf", {}],
    ["falsches Geheimnis", { "x-telegram-bot-api-secret-token": "falsch" }],
    ["Waechter-Geheimnis", { "x-telegram-bot-api-secret-token": "w-geheim-123" }],
    ["richtiges Geheimnis im falschen Kopf", { authorization: "Bearer t-geheim-456" }],
  ];
  for (const [name, headers] of bad)
    it(`${name}: 401, kein Befehl, keine Antwort`, async () => {
      const res = await webhook.POST(req("/api/telegram/webhook", headers, tgMsg("/stop")));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
      nothingHappened();
    });

  it("Geheimnis oder Chat-ID nicht gesetzt: 401", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    expect((await webhook.POST(req("/api/telegram/webhook", { "x-telegram-bot-api-secret-token": "" }, tgMsg("/run")))).status).toBe(401);
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "t-geheim-456");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    expect((await webhook.POST(req("/api/telegram/webhook", { "x-telegram-bot-api-secret-token": "t-geheim-456" }, tgMsg("/run")))).status).toBe(401);
    nothingHappened();
  });

  it("richtiges Geheimnis, aber fremder Chat: nichts gemerkt, nichts geantwortet", async () => {
    const ok = { "x-telegram-bot-api-secret-token": "t-geheim-456" };
    for (const t of ["/status", "/stop", "/run", "/enable", "JA EINSCHALTEN"])
      expect((await webhook.POST(req("/api/telegram/webhook", ok, tgMsg(t, 999)))).status).toBe(200);
    const press = { update_id: 2, callback_query: { id: "c", data: "start", from: { id: 999 }, message: { chat: { id: 999 } } } };
    await webhook.POST(req("/api/telegram/webhook", ok, press));
    expect(db.queueCommand).not.toHaveBeenCalled();
    expect(ap.notify).not.toHaveBeenCalled();
    expect(ap.answerCallback).not.toHaveBeenCalled();
  });

  it("Gegenprobe: eigener Chat mit richtigem Geheimnis bekommt /status", async () => {
    await webhook.POST(req("/api/telegram/webhook", { "x-telegram-bot-api-secret-token": "t-geheim-456" }, tgMsg("/status")));
    expect(ap.notify).toHaveBeenCalledOnce();
    expect(vi.mocked(ap.notify).mock.calls[0][1]).toBe(ME);
  });
});

describe("secretOk", () => {
  it("nur exakt gleich und nie ohne erwartetes Geheimnis", () => {
    expect(secretOk("abc", "abc")).toBe(true);
    expect(secretOk("abd", "abc")).toBe(false);
    expect(secretOk("ab", "abc")).toBe(false);
    expect(secretOk("abcd", "abc")).toBe(false);
    expect(secretOk("abc\u0000", "abc")).toBe(false);
    expect(secretOk("abc", undefined)).toBe(false);
    expect(secretOk("", "")).toBe(false);
    expect(secretOk(null, "abc")).toBe(false);
  });
});

describe("/api/tutor24/erst braucht einen Login", () => {
  it("ohne Sitzung 401, nichts in die Befehlstabelle", async () => {
    vi.resetModules();
    vi.doMock("@/auth", () => ({ auth: vi.fn(async () => null) }));
    const queue = vi.fn(async () => true);
    vi.doMock("@/lib/tutor24-watch-db", () => ({ readLaptop: vi.fn(async () => ({ at: new Date().toISOString(), modus: "probe", gestoppt: null, pauseBis: null })), queueCommand: queue, commandStatus: vi.fn() }));
    const erst = await import("@/app/api/tutor24/erst/route");
    expect((await erst.POST(req("/api/tutor24/erst", {}, { anzahl: 5 }))).status).toBe(401);
    expect((await erst.GET(req("/api/tutor24/erst?id=web:x", {}, undefined, "GET"))).status).toBe(401);
    expect(queue).not.toHaveBeenCalled();
    expect(isOpenPath("/api/tutor24/erst")).toBe(false);
  });
});
