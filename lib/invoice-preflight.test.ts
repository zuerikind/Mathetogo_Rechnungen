import { describe, expect, it } from "vitest";
import {
  BLOCKING_ISSUE_REASONS,
  blockingCalendarIssues,
  preflightBlockMessage,
  sessionIdsFromIssueDetails,
  type PreflightIssue,
} from "./invoice-preflight";

const issue = (over: Partial<PreflightIssue> & { key: string }): PreflightIssue => ({
  reason: "duplicate_slot",
  title: "Testbefund",
  sessionIds: [],
  ...over,
});

describe("blockingCalendarIssues", () => {
  it("blockiert, wenn der Befund auf einer Position der Rechnung sitzt", () => {
    const treffer = issue({ key: "dup:leo", sessionIds: ["s-alt", "s-neu"] });
    const blocking = blockingCalendarIssues({
      openIssues: [treffer],
      billedSessionIds: new Set(["s-neu", "s-andere"]),
    });
    expect(blocking.map((i) => i.key)).toEqual(["dup:leo"]);
  });

  it("blockiert nicht wegen eines Befunds aus einem anderen Monat oder Schueler", () => {
    const fremd = issue({ key: "dup:elenor", sessionIds: ["e-1", "e-2"] });
    expect(
      blockingCalendarIssues({
        openIssues: [fremd],
        billedSessionIds: new Set(["s-1", "s-2"]),
      })
    ).toEqual([]);
  });

  it("ein Befund ohne Lektionsbezug blockiert nichts", () => {
    expect(
      blockingCalendarIssues({
        openIssues: [issue({ key: "leer" })],
        billedSessionIds: new Set(["s-1"]),
      })
    ).toEqual([]);
  });

  it("eine Rechnung ohne Positionen wird nicht blockiert", () => {
    expect(
      blockingCalendarIssues({
        openIssues: [issue({ key: "dup", sessionIds: ["s-1"] })],
        billedSessionIds: new Set(),
      })
    ).toEqual([]);
  });

  it("jede Befundart, die Geld betreffen kann, haelt die Auslieferung auf", () => {
    expect([...BLOCKING_ISSUE_REASONS].sort()).toEqual([
      // Automatik erkannt, aber nicht ausgefuehrt (vergangen / ausgeliefert)
      "cancel_needs_review",
      // Zwei Lektionen zur selben Zeit
      "duplicate_slot",
      // Identitaetswechsel mit mehr als einem Kandidaten
      "identity_ambiguous",
      // Ausgelieferter Monat: Verknuepfung repariert, Betrag bewusst stehen gelassen
      "identity_conflict",
      "reactivate_needs_review",
      // Lektion ohne Kalendertermin
      "session_orphan",
    ]);
  });
});

/**
 * Der Fall, der das hier ausgeloest hat: Leo und Elenor standen im August je
 * zweimal auf derselben Rechnung — eine alte Zeile ohne Kalendertermin und die
 * neue daneben. Die Rechnung ging raus, bevor jemand hingeschaut hat.
 */
describe("August: Leo und Elenor haetten den Versand gestoppt", () => {
  const leoAlt = "leo-alt";
  const leoNeu = "leo-neu";
  const elenorAlt = "elenor-alt";
  const elenorNeu = "elenor-neu";

  const offeneBefunde: PreflightIssue[] = [
    issue({
      key: `orphan:_serie_leo`,
      reason: "session_orphan",
      title: "Leo — Lektion vom 12.08.2026 hat keinen Kalendertermin mehr",
      sessionIds: [leoAlt],
    }),
    issue({
      key: "dup:leo:2026-08-12T12:30:00.000Z",
      reason: "duplicate_slot",
      title: "Leo — zwei Lektionen am 12.08.2026 zur selben Zeit",
      sessionIds: [leoAlt, leoNeu],
    }),
    issue({
      key: "dup:elenor:2026-08-19T15:00:00.000Z",
      reason: "duplicate_slot",
      title: "Elenor — zwei Lektionen am 19.08.2026 zur selben Zeit",
      sessionIds: [elenorAlt, elenorNeu],
    }),
  ];

  it("Leos Rechnung wird gestoppt — beide Befunde sitzen auf ihren Positionen", () => {
    const blocking = blockingCalendarIssues({
      openIssues: offeneBefunde,
      billedSessionIds: new Set([leoAlt, leoNeu, "leo-ok-1", "leo-ok-2"]),
    });
    expect(blocking.map((i) => i.key)).toEqual([
      "orphan:_serie_leo",
      "dup:leo:2026-08-12T12:30:00.000Z",
    ]);
  });

  it("Elenors Rechnung wird gestoppt, aber nur durch ihren eigenen Befund", () => {
    const blocking = blockingCalendarIssues({
      openIssues: offeneBefunde,
      billedSessionIds: new Set([elenorAlt, elenorNeu]),
    });
    expect(blocking.map((i) => i.key)).toEqual(["dup:elenor:2026-08-19T15:00:00.000Z"]);
  });

  it("eine unbeteiligte Rechnung desselben Monats geht raus", () => {
    expect(
      blockingCalendarIssues({
        openIssues: offeneBefunde,
        billedSessionIds: new Set(["vincent-1", "vincent-2"]),
      })
    ).toEqual([]);
  });

  it("der Monatsexport wird gestoppt, sobald ein Befund im Monat liegt", () => {
    const alleLektionenImMonat = new Set([
      leoAlt,
      leoNeu,
      elenorAlt,
      elenorNeu,
      "vincent-1",
    ]);
    expect(
      blockingCalendarIssues({ openIssues: offeneBefunde, billedSessionIds: alleLektionenImMonat })
    ).toHaveLength(3);
  });

  it("die Meldung nennt die Befunde und den Weg heraus", () => {
    const text = preflightBlockMessage(offeneBefunde.slice(0, 1), "August 2026");
    expect(text).toContain("Leo");
    expect(text).toContain("August 2026");
    expect(text).toContain("Kalender prüfen");
  });
});

describe("sessionIdsFromIssueDetails", () => {
  it("liest die Lektionen aus dem gespeicherten Befund", () => {
    expect(sessionIdsFromIssueDetails({ sessionIds: ["a", "b"] })).toEqual(["a", "b"]);
  });

  it("vertraegt Altbestand ohne sessionIds", () => {
    expect(sessionIdsFromIssueDetails(null)).toEqual([]);
    expect(sessionIdsFromIssueDetails({ suggestions: ["Leo"] })).toEqual([]);
    expect(sessionIdsFromIssueDetails({ sessionIds: "kaputt" })).toEqual([]);
    expect(sessionIdsFromIssueDetails({ sessionIds: [1, "b"] })).toEqual(["b"]);
  });
});
