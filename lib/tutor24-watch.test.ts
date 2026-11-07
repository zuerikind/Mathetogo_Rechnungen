import { describe, expect, it } from "vitest";
import { currentCheck, watchDecision, zurichParts, zurichTime, type LaptopSignal, type RunRow } from "./tutor24-watch";

// Feste UTC-Zeitpunkte: der Test laeuft so auf jedem Rechner gleich (Vercel/GitHub rechnen in UTC)
const at = (iso: string) => new Date(iso);
const laptop = (p: Partial<LaptopSignal> = {}): LaptopSignal => ({ at: "2026-11-06T07:12:00Z", modus: "probe", gestoppt: null, pauseBis: null, ...p });
const run = (start: string, p: Partial<RunRow> = {}): RunRow => ({ startedAt: at(start), endedAt: at(start), ergebnis: "Ohne Fehler · 0 neue Antworten", stopp: null, is429: false, ...p });

describe("Zuercher Zeit", () => {
  it("Winter UTC+1, Sommer UTC+2", () => {
    expect(zurichTime("2026-11-06", 9).toISOString()).toBe("2026-11-06T08:00:00.000Z");
    expect(zurichTime("2026-07-06", 9).toISOString()).toBe("2026-07-06T07:00:00.000Z");
    expect(zurichParts(at("2026-11-06T08:45:00Z"))).toEqual({ day: "2026-11-06", h: 9, m: 45 });
  });

  it("Pruefzeiten: GitHub ruft im Winter und Sommer doppelt auf, nur die erreichte zaehlt", () => {
    expect(currentCheck(at("2026-11-06T07:45:00Z"))).toBeNull(); // 8:45 Zuerich: noch keine Pruefzeit
    expect(currentCheck(at("2026-11-06T08:47:00Z"))?.key).toBe("2026-11-06 09:45");
    expect(currentCheck(at("2026-07-06T07:50:00Z"))?.key).toBe("2026-07-06 09:45");
    expect(currentCheck(at("2026-11-06T16:50:00Z"))).toMatchObject({ key: "2026-11-06 17:45", due: "17:00" });
    expect(currentCheck(at("2026-11-06T19:20:00Z"))?.key).toBe("2026-11-06 20:00"); // verspaetet, noch ok
    expect(currentCheck(at("2026-11-06T20:05:00Z"))).toBeNull(); // 21:05: keine Erinnerung mehr
    expect(currentCheck(at("2026-11-07T11:00:00Z"))?.key).toBe("2026-11-07 12:00"); // Samstag auch
  });
});

describe("Waechter", () => {
  const now = at("2026-11-06T08:46:00Z"); // Fr 9:46

  it("Laptop aus, kein Durchgang: Erinnerung mit Offline-Zeit", () => {
    const d = watchDecision({ now, laptop: laptop(), runs: [], alreadySent: [] });
    expect(d?.text).toBe("⏰ tutor24 · Heute noch kein Durchgang (fällig 9:00). Laptop ist seit Fr., 06.11.2026, 08:12 offline. Er ist aus, schläft oder hat kein Internet (Hotspot/WLAN prüfen). Danach „Jetzt starten“.");
    // dieselbe Pruefzeit nur einmal
    expect(watchDecision({ now, laptop: laptop(), runs: [], alreadySent: [d!.key] })).toBeNull();
  });

  it("Durchgang lief: nichts; gestoppt (429, Login, Fehler): Grund statt 'nicht gelaufen'", () => {
    const online = laptop({ at: "2026-11-06T08:44:00Z" });
    expect(watchDecision({ now, laptop: online, runs: [run("2026-11-06T08:00:30Z")], alreadySent: [] })).toBeNull();
    const t429 = watchDecision({ now, laptop: laptop({ modus: "aus", pauseBis: "2026-11-06T20:01:00Z" }), runs: [run("2026-11-06T08:00:30Z", { is429: true, stopp: "tutor24: 429" })], alreadySent: [] });
    expect(t429?.text).toContain("Tutor24 hat das Anfragelimit erreicht. Der Lauf wurde gestoppt. Pause bis Fr., 06.11.2026, 21:01.");
    const login = watchDecision({ now, laptop: online, runs: [run("2026-11-06T08:00:30Z", { stopp: "tutor24: Login fehlgeschlagen: Passwort falsch" })], alreadySent: [] });
    expect(login?.text).toContain("hat die Automatik gestoppt: tutor24: Login fehlgeschlagen");
    const err = watchDecision({ now, laptop: online, runs: [run("2026-11-06T08:00:30Z", { ergebnis: "Abgebrochen: Unerwarteter Seitenaufbau" })], alreadySent: [] });
    expect(err?.text).toContain("09:00 Abgebrochen: Unerwarteter Seitenaufbau");
  });

  it("absichtlich aus: keine Erinnerung; automatisch aus: Grund", () => {
    expect(watchDecision({ now, laptop: laptop({ modus: "aus", gestoppt: { grund: "per Telegram /stop", am: "2026-11-05T13:00:00Z" } }), runs: [], alreadySent: [] })).toBeNull();
    const auto = watchDecision({ now, laptop: laptop({ modus: "aus", gestoppt: { grund: "Derselbe Fehler zweimal hintereinander: X", am: "2026-11-05T16:01:00Z" } }), runs: [], alreadySent: [] });
    expect(auto?.text).toContain("Automatik ist seit Do., 05.11.2026, 17:01 aus: Derselbe Fehler zweimal");
  });

  it("laeuft gerade (Laptop an): nichts; haengt (Laptop aus): Erinnerung", () => {
    const running = run("2026-11-06T08:00:30Z", { endedAt: null });
    expect(watchDecision({ now, laptop: laptop({ at: "2026-11-06T08:44:00Z" }), runs: [running], alreadySent: [] })).toBeNull();
    expect(watchDecision({ now, laptop: laptop(), runs: [running], alreadySent: [] })?.text).toContain("hat nicht fertig gemeldet");
  });

  it("Laptop an, Durchgang fehlt: Hinweis und Knopf", () => {
    expect(watchDecision({ now, laptop: laptop({ at: "2026-11-06T08:44:00Z" }), runs: [], alreadySent: [] })?.text).toContain("fehlt (z. B. war die Automatik da noch aus");
  });

  it("17:45 schaut nur auf den 17-Uhr-Durchgang", () => {
    const evening = at("2026-11-06T16:46:00Z");
    const morningOnly = [run("2026-11-06T08:00:30Z")];
    expect(watchDecision({ now: evening, laptop: laptop(), runs: morningOnly, alreadySent: [] })?.text).toContain("fällig 17:00");
  });
});
