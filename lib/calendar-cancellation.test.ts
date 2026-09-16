import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_SESSION_WHERE,
  CANCELLATION_REASONS,
  MANUAL_CANCELLATION_ACTION,
  decideCancellation,
  decideReactivation,
  isActiveSession,
  isManualSession,
  type CancellationSubject,
} from "./calendar-cancellation";

const JETZT = new Date("2026-09-01T18:00:00.000Z");
const ZUKUNFT = new Date("2026-09-18T13:00:00.000Z");
const VERGANGENHEIT = new Date("2026-08-21T13:00:00.000Z");

const lektion = (over: Partial<CancellationSubject> = {}): CancellationSubject => ({
  date: ZUKUNFT,
  calEventId: "08trcp9m_20260918T130000Z",
  cancelledAt: null,
  ...over,
});

describe("Einzelne geloeschte zukuenftige Serieninstanz", () => {
  it("Google meldet status=cancelled → automatisch soft-storniert", () => {
    expect(
      decideCancellation({
        session: lektion(),
        evidence: "google_cancelled",
        billed: false,
        now: JETZT,
      })
    ).toEqual({ kind: "cancel", reason: "google_cancelled" });
  });

  it("nur abwesend, aber Lauf vollstaendig und Loeschung bestaetigt → storniert", () => {
    expect(
      decideCancellation({
        session: lektion(),
        evidence: "missing",
        billed: false,
        now: JETZT,
        syncComplete: true,
        deletionConfirmed: true,
      })
    ).toEqual({ kind: "cancel", reason: "google_missing" });
  });
});

describe("Abwesenheit allein reicht nie", () => {
  it("unvollstaendige Seitenkette → nichts anfassen", () => {
    expect(
      decideCancellation({
        session: lektion(),
        evidence: "missing",
        billed: false,
        now: JETZT,
        syncComplete: false,
        deletionConfirmed: true,
      })
    ).toEqual({ kind: "skip", why: "sync_incomplete" });
  });

  it("keine Einzelbestaetigung → nichts anfassen", () => {
    expect(
      decideCancellation({
        session: lektion(),
        evidence: "missing",
        billed: false,
        now: JETZT,
        syncComplete: true,
        deletionConfirmed: false,
      })
    ).toEqual({ kind: "skip", why: "unconfirmed" });
  });

  it("verschobene Instanz: der Termin existiert noch, nur woanders — kein Storno", () => {
    // events.get bestaetigt die Loeschung NICHT, weil es den Termin noch gibt.
    expect(
      decideCancellation({
        session: lektion(),
        evidence: "missing",
        billed: false,
        now: JETZT,
        syncComplete: true,
        deletionConfirmed: false,
      })
    ).toEqual({ kind: "skip", why: "unconfirmed" });
  });
});

describe("Vergangene Lektion", () => {
  it("wird nie automatisch storniert, sondern gemeldet", () => {
    expect(
      decideCancellation({
        session: lektion({ date: VERGANGENHEIT }),
        evidence: "google_cancelled",
        billed: false,
        now: JETZT,
      })
    ).toEqual({ kind: "review", why: "past" });
  });

  it("auch mit bestaetigter Loeschung nicht", () => {
    expect(
      decideCancellation({
        session: lektion({ date: VERGANGENHEIT }),
        evidence: "missing",
        billed: false,
        now: JETZT,
        syncComplete: true,
        deletionConfirmed: true,
      })
    ).toEqual({ kind: "review", why: "past" });
  });

  it("die Grenze ist jetzt: eine gerade laufende Lektion gilt als vergangen", () => {
    expect(
      decideCancellation({
        session: lektion({ date: JETZT }),
        evidence: "google_cancelled",
        billed: false,
        now: JETZT,
      })
    ).toEqual({ kind: "review", why: "past" });
  });
});

describe("Versendete oder bezahlte Rechnung", () => {
  it("schlaegt alles — auch eine ausdrueckliche Google-Absage", () => {
    expect(
      decideCancellation({
        session: lektion(),
        evidence: "google_cancelled",
        billed: true,
        now: JETZT,
      })
    ).toEqual({ kind: "review", why: "billed" });
  });

  it("ausgeliefert wiegt schwerer als vergangen", () => {
    expect(
      decideCancellation({
        session: lektion({ date: VERGANGENHEIT }),
        evidence: "google_cancelled",
        billed: true,
        now: JETZT,
      })
    ).toEqual({ kind: "review", why: "billed" });
  });
});

describe("Was gar nicht erst in Frage kommt", () => {
  it("bereits storniert → nichts tun, nichts melden", () => {
    expect(
      decideCancellation({
        session: lektion({ cancelledAt: new Date() }),
        evidence: "google_cancelled",
        billed: false,
        now: JETZT,
      })
    ).toEqual({ kind: "skip", why: "already_cancelled" });
  });

  it("Q1-Import ohne Google-Termin", () => {
    expect(
      decideCancellation({
        session: lektion({ calEventId: "manual-2026-01-13-liam" }),
        evidence: "missing",
        billed: false,
        now: JETZT,
        syncComplete: true,
        deletionConfirmed: true,
      })
    ).toEqual({ kind: "skip", why: "manual" });
  });

  it("handangelegte Lektion ohne calEventId", () => {
    expect(
      decideCancellation({
        session: lektion({ calEventId: null }),
        evidence: "google_cancelled",
        billed: false,
        now: JETZT,
      })
    ).toEqual({ kind: "skip", why: "manual" });
  });

  it("isManualSession spiegelt das", () => {
    expect(isManualSession(null)).toBe(true);
    expect(isManualSession("manual-x")).toBe(true);
    expect(isManualSession("08trcp9m")).toBe(false);
  });
});

/**
 * Die Reaktivierung folgt demselben Schnitt wie die Stornierung: automatisch
 * nur dort, wo ein Irrtum folgenlos bleibt. Alles andere wird gemeldet.
 */
describe("Der geloeschte Termin erscheint wieder", () => {
  const storniert = new Date("2026-09-01T20:00:00.000Z");

  it("zukuenftig + nicht fakturiert → automatisch reaktivieren", () => {
    expect(
      decideReactivation({
        session: { cancelledAt: storniert, date: ZUKUNFT },
        billed: false,
        now: JETZT,
      })
    ).toEqual({ kind: "reactivate" });
  });

  it("vergangen + nicht fakturiert → NIE automatisch, sondern zur Pruefung", () => {
    expect(
      decideReactivation({
        session: { cancelledAt: storniert, date: VERGANGENHEIT },
        billed: false,
        now: JETZT,
      })
    ).toEqual({ kind: "review", why: "past" });
  });

  it("zukuenftig, aber von einer ausgelieferten Rechnung betroffen → zur Pruefung", () => {
    expect(
      decideReactivation({
        session: { cancelledAt: storniert, date: ZUKUNFT },
        billed: true,
        now: JETZT,
      })
    ).toEqual({ kind: "review", why: "billed" });
  });

  it("vergangen UND fakturiert → zur Pruefung, ausgeliefert wiegt schwerer", () => {
    expect(
      decideReactivation({
        session: { cancelledAt: storniert, date: VERGANGENHEIT },
        billed: true,
        now: JETZT,
      })
    ).toEqual({ kind: "review", why: "billed" });
  });

  it("die Grenze ist jetzt: eine gerade laufende Lektion gilt als vergangen", () => {
    expect(
      decideReactivation({
        session: { cancelledAt: storniert, date: JETZT },
        billed: false,
        now: JETZT,
      })
    ).toEqual({ kind: "review", why: "past" });
  });

  it("eine Sekunde in der Zukunft wird noch automatisch reaktiviert", () => {
    expect(
      decideReactivation({
        session: { cancelledAt: storniert, date: new Date(JETZT.getTime() + 1000) },
        billed: false,
        now: JETZT,
      })
    ).toEqual({ kind: "reactivate" });
  });

  it("war gar nicht storniert → nichts zu tun", () => {
    expect(
      decideReactivation({
        session: { cancelledAt: null, date: ZUKUNFT },
        billed: false,
        now: JETZT,
      })
    ).toEqual({ kind: "skip", why: "not_cancelled" });
  });

  it("auch eine vergangene, nicht stornierte Lektion erzeugt keinen Befund", () => {
    expect(
      decideReactivation({
        session: { cancelledAt: null, date: VERGANGENHEIT },
        billed: true,
        now: JETZT,
      })
    ).toEqual({ kind: "skip", why: "not_cancelled" });
  });

  it("Stornieren und Reaktivieren ziehen dieselbe Grenze", () => {
    // Was nicht automatisch storniert werden darf, darf auch nicht automatisch
    // reaktiviert werden — sonst waere die Automatik in eine Richtung mutiger
    // als in die andere.
    for (const [date, billed] of [
      [VERGANGENHEIT, false],
      [ZUKUNFT, true],
      [VERGANGENHEIT, true],
    ] as const) {
      const storno = decideCancellation({
        session: lektion({ date }),
        evidence: "google_cancelled",
        billed,
        now: JETZT,
      });
      const reaktivierung = decideReactivation({
        session: { cancelledAt: storniert, date },
        billed,
        now: JETZT,
      });
      expect(storno.kind).toBe("review");
      expect(reaktivierung.kind).toBe("review");
    }
  });
});

describe("Wiederholter Sync ist idempotent", () => {
  it("der zweite Lauf storniert nicht erneut", () => {
    const erste = decideCancellation({
      session: lektion(),
      evidence: "google_cancelled",
      billed: false,
      now: JETZT,
    });
    expect(erste).toEqual({ kind: "cancel", reason: "google_cancelled" });

    // Zustand NACH dem ersten Lauf.
    const zweite = decideCancellation({
      session: lektion({ cancelledAt: JETZT }),
      evidence: "google_cancelled",
      billed: false,
      now: JETZT,
    });
    expect(zweite).toEqual({ kind: "skip", why: "already_cancelled" });
  });

  it("und die Reaktivierung ebenfalls nicht", () => {
    const erste = decideReactivation({
      session: { cancelledAt: JETZT, date: ZUKUNFT },
      billed: false,
      now: JETZT,
    });
    expect(erste).toEqual({ kind: "reactivate" });
    // Zustand NACH der Reaktivierung: cancelledAt ist weg.
    const zweite = decideReactivation({
      session: { cancelledAt: null, date: ZUKUNFT },
      billed: false,
      now: JETZT,
    });
    expect(zweite).toEqual({ kind: "skip", why: "not_cancelled" });
  });
});

describe("Geldfilter", () => {
  it("ACTIVE_SESSION_WHERE und isActiveSession sagen dasselbe", () => {
    expect(ACTIVE_SESSION_WHERE).toEqual({ cancelledAt: null });
    expect(isActiveSession({ cancelledAt: null })).toBe(true);
    expect(isActiveSession({ cancelledAt: new Date() })).toBe(false);
  });
});

describe("Quellpruefung", () => {
  it("das Modul kennt keine Datenbank", () => {
    const src = readFileSync(path.join(__dirname, "calendar-cancellation.ts"), "utf8");
    expect(src).not.toMatch(/prisma|\$transaction|findMany|updateMany/);
  });
});

describe("Ausweg von Hand", () => {
  it("jeder blockierende Befund hat genau einen Eingriff", () => {
    // Ohne Eingriff bliebe dem Nutzer nur Wegklicken — und die Lektion zaehlte
    // weiter zum Betrag, obwohl der Termin abgesagt ist. Kommt eine dritte
    // Befundart dazu, faellt hier auf, dass ihr Knopf fehlt.
    expect(Object.keys(MANUAL_CANCELLATION_ACTION).sort()).toEqual(
      [...CANCELLATION_REASONS].sort()
    );
    expect(new Set(Object.values(MANUAL_CANCELLATION_ACTION)).size).toBe(
      CANCELLATION_REASONS.length
    );
  });
});
