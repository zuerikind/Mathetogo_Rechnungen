import { describe, expect, it } from "vitest";
import { isHotspot, parseSsid } from "./tutor24-network";
import { watchDecision, type LaptopSignal } from "./tutor24-watch";

const NETSH = `
Es ist 1 Schnittstelle auf dem System vorhanden:

    Name                   : WLAN
    Status                 : Verbunden
    SSID                   : Omids iPhone (2)
    AP BSSID               : f6:8a:65:a7:f5:3f
    Signal                 : 99%
`;

describe("Netz vor dem Durchgang", () => {
  it("SSID lesen, nicht die BSSID; getrennt = null", () => {
    expect(parseSsid(NETSH)).toBe("Omids iPhone (2)");
    expect(parseSsid("    Status                 : Getrennt\n")).toBeNull();
  });
  it("iPhone-Hotspot erkannt, Heim-WLAN nicht", () => {
    expect(isHotspot("Omids iPhone (2)")).toBe(true);
    expect(isHotspot("Sunrise_5GHz_1234")).toBe(false);
    expect(isHotspot(null)).toBe(false);
  });
});

describe("Waechter", () => {
  const now = new Date("2026-11-08T08:50:00Z"); // So 9:50 Zuerich, Pruefzeit 9:45
  const base: LaptopSignal = { at: "2026-11-08T08:49:00Z", modus: "probe", gestoppt: null, pauseBis: null };
  it("ohne Lebenszeichen (kein Internet): erinnert wie bei offline", () => {
    const d = watchDecision({ now, laptop: { ...base, at: "2026-11-08T07:00:00Z" }, runs: [], alreadySent: [] });
    expect(d?.text).toContain("hat kein Internet (Hotspot/WLAN prüfen)");
  });
  it("wegen Mindestabstand verschoben: nennt die Zeit", () => {
    const d = watchDecision({ now, laptop: { ...base, abstandBis: "2026-11-08T09:20:00Z" }, runs: [], alreadySent: [] });
    expect(d?.text).toContain("Nächster Lauf frühestens um 10:20");
  });
});
