import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  identityReplacementPlan,
  resolveCalendarIdentity,
  type IdentityCandidate,
} from "./calendar-identity";
import { findOrphanSessions, type IntegritySession } from "./calendar-integrity";

/**
 * Die Faelle sind nicht ausgedacht. A ist Leo (Einzeltermin wurde Serie), B ist
 * Luca (Serie geloescht und neu angelegt), F ist der verschobene Termin, der als
 * einziger noch nicht vorgekommen ist und am gefaehrlichsten waere: dort darf
 * NICHT zusammengelegt werden.
 */

const START = new Date("2026-09-04T13:00:00.000Z");

const candidate = (over: Partial<IdentityCandidate> & { id: string }): IdentityCandidate => ({
  studentId: "luca",
  date: START,
  durationMin: 60,
  amountCHF: 90,
  calEventId: `alt-${over.id}`,
  ...over,
});

describe("A — Leo: aus einem Einzeltermin wird eine Serieninstanz", () => {
  const alt = candidate({ id: "leo-1", studentId: "leo", calEventId: "leo_einzeltermin" });

  it("erkennt dieselbe Lektion und ersetzt nur die Kalender-ID", () => {
    const res = resolveCalendarIdentity({
      calEventId: "_serie_leo_20260904T130000Z",
      studentId: "leo",
      start: START,
      sessions: [alt],
      googleEventIds: new Set(["_serie_leo_20260904T130000Z"]),
    });
    expect(res.kind).toBe("replace");
    if (res.kind !== "replace") return;
    expect(res.session.id).toBe("leo-1");
    expect(res.staleCalEventId).toBe("leo_einzeltermin");
  });
});

describe("B — Luca: die Serie bekommt eine voellig neue Basis-ID", () => {
  const alt = candidate({ id: "luca-alt", calEventId: "_alteSerie_20260904T130000Z" });

  it("fuehrt die bestehende Lektion weiter statt eine zweite anzulegen", () => {
    const res = resolveCalendarIdentity({
      calEventId: "08trcp9m_20260904T130000Z",
      studentId: "luca",
      start: START,
      sessions: [alt],
      googleEventIds: new Set(["08trcp9m_20260904T130000Z"]),
    });
    expect(res).toMatchObject({ kind: "replace" });
  });
});

describe("C — die alte ID gibt es in Google noch", () => {
  it("legt nicht zusammen: zwei echte Termine zur selben Zeit", () => {
    const alt = candidate({ id: "a", calEventId: "termin-a" });
    const res = resolveCalendarIdentity({
      calEventId: "termin-b",
      studentId: "luca",
      start: START,
      sessions: [alt],
      // Beide Termine stehen im Kalender.
      googleEventIds: new Set(["termin-a", "termin-b"]),
    });
    expect(res).toEqual({ kind: "new" });
  });
});

describe("D — zwei Lektionen kommen in Frage", () => {
  it("raet nicht und legt nichts zusammen", () => {
    const a = candidate({ id: "a", calEventId: "weg-a" });
    const b = candidate({ id: "b", calEventId: "weg-b" });
    const res = resolveCalendarIdentity({
      calEventId: "neu",
      studentId: "luca",
      start: START,
      sessions: [a, b],
      googleEventIds: new Set(["neu"]),
    });
    expect(res.kind).toBe("ambiguous");
    if (res.kind !== "ambiguous") return;
    expect(res.sessions.map((s) => s.id).sort()).toEqual(["a", "b"]);
  });
});

describe("E — anderer Schueler zur selben Zeit", () => {
  it("wird nie zusammengelegt", () => {
    const fremd = candidate({ id: "fremd", studentId: "felix", calEventId: "weg" });
    const res = resolveCalendarIdentity({
      calEventId: "neu",
      studentId: "luca",
      start: START,
      sessions: [fremd],
      googleEventIds: new Set(["neu"]),
    });
    expect(res).toEqual({ kind: "new" });
  });
});

describe("F — der Termin wurde verschoben", () => {
  const alt = candidate({ id: "alt", calEventId: "weg" });
  const spaeter = new Date(START.getTime() + 60 * 60 * 1000);

  it("legt nicht zusammen — eine Stunde spaeter ist nicht dieselbe Lektion", () => {
    const res = resolveCalendarIdentity({
      calEventId: "neu",
      studentId: "luca",
      start: spaeter,
      sessions: [alt],
      googleEventIds: new Set(["neu"]),
    });
    expect(res).toEqual({ kind: "new" });
  });

  it("die alte Zeile bleibt als Waise sichtbar", () => {
    const asSession: IntegritySession = {
      id: alt.id,
      studentId: alt.studentId,
      studentName: "Luca",
      date: alt.date,
      durationMin: alt.durationMin,
      amountCHF: alt.amountCHF,
      calEventId: alt.calEventId,
    };
    expect(findOrphanSessions([asSession], new Set(["neu"])).map((s) => s.id)).toEqual(["alt"]);
  });
});

describe("G — Idempotenz", () => {
  it("der zweite Sync erkennt die Verknuepfung und aendert nichts mehr", () => {
    // Zustand NACH der Ersetzung: die Zeile traegt die neue ID.
    const nachher = candidate({ id: "luca-alt", calEventId: "neu" });
    const res = resolveCalendarIdentity({
      calEventId: "neu",
      studentId: "luca",
      start: START,
      sessions: [nachher],
      googleEventIds: new Set(["neu"]),
    });
    expect(res).toEqual({ kind: "linked", sessionId: "luca-alt" });
  });
});

describe("Zusatzsicherungen", () => {
  it("Q1-Importe sind nie Ersatzkandidat", () => {
    const manuell = candidate({ id: "q1", calEventId: "manual-2026-01-13-luca" });
    expect(
      resolveCalendarIdentity({
        calEventId: "neu",
        studentId: "luca",
        start: START,
        sessions: [manuell],
        googleEventIds: new Set(["neu"]),
      })
    ).toEqual({ kind: "new" });
  });

  it("Lektionen ohne Kalender-ID sind nie Ersatzkandidat", () => {
    const frei = candidate({ id: "frei", calEventId: null });
    expect(
      resolveCalendarIdentity({
        calEventId: "neu",
        studentId: "luca",
        start: START,
        sessions: [frei],
        googleEventIds: new Set(["neu"]),
      })
    ).toEqual({ kind: "new" });
  });

  it("dieselbe Lektion wird im selben Lauf nicht zweimal vergeben", () => {
    const alt = candidate({ id: "alt", calEventId: "weg" });
    const erste = resolveCalendarIdentity({
      calEventId: "neu-1",
      studentId: "luca",
      start: START,
      sessions: [alt],
      googleEventIds: new Set(["neu-1", "neu-2"]),
    });
    expect(erste).toMatchObject({ kind: "replace" });
    // Der zweite neue Termin darf dieselbe Zeile nicht noch einmal beanspruchen —
    // sonst ueberschriebe er die erste Zuordnung und eine echte Lektion verschwaende.
    const zweite = resolveCalendarIdentity({
      calEventId: "neu-2",
      studentId: "luca",
      start: START,
      sessions: [alt],
      googleEventIds: new Set(["neu-1", "neu-2"]),
      claimedSessionIds: new Set(["alt"]),
    });
    expect(zweite).toEqual({ kind: "new" });
  });
});

describe("H/I/J — was eine Ersetzung anfassen darf", () => {
  const historisch = { durationMin: 60, amountCHF: 90 };

  it("J — nicht ausgelieferter Monat: normale Sync-Semantik", () => {
    const plan = identityReplacementPlan({
      existing: historisch,
      incoming: { durationMin: 50, amountCHF: 75 },
      monthDelivered: false,
    });
    expect(plan).toEqual({ updateEditableFields: true, preserved: [] });
  });

  it("H — ausgelieferter Monat, deckungsgleicher Termin: nur die Verknuepfung", () => {
    const plan = identityReplacementPlan({
      existing: historisch,
      incoming: { durationMin: 60, amountCHF: 90 },
      monthDelivered: true,
    });
    expect(plan).toEqual({ updateEditableFields: false, preserved: [] });
  });

  it("I — ausgelieferter Monat mit anderer Dauer: historische Werte bleiben, Befund entsteht", () => {
    const plan = identityReplacementPlan({
      existing: historisch,
      incoming: { durationMin: 50, amountCHF: 75 },
      monthDelivered: true,
    });
    expect(plan.updateEditableFields).toBe(false);
    expect(plan.preserved).toEqual([
      { field: "durationMin", historic: 60, incoming: 50 },
      { field: "amountCHF", historic: 90, incoming: 75 },
    ]);
  });

  it("Rappen-Rauschen ist keine Abweichung", () => {
    const plan = identityReplacementPlan({
      existing: { durationMin: 60, amountCHF: 90.004 },
      incoming: { durationMin: 60, amountCHF: 89.999 },
      monthDelivered: true,
    });
    expect(plan.preserved).toEqual([]);
  });
});

/**
 * September 2026, echte Daten: vier Freitage, je eine alte 60-Minuten-Zeile aus
 * der Serie `_6ksjecq…` und ein neuer 50-Minuten-Termin aus `08trcp9m…` zur
 * exakt selben Startzeit. Ohne Stage 2 sind daraus acht Zeilen geworden.
 */
describe("September-Simulation Luca", () => {
  const LUCA = "cmsm4xx650001cn3vfd3iypo9";
  const paare = [
    { tag: "04", sessionId: "cmta6mb9v00ejw1ymiuo2ett4" },
    { tag: "11", sessionId: "cmta6mbxo00evw1ym8ckmqaja" },
    { tag: "18", sessionId: "cmta6mdt400ftw1ym6781h17k" },
    { tag: "25", sessionId: "cmta6mfwi00gvw1ymopnj7a1l" },
  ].map((p) => ({
    ...p,
    start: new Date(`2026-09-${p.tag}T13:00:00.000Z`),
    alteId: `_6ksjecq568s3ib9j8kq42b9k74qk8ba18orjib9o60q30e9i8l0kccq36k_202609${p.tag}T130000Z`,
    neueId: `08trcp9m0b8eeh49vfi420j3fc_202609${p.tag}T130000Z`,
  }));

  // Der Kalender liefert nur noch die neue Serie — genau das war der Befund.
  const googleEventIds = new Set(paare.map((p) => p.neueId));
  const bestand: IdentityCandidate[] = paare.map((p) => ({
    id: p.sessionId,
    studentId: LUCA,
    date: p.start,
    durationMin: 60,
    amountCHF: 90,
    calEventId: p.alteId,
  }));

  it("haette je Lektion EINE Zeile ergeben, mit der neuen Kalender-ID", () => {
    const claimed = new Set<string>();
    const ergebnis = paare.map((p) => {
      const res = resolveCalendarIdentity({
        calEventId: p.neueId,
        studentId: LUCA,
        start: p.start,
        sessions: bestand,
        googleEventIds,
        claimedSessionIds: claimed,
      });
      if (res.kind === "replace") claimed.add(res.session.id);
      return res;
    });
    expect(ergebnis.every((r) => r.kind === "replace")).toBe(true);
    expect(
      ergebnis.map((r) => (r.kind === "replace" ? r.session.id : null))
    ).toEqual(paare.map((p) => p.sessionId));
    // Vier Ersetzungen, vier verschiedene Zeilen — keine wird doppelt vergeben.
    expect(claimed.size).toBe(4);
  });

  it("September ist nicht ausgeliefert: Dauer und Betrag ziehen mit", () => {
    const plan = identityReplacementPlan({
      existing: { durationMin: 60, amountCHF: 90 },
      incoming: { durationMin: 50, amountCHF: 75 },
      monthDelivered: false,
    });
    expect(plan.updateEditableFields).toBe(true);
  });
});

describe("Quellpruefung", () => {
  it("das Modul kennt keine Datenbank", () => {
    const src = readFileSync(path.join(__dirname, "calendar-identity.ts"), "utf8");
    expect(src).not.toMatch(/prisma|\$transaction|findMany|update\(/);
  });
});
