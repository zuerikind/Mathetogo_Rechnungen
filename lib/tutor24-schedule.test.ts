import { describe, expect, it } from "vitest";
import { DEFAULT_TIMES, nextScheduled, normTimes, timesProblem, watchChecks } from "./tutor24-schedule";
import { currentCheck, watchDecision, type LaptopSignal } from "./tutor24-watch";
import { mergeSettings } from "./tutor24-followup";

const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

describe("Uhrzeiten der Durchgaenge", () => {
  it("Standard 09:00/17:00 ergibt die bisherigen Pruefzeiten", () => {
    expect(watchChecks(DEFAULT_TIMES).map((c) => `${hm(c.min)}>${c.due}`)).toEqual(["9:45>09:00", "12:00>09:00", "15:00>09:00", "17:45>17:00", "20:00>17:00"]);
  });
  it("andere Zeiten: Waechter folgt (z. B. 07:30 und 18:00)", () => {
    expect(watchChecks(["07:30", "18:00"]).map((c) => hm(c.min))).toEqual(["8:15", "10:30", "13:30", "18:45"]);
    const l: LaptopSignal = { at: "2026-11-09T06:00:00Z", modus: "probe", gestoppt: null, pauseBis: null, zeiten: ["07:30", "18:00"] };
    const d = watchDecision({ now: new Date("2026-11-09T07:20:00Z"), laptop: { ...l, at: "2026-11-09T05:00:00Z" }, runs: [], alreadySent: [] });
    expect(d?.text).toContain("fällig 7:30");
    expect(currentCheck(new Date("2026-11-09T07:20:00Z"), ["07:30", "18:00"])?.key).toBe("2026-11-09 08:15");
  });
  it("ein Durchgang um 10:00: Erinnerungen 10:45, 12:00, 15:00, 18:00 (10.11.)", () => {
    expect(watchChecks(["10:00"]).map((c) => `${hm(c.min)}>${c.due}`)).toEqual(["10:45>10:00", "12:00>10:00", "15:00>10:00", "18:00>10:00"]);
    expect(timesProblem(["10:00"])).toBeNull();
    // 18:30 Zuerich, Durchgang fehlt, Laptop an: Erinnerung zur Pruefzeit 18:00
    const l: LaptopSignal = { at: "2026-11-11T17:28:00Z", modus: "probe", gestoppt: null, pauseBis: null, zeiten: ["10:00"] };
    const d = watchDecision({ now: new Date("2026-11-11T17:30:00Z"), laptop: l, runs: [], alreadySent: ["2026-11-11 15:00"] });
    expect(d?.key).toBe("2026-11-11 18:00");
    expect(d?.text).toContain("Durchgang von 10:00 fehlt");
  });
  it("Pruefung beim Speichern: Format, 1–4, mindestens 2 Stunden auseinander", () => {
    expect(timesProblem(["9:00", "17:00"])).toBeNull();
    expect(normTimes(["17:00", "9:00"])).toEqual(["09:00", "17:00"]);
    expect(timesProblem(["09:00", "10:30"])).toMatch(/weniger als 2 Stunden/);
    expect(timesProblem(["23:00", "00:30"])).toMatch(/weniger als 2 Stunden/); // ueber Mitternacht
    expect(timesProblem(["9 Uhr"])).toMatch(/HH:MM/);
    expect(timesProblem([])).toMatch(/1 bis 4/);
    expect(mergeSettings({ durchgaenge: ["09:00", "10:00"] }).durchgaenge).toEqual(DEFAULT_TIMES);
  });
  it("naechster Durchgang in Zuercher Zeit, auch auf einem Rechner in UTC", () => {
    // Sa 7.11. 22:00 Zuerich = 21:00 UTC → So 8.11. 09:00 Zuerich = 08:00 UTC
    expect(nextScheduled(new Date("2026-11-07T21:00:00Z")).toISOString()).toBe("2026-11-08T08:00:00.000Z");
    expect(nextScheduled(new Date("2026-11-08T08:30:00Z"), ["10:15", "19:00"]).toISOString()).toBe("2026-11-08T09:15:00.000Z");
  });
});
