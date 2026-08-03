import { describe, expect, it, vi } from "vitest";
import { resolveDeletedCalendarEvents, type CalendarEventReader } from "./calendar-deletions";

/** Kalender-Attrappe: pro eventId entweder eine Antwort oder ein Fehler. */
function fakeCalendar(
  responses: Record<string, { status?: string | null } | { throw: { code: number } | Error }>
): CalendarEventReader {
  return {
    events: {
      get: vi.fn(async ({ eventId }: { calendarId: string; eventId: string }) => {
        const r = responses[eventId];
        if (r && "throw" in r) throw r.throw;
        return { data: r ?? {} };
      }),
    },
  };
}

const c = (sessionId: string, calEventId: string) => ({ sessionId, calEventId });

describe("resolveDeletedCalendarEvents", () => {
  it("zählt einen abgesagten Termin als gelöscht", async () => {
    const cal = fakeCalendar({ evt: { status: "cancelled" } });
    const out = await resolveDeletedCalendarEvents(cal, "kal", [c("s1", "evt")]);
    expect(Array.from(out)).toEqual(["s1"]);
  });

  it("zählt 404 und 410 als gelöscht", async () => {
    const cal = fakeCalendar({
      weg: { throw: { code: 404 } },
      futsch: { throw: { code: 410 } },
    });
    const out = await resolveDeletedCalendarEvents(cal, "kal", [c("s1", "weg"), c("s2", "futsch")]);
    expect(Array.from(out).sort()).toEqual(["s1", "s2"]);
  });

  it("lässt einen NUR VERSCHOBENEN Termin unangetastet", async () => {
    // Der Kern des Umbaus: der Termin fehlt im Sync-Fenster, existiert aber noch.
    // Frueher wurde er geloescht, jetzt darf er nicht einmal vorgemerkt werden.
    const cal = fakeCalendar({ verschoben: { status: "confirmed" } });
    const out = await resolveDeletedCalendarEvents(cal, "kal", [c("s1", "verschoben")]);
    expect(out.size).toBe(0);
  });

  it("behält im Zweifel: unklarer Fehler gilt NICHT als Löschung", async () => {
    const cal = fakeCalendar({
      kaputt: { throw: { code: 500 } },
      netz: { throw: new Error("ECONNRESET") },
    });
    const out = await resolveDeletedCalendarEvents(cal, "kal", [c("s1", "kaputt"), c("s2", "netz")]);
    expect(out.size).toBe(0);
  });

  it("trennt gemischte Kandidaten sauber", async () => {
    const cal = fakeCalendar({
      a: { status: "cancelled" },
      b: { status: "confirmed" },
      d: { throw: { code: 404 } },
      e: { throw: { code: 403 } },
    });
    const out = await resolveDeletedCalendarEvents(cal, "kal", [
      c("sa", "a"), c("sb", "b"), c("sd", "d"), c("se", "e"),
    ]);
    expect(Array.from(out).sort()).toEqual(["sa", "sd"]);
  });

  it("fragt jeden Kandidaten genau einmal", async () => {
    const cal = fakeCalendar({ x: { status: "confirmed" } });
    await resolveDeletedCalendarEvents(cal, "kal", [c("s1", "x"), c("s2", "x")]);
    expect(cal.events.get).toHaveBeenCalledTimes(2);
  });
});
