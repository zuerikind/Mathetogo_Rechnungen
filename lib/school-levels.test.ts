import { describe, expect, it } from "vitest";
import { KNOWN_LEVELS, levelsReviewNeeded, nextLevels } from "./school-levels";

describe("nextLevels", () => {
  it("rueckt innerhalb einer Schule eine Stufe vor", () => {
    expect(nextLevels("3. Primar")).toEqual(["4. Primar"]);
    expect(nextLevels("2. Gymnasium")).toEqual(["3. Gymnasium (= 1. Kurzzeit)"]);
    expect(nextLevels("ETH Jahr 2")).toEqual(["ETH Jahr 3"]);
  });
  it("bietet an Uebergaengen mehrere Wege an", () => {
    expect(nextLevels("6. Primar")).toEqual(["1. Sek", "1. Gymnasium"]);
    expect(nextLevels("6. Gymnasium (= 4. Kurzzeit)")).toContain("UZH Jahr 1");
  });
  it("hat keinen Vorschlag am Ende oder bei eigenen Stufen", () => {
    expect(nextLevels("HSG Jahr 5")).toEqual([]);
    expect(nextLevels("Lehre KV")).toEqual([]);
    expect(nextLevels(null)).toEqual([]);
  });
  it("schlaegt nur bekannte Stufen vor", () => {
    for (const l of KNOWN_LEVELS) for (const n of nextLevels(l)) expect(KNOWN_LEVELS).toContain(n);
  });
});

describe("levelsReviewNeeded", () => {
  it("meldet sich ab 1. August, bis das Schuljahr bestaetigt ist", () => {
    expect(levelsReviewNeeded(2025, new Date(2026, 6, 31))).toBe(false);
    expect(levelsReviewNeeded(2025, new Date(2026, 7, 1))).toBe(true);
    expect(levelsReviewNeeded(2026, new Date(2027, 2, 1))).toBe(false);
  });
});
