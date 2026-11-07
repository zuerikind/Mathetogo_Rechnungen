import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { earliestNext, tooSoonText } from "./tutor24-lock";
import { createBot } from "./tutor24-bot";
import { is429, type AutoState, type TgUpdate } from "./tutor24-autopilot";

describe("Mindestabstand 2 h zwischen tutor24-Laeufen", () => {
  const file = join(mkdtempSync(join(tmpdir(), "t24gap-")), "letzter-lauf.json");

  it("ab Ende des letzten Laufs; ohne Datei frei", () => {
    expect(earliestNext(new Date(), file)).toBeNull();
    writeFileSync(file, JSON.stringify({ ende: "2026-11-08T08:36:00Z" })); // 9:36 Zuerich
    expect(earliestNext(new Date("2026-11-08T09:00:00Z"), file)?.toISOString()).toBe("2026-11-08T10:36:00.000Z");
    expect(tooSoonText(new Date("2026-11-08T10:36:00Z"))).toBe("Nächster Lauf frühestens um 11:36 (2 Stunden Abstand zum letzten Lauf).");
    // 12:00 nach einem 9-Uhr-Durchgang bis 9:36: erlaubt
    expect(earliestNext(new Date("2026-11-08T11:00:00Z"), file)).toBeNull();
  });

  it("Bot: /run, /erst und 'Jetzt starten' starten zu früh nichts und nennen die Zeit", async () => {
    let state: AutoState = { modus: "probe", gestoppt: null, letzterFehler: null, zusammenfassungAm: null, telegramOffset: 0 };
    const replies: string[] = [];
    let started = 0;
    const now = new Date("2026-11-08T09:00:00Z");
    const handle = createBot({
      chatId: "1", now: () => now, reply: async (t) => void replies.push(t), state: () => state, update: (p) => (state = { ...state, ...p }),
      passes: () => [], busy: () => null, startProbe: () => void started++, startPass: () => void started++, startErst: () => void started++,
      requestStop: () => {}, gapUntil: () => new Date("2026-11-08T10:36:00Z"),
    });
    const msg = (text: string, i: number): TgUpdate => ({ update_id: i, message: { date: now.getTime() / 1000, text, chat: { id: 1, type: "private" } } });
    expect(await handle(msg("/run", 1))).toBe("run: zu früh");
    expect(await handle(msg("/erst 5", 2))).toBe("erst: zu früh");
    expect(await handle(msg("start", 3))).toBe("start: zu früh");
    expect(started).toBe(0);
    expect(replies[0]).toBe("⏳ Nicht gestartet. Nächster Lauf frühestens um 11:36 (2 Stunden Abstand zum letzten Lauf).");
  });
});

describe("429 nur am Wortlaut der tutor24-Fehlerseite", () => {
  it("echte Fehlerseite zählt", () => {
    expect(is429("Fehlermeldung «429 Too Many Requests You have sent too many requests in a given amount of time.» auf der Seite (nach dem Login)")).toBe(true);
    expect(is429("Zu viele Anfragen")).toBe(true);
  });
  it("die Zahl 429 allein und Verbindungsfehler zählen nicht", () => {
    expect(is429("Fehlermeldung «Es ist ein Fehler aufgetreten … CHF 429 pro Monat»")).toBe(false);
    expect(is429("Inserat 429: Timeout")).toBe(false);
    expect(is429("page.goto: net::ERR_INTERNET_DISCONNECTED at https://tutor24.ch/de/dashboard")).toBe(false);
  });
});
