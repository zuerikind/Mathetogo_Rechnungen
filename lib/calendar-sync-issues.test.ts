import { describe, expect, it } from "vitest";
import {
  autoResolvedIssueEventIds,
  hasMateriallyChanged,
  parseExternalUpdatedAt,
  reconcileObservedIssue,
  type ObservedCalendarIssue,
  type StoredCalendarIssue,
} from "./calendar-sync-issues";

/**
 * Nicht zugeordnete Kalendereintraege: der Befund lebte bisher nur in der Antwort
 * des Sync-Requests. Jetzt bleibt er stehen, bis er entschieden ist — und ein
 * einmal getroffener Entscheid darf nicht bei jedem Sync wieder aufpoppen.
 */

const V1 = new Date("2026-08-01T10:00:00Z");
const V2 = new Date("2026-08-05T14:30:00Z");

const observed = (over: Partial<ObservedCalendarIssue> = {}): ObservedCalendarIssue => ({
  externalEventId: "evt-1",
  externalUpdatedAt: V1,
  reason: "no_match",
  ...over,
});

const stored = (over: Partial<StoredCalendarIssue> = {}): StoredCalendarIssue => ({
  externalUpdatedAt: V1,
  status: "open",
  reason: "no_match",
  ...over,
});

describe("reconcileObservedIssue — neuer Befund", () => {
  it("ohne gespeicherten Stand wird der Fall offen angelegt", () => {
    expect(reconcileObservedIssue(null, observed())).toEqual({ status: "open", reopened: false });
  });

  it("ein offener Fall bleibt offen", () => {
    expect(reconcileObservedIssue(stored(), observed())).toEqual({
      status: "open",
      reopened: false,
    });
  });
});

describe("reconcileObservedIssue — 'Ignorieren'", () => {
  it("bleibt ignoriert, solange es derselbe Kalendereintrag ist", () => {
    // Aussage ueber den TERMIN ("kein Schuelertermin"), nicht ueber den Zustand.
    // Ohne das stuende der Zahnarzttermin nach jedem Sync wieder in der Liste.
    expect(reconcileObservedIssue(stored({ status: "ignored" }), observed())).toEqual({
      status: "ignored",
      reopened: false,
    });
  });

  it("bleibt auch nach einer Aenderung des Termins ignoriert", () => {
    // Aus einem verschobenen oder umbenannten Zahnarzttermin wird keine Lektion.
    expect(
      reconcileObservedIssue(stored({ status: "ignored" }), observed({ externalUpdatedAt: V2 }))
    ).toEqual({ status: "ignored", reopened: false });
  });

  it("bleibt ignoriert, auch wenn sich der Grund aendert", () => {
    expect(
      reconcileObservedIssue(stored({ status: "ignored" }), observed({ reason: "ambiguous" }))
    ).toEqual({ status: "ignored", reopened: false });
  });
});

describe("reconcileObservedIssue — 'Erledigt'", () => {
  it("bleibt erledigt, solange sich am Termin nichts aendert", () => {
    expect(reconcileObservedIssue(stored({ status: "resolved" }), observed())).toEqual({
      status: "resolved",
      reopened: false,
    });
  });

  it("wird wieder geoeffnet, wenn Google eine neue Version meldet", () => {
    // Aussage ueber den ZUSTAND ("geprueft/behoben"). Aendert sich der Termin
    // materiell, ist es ein neuer Zustand und darf erneut auffallen.
    expect(
      reconcileObservedIssue(stored({ status: "resolved" }), observed({ externalUpdatedAt: V2 }))
    ).toEqual({ status: "open", reopened: true });
  });

  it("wird wieder geoeffnet, wenn der Grund ein anderer geworden ist", () => {
    expect(
      reconcileObservedIssue(stored({ status: "resolved" }), observed({ reason: "ambiguous" }))
    ).toEqual({ status: "open", reopened: true });
  });

  it("ohne Versionsangabe auf beiden Seiten bleibt es erledigt", () => {
    expect(
      reconcileObservedIssue(
        stored({ status: "resolved", externalUpdatedAt: null }),
        observed({ externalUpdatedAt: null })
      )
    ).toEqual({ status: "resolved", reopened: false });
  });

  it("eine erstmals gelieferte Version zaehlt als Aenderung", () => {
    expect(
      reconcileObservedIssue(
        stored({ status: "resolved", externalUpdatedAt: null }),
        observed({ externalUpdatedAt: V1 })
      )
    ).toEqual({ status: "open", reopened: true });
  });
});

describe("hasMateriallyChanged", () => {
  it("gleiche Version und gleicher Grund = unveraendert", () => {
    expect(hasMateriallyChanged(stored(), observed())).toBe(false);
  });

  it("vergleicht Zeitpunkte nach Wert, nicht nach Objektidentitaet", () => {
    expect(
      hasMateriallyChanged(stored({ externalUpdatedAt: new Date(V1.getTime()) }), observed())
    ).toBe(false);
  });

  it("andere Version = geaendert", () => {
    expect(hasMateriallyChanged(stored(), observed({ externalUpdatedAt: V2 }))).toBe(true);
  });
});

describe("autoResolvedIssueEventIds", () => {
  it("erledigt Faelle, deren Termin jetzt zugeordnet werden konnte", () => {
    // Titel korrigiert, der Sync hat die Lektion angelegt — ohne Klick erledigt.
    expect(autoResolvedIssueEventIds(["evt-1", "evt-2"], new Set(["evt-1"]))).toEqual(["evt-1"]);
  });

  it("laesst weiterhin unzuordenbare Faelle offen", () => {
    expect(autoResolvedIssueEventIds(["evt-1"], new Set(["evt-9"]))).toEqual([]);
  });

  it("'im Sync-Fenster nicht gesehen' ist kein Nachweis und erledigt nichts", () => {
    expect(autoResolvedIssueEventIds(["evt-1"], new Set())).toEqual([]);
  });
});

describe("parseExternalUpdatedAt", () => {
  it("liest Googles RFC3339-Zeitstempel", () => {
    expect(parseExternalUpdatedAt("2026-08-01T10:00:00.000Z")).toEqual(
      new Date("2026-08-01T10:00:00.000Z")
    );
  });

  it("unbrauchbare Werte gelten als 'keine Version'", () => {
    expect(parseExternalUpdatedAt(undefined)).toBeNull();
    expect(parseExternalUpdatedAt(null)).toBeNull();
    expect(parseExternalUpdatedAt("")).toBeNull();
    expect(parseExternalUpdatedAt("   ")).toBeNull();
    expect(parseExternalUpdatedAt("kein datum")).toBeNull();
    expect(parseExternalUpdatedAt(12345)).toBeNull();
  });
});

describe("Ablauf ueber mehrere Syncs", () => {
  it("ignorierter Eintrag taucht bei wiederholten Syncs nicht wieder auf", () => {
    let current = stored({ status: "ignored" });
    for (let sync = 0; sync < 5; sync += 1) {
      const next = reconcileObservedIssue(current, observed());
      expect(next.status).toBe("ignored");
      current = { ...current, status: next.status };
    }
  });

  it("erledigter Eintrag taucht erst bei echter Aenderung wieder auf", () => {
    let current = stored({ status: "resolved" });

    // Drei Syncs ohne Aenderung: bleibt weg.
    for (let sync = 0; sync < 3; sync += 1) {
      const next = reconcileObservedIssue(current, observed());
      expect(next.status).toBe("resolved");
      current = { ...current, status: next.status };
    }

    // Der Termin wird im Kalender bearbeitet: Google meldet eine neue Version.
    const nachAenderung = reconcileObservedIssue(current, observed({ externalUpdatedAt: V2 }));
    expect(nachAenderung).toEqual({ status: "open", reopened: true });
  });
});
