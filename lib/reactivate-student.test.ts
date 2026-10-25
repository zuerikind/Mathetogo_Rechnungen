import { describe, expect, it } from "vitest";
import { isLockedMonth } from "./reactivate-student";

describe("isLockedMonth", () => {
  const now = new Date("2026-10-25T12:00:00Z");
  it("laesst laufenden Monat und Vormonat offen", () => {
    expect(isLockedMonth("2026-10-03T10:00:00Z", now)).toBe(false);
    expect(isLockedMonth("2026-09-01T08:00:00Z", now)).toBe(false);
  });
  it("sperrt den vorletzten Monat und aelter", () => {
    expect(isLockedMonth("2026-08-31T10:00:00Z", now)).toBe(true);
  });
});
