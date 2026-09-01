import { describe, expect, it } from "vitest";
import { resolveCalendarIdentity, type IdentityCandidate } from "./calendar-identity";

/**
 * Die Aufloesungskette a–e. Die Stage-2-Faelle stehen in calendar-identity.test.ts;
 * hier geht es um die Stufen, die mit Googles eigenen Merkmalen arbeiten.
 */

const LUCA = "luca";
const START = new Date("2026-09-18T13:00:00.000Z");

const kandidat = (over: Partial<IdentityCandidate> & { id: string }): IdentityCandidate => ({
  studentId: LUCA,
  date: START,
  durationMin: 50,
  amountCHF: 75,
  calEventId: `alt-${over.id}`,
  iCalUID: null,
  originalStartAt: null,
  ...over,
});

describe("Stufe a — bereits verknuepft", () => {
  it("schlaegt jede andere Regel", () => {
    const verknuepft = kandidat({ id: "verknuepft", calEventId: "evt-neu" });
    const auchMoeglich = kandidat({ id: "auch", calEventId: "weg", iCalUID: "uid-1" });
    const res = resolveCalendarIdentity({
      calEventId: "evt-neu",
      studentId: LUCA,
      start: START,
      iCalUID: "uid-1",
      sessions: [verknuepft, auchMoeglich],
      googleEventIds: new Set(["evt-neu"]),
    });
    expect(res).toEqual({ kind: "linked", sessionId: "verknuepft" });
  });
});

describe("Stufe b — der Termin nennt unsere Session-ID", () => {
  it("gewinnt gegen iCalUID und gegen gleiche Startzeit", () => {
    const gemeint = kandidat({ id: "sess-42", calEventId: "weg-42" });
    const ueberUid = kandidat({ id: "sess-99", calEventId: "weg-99", iCalUID: "uid-1" });
    const res = resolveCalendarIdentity({
      calEventId: "evt-neu",
      studentId: LUCA,
      start: START,
      iCalUID: "uid-1",
      appSessionId: "sess-42",
      sessions: [gemeint, ueberUid],
      googleEventIds: new Set(["evt-neu"]),
    });
    expect(res).toMatchObject({ kind: "replace", via: "appSessionId" });
    if (res.kind !== "replace") return;
    expect(res.session.id).toBe("sess-42");
  });

  it("eine unbekannte Session-ID faellt auf die naechste Stufe durch", () => {
    const ueberZeit = kandidat({ id: "sess-1", calEventId: "weg" });
    const res = resolveCalendarIdentity({
      calEventId: "evt-neu",
      studentId: LUCA,
      start: START,
      appSessionId: "gibt-es-nicht",
      sessions: [ueberZeit],
      googleEventIds: new Set(["evt-neu"]),
    });
    expect(res).toMatchObject({ kind: "replace", via: "sameStart" });
  });
});

describe('Stufe c — "dieser und alle folgenden Termine"', () => {
  /**
   * Google legt bei dieser Aenderung eine NEUE Serie an: neue Event-IDs ab dem
   * Stichtag. Die Instanz behaelt aber iCalUID und originalStartTime — daran
   * wird sie wiedererkannt, ohne dass jemand raten muss.
   */
  it("erkennt die Instanz an iCalUID + urspruenglicher Startzeit wieder", () => {
    const alt = kandidat({
      id: "alt",
      calEventId: "_alteSerie_20260918T130000Z",
      iCalUID: "serie-a@google.com",
      originalStartAt: START,
    });
    const res = resolveCalendarIdentity({
      calEventId: "_neueSerie_20260918T130000Z",
      studentId: LUCA,
      start: START,
      iCalUID: "serie-a@google.com",
      recurringEventId: "_neueSerie",
      originalStartAt: START,
      sessions: [alt],
      googleEventIds: new Set(["_neueSerie_20260918T130000Z"]),
    });
    expect(res).toMatchObject({ kind: "replace", via: "iCalUID" });
  });

  it("verschobene Instanz: neue Startzeit, gleiche urspruengliche — wird mitverschoben", () => {
    const alt = kandidat({
      id: "alt",
      calEventId: "_serie_20260918T130000Z",
      iCalUID: "serie-a@google.com",
      originalStartAt: START,
    });
    const eineStundeSpaeter = new Date(START.getTime() + 60 * 60 * 1000);
    const res = resolveCalendarIdentity({
      calEventId: "_serie_20260918T140000Z",
      studentId: LUCA,
      // Der Termin steht jetzt eine Stunde spaeter …
      start: eineStundeSpaeter,
      iCalUID: "serie-a@google.com",
      // … aber Google sagt, welche Instanz gemeint ist.
      originalStartAt: START,
      sessions: [alt],
      googleEventIds: new Set(["_serie_20260918T140000Z"]),
    });
    expect(res).toMatchObject({ kind: "replace", via: "iCalUID" });
    if (res.kind !== "replace") return;
    expect(res.session.id).toBe("alt");
  });

  it("ohne iCalUID bleibt die Verschiebung unerkannt — und das ist richtig so", () => {
    const alt = kandidat({ id: "alt", calEventId: "_serie_20260918T130000Z" });
    const eineStundeSpaeter = new Date(START.getTime() + 60 * 60 * 1000);
    const res = resolveCalendarIdentity({
      calEventId: "_serie_20260918T140000Z",
      studentId: LUCA,
      start: eineStundeSpaeter,
      sessions: [alt],
      googleEventIds: new Set(["_serie_20260918T140000Z"]),
    });
    // Eine Stunde spaeter kann Verschiebung ODER Absage plus Zusatzstunde sein.
    expect(res).toEqual({ kind: "new" });
  });

  it("gleiche iCalUID, andere Instanz → kein Treffer", () => {
    const andereInstanz = kandidat({
      id: "andere",
      calEventId: "_serie_20260911T130000Z",
      iCalUID: "serie-a@google.com",
      originalStartAt: new Date("2026-09-11T13:00:00.000Z"),
      date: new Date("2026-09-11T13:00:00.000Z"),
    });
    const res = resolveCalendarIdentity({
      calEventId: "_neu_20260918T130000Z",
      studentId: LUCA,
      start: START,
      iCalUID: "serie-a@google.com",
      originalStartAt: START,
      sessions: [andereInstanz],
      googleEventIds: new Set(["_neu_20260918T130000Z"]),
    });
    expect(res).toEqual({ kind: "new" });
  });

  it("die alte ID steht noch im Kalender → auch iCalUID darf sie nicht beanspruchen", () => {
    const alt = kandidat({
      id: "alt",
      calEventId: "_serie_20260918T130000Z",
      iCalUID: "serie-a@google.com",
      originalStartAt: START,
    });
    const res = resolveCalendarIdentity({
      calEventId: "_kopie_20260918T130000Z",
      studentId: LUCA,
      start: START,
      iCalUID: "serie-a@google.com",
      originalStartAt: START,
      sessions: [alt],
      // Beide Termine leben.
      googleEventIds: new Set(["_serie_20260918T130000Z", "_kopie_20260918T130000Z"]),
    });
    expect(res).toEqual({ kind: "new" });
  });
});

describe("Stufe e — zwei mehrdeutige Kandidaten", () => {
  it("zwei Zeilen mit derselben iCalUID-Instanz → kein Zusammenschluss", () => {
    const a = kandidat({
      id: "a",
      calEventId: "weg-a",
      iCalUID: "serie-a@google.com",
      originalStartAt: START,
    });
    const b = kandidat({
      id: "b",
      calEventId: "weg-b",
      iCalUID: "serie-a@google.com",
      originalStartAt: START,
    });
    const res = resolveCalendarIdentity({
      calEventId: "neu",
      studentId: LUCA,
      start: START,
      iCalUID: "serie-a@google.com",
      originalStartAt: START,
      sessions: [a, b],
      googleEventIds: new Set(["neu"]),
    });
    expect(res).toMatchObject({ kind: "ambiguous", via: "iCalUID" });
    if (res.kind !== "ambiguous") return;
    expect(res.sessions.map((s) => s.id).sort()).toEqual(["a", "b"]);
  });

  it("zwei Zeilen zur gleichen Startzeit → kein Zusammenschluss", () => {
    const a = kandidat({ id: "a", calEventId: "weg-a" });
    const b = kandidat({ id: "b", calEventId: "weg-b" });
    const res = resolveCalendarIdentity({
      calEventId: "neu",
      studentId: LUCA,
      start: START,
      sessions: [a, b],
      googleEventIds: new Set(["neu"]),
    });
    expect(res).toMatchObject({ kind: "ambiguous", via: "sameStart" });
  });

  it("eine mehrdeutige Stufe faellt NICHT auf die naechste durch", () => {
    // Sonst wuerde aus "zwei Kandidaten ueber iCalUID" stillschweigend
    // "ein Kandidat ueber gleiche Startzeit" — genau das Raten, das verboten ist.
    const a = kandidat({
      id: "a",
      calEventId: "weg-a",
      iCalUID: "uid",
      originalStartAt: START,
      date: new Date("2026-09-11T13:00:00.000Z"),
    });
    const b = kandidat({
      id: "b",
      calEventId: "weg-b",
      iCalUID: "uid",
      originalStartAt: START,
      date: new Date("2026-09-11T13:00:00.000Z"),
    });
    const c = kandidat({ id: "c", calEventId: "weg-c" });
    const res = resolveCalendarIdentity({
      calEventId: "neu",
      studentId: LUCA,
      start: START,
      iCalUID: "uid",
      originalStartAt: START,
      sessions: [a, b, c],
      googleEventIds: new Set(["neu"]),
    });
    expect(res.kind).toBe("ambiguous");
  });
});

describe("Wiederholter Sync ist idempotent", () => {
  it("nach der Ersetzung greift Stufe a und nichts aendert sich mehr", () => {
    const nachher = kandidat({
      id: "alt",
      calEventId: "_neueSerie_20260918T130000Z",
      iCalUID: "serie-a@google.com",
      originalStartAt: START,
    });
    const res = resolveCalendarIdentity({
      calEventId: "_neueSerie_20260918T130000Z",
      studentId: LUCA,
      start: START,
      iCalUID: "serie-a@google.com",
      originalStartAt: START,
      sessions: [nachher],
      googleEventIds: new Set(["_neueSerie_20260918T130000Z"]),
    });
    expect(res).toEqual({ kind: "linked", sessionId: "alt" });
  });
});
