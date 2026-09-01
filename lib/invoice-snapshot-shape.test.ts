import { describe, expect, it } from "vitest";
import {
  parseSessionIds,
  shapeInvoiceSnapshot,
  type ShapeInput,
  type ShapeMember,
  type ShapeSession,
  shapeSnapshotFromGeneration,
  pickStoredGenerationPayload,
  visibleSections,
  invoiceRecipientName,
} from "./invoice-snapshot-shape";

const FROZEN = new Date("2026-08-02T09:00:00Z");

const liam: ShapeMember = { id: "s-liam", name: "Liam", subject: "Mathematik" };
const mila: ShapeMember = { id: "s-mila", name: "Mila", subject: "Physik" };

const session = (over: Partial<ShapeSession> & { id: string; student: ShapeMember }): ShapeSession => ({
  studentId: over.student.id,
  date: new Date("2026-07-03T08:30:00Z"),
  durationMin: 50,
  amountCHF: 55,
  ...over,
});

function input(over: Partial<ShapeInput> = {}): ShapeInput {
  const sessions = over.sessions ?? [session({ id: "x1", student: liam })];
  return {
    invoice: {
      id: "inv-1",
      studentId: liam.id,
      year: 2026,
      month: 7,
      totalCHF: 55,
      invoiceNumber: "2026-0106",
      revision: 1,
      pdfPath: "https://example.test/2026-07-s-liam.pdf",
      sentAt: null,
      paidAt: null,
      createdAt: new Date("2026-08-01T10:00:00Z"),
      ...over.invoice,
    },
    root: over.root === undefined ? liam : over.root,
    children: over.children ?? [],
    sessions,
    sessionIds: over.sessionIds ?? sessions.map((s) => s.id),
    subscriptionLines: over.subscriptionLines ?? [],
    frozenAt: over.frozenAt ?? FROZEN,
  };
}

describe("parseSessionIds", () => {
  it("liest gespeicherte IDs und verträgt kaputte Werte", () => {
    expect(parseSessionIds('["a","b"]')).toEqual(["a", "b"]);
    expect(parseSessionIds("")).toEqual([]);
    expect(parseSessionIds("kein json")).toEqual([]);
    expect(parseSessionIds('["a",7,null]')).toEqual(["a"]);
  });
});

describe("shapeInvoiceSnapshot", () => {
  it("friert Positionen, Zwischensumme und Gesamtbetrag ein", () => {
    const snap = shapeInvoiceSnapshot(
      input({
        sessions: [
          session({ id: "x1", student: liam, amountCHF: 55 }),
          session({ id: "x2", student: liam, amountCHF: 66 }),
        ],
        invoice: { totalCHF: 121 } as ShapeInput["invoice"],
      })
    );
    expect(snap.sections).toHaveLength(1);
    expect(snap.sections[0].sessions.map((s) => s.id)).toEqual(["x1", "x2"]);
    expect(snap.sections[0].subtotalCHF).toBe(121);
    expect(snap.sessionsSubtotalCHF).toBe(121);
    expect(snap.totalCHF).toBe(121);
    expect(snap.frozenAt).toBe(FROZEN.toISOString());
  });

  it("übernimmt totalCHF aus der Rechnungszeile, nicht aus den Sessions", () => {
    // Der Betrag auf dem PDF gilt — auch wenn die Sessions inzwischen anders summieren.
    const snap = shapeInvoiceSnapshot(
      input({
        sessions: [session({ id: "x1", student: liam, amountCHF: 40 })],
        invoice: { totalCHF: 55 } as ShapeInput["invoice"],
      })
    );
    expect(snap.totalCHF).toBe(55);
    expect(snap.sessionsSubtotalCHF).toBe(40);
  });

  it("hält Familienabschnitte getrennt, Hauptschüler zuerst", () => {
    const snap = shapeInvoiceSnapshot(
      input({
        children: [mila],
        sessions: [
          session({ id: "m1", student: mila, amountCHF: 60 }),
          session({ id: "l1", student: liam, amountCHF: 55 }),
        ],
        invoice: { totalCHF: 115 } as ShapeInput["invoice"],
      })
    );
    expect(snap.sections.map((s) => s.studentName)).toEqual(["Liam", "Mila"]);
    expect(snap.sections[0].subtotalCHF).toBe(55);
    expect(snap.sections[1].subtotalCHF).toBe(60);
    expect(snap.sessionsSubtotalCHF).toBe(115);
  });

  it("vermerkt gelöschte Sessions statt sie stillschweigend zu verlieren", () => {
    const snap = shapeInvoiceSnapshot(
      input({
        sessions: [session({ id: "x1", student: liam })],
        sessionIds: ["x1", "weg-1", "weg-2"],
      })
    );
    expect(snap.missingSessionIds).toEqual(["weg-1", "weg-2"]);
    expect(snap.sessionIds).toHaveLength(3);
  });

  it("behält den Hauptschüler ohne Lektionen, andere nur mit", () => {
    const snap = shapeInvoiceSnapshot(input({ children: [mila], sessions: [] , sessionIds: [] }));
    expect(snap.sections.map((s) => s.studentId)).toEqual([liam.id]);
    expect(snap.sections[0].subtotalCHF).toBe(0);
  });

  it("rechnet Abo-Zeilen in die Abo-Summe, nicht in die Lektionssumme", () => {
    const snap = shapeInvoiceSnapshot(
      input({
        subscriptionLines: [{ id: "sub-1", description: "Mathetogo Abo (6 Monate)", amountCHF: 262.5 }],
        invoice: { totalCHF: 317.5 } as ShapeInput["invoice"],
      })
    );
    expect(snap.subscriptionTotalCHF).toBe(262.5);
    expect(snap.sessionsSubtotalCHF).toBe(55);
    expect(snap.totalCHF).toBe(317.5);
  });
});

/**
 * Regression: der Snapshot beschrieb etwas anderes als das ausgelieferte PDF.
 *
 * Vorher entstand er erst beim Ausliefern und las die Lektionen dabei FRISCH aus
 * der Datenbank, waehrend `totalCHF` aus der Rechnungszeile kam. Aenderte ein
 * Kalender-Sync zwischen Erzeugen und Ausliefern einen Betrag, widersprach der
 * "eingefrorene" Stand dem Dokument beim Kunden — und die Abweichungserkennung
 * meldete nichts, weil sie den geaenderten Stand gegen sich selbst verglich.
 */
describe("shapeSnapshotFromGeneration", () => {
  const d = (s: string) => new Date(`2026-08-${s}T09:00:00Z`);
  const KIND_A = { id: "stud-a", name: "Anna", subject: "Mathe" };
  const KIND_B = { id: "stud-b", name: "Ben", subject: "Physik" };

  /** Der Payload, aus dem das PDF gerendert wurde: A, B, C zu je 60.00. */
  const generationPayload = {
    student: KIND_A,
    sections: [
      {
        student: KIND_A,
        sessions: [
          { id: "A", date: d("03"), durationMin: 60, amountCHF: 60 },
          { id: "B", date: d("10"), durationMin: 60, amountCHF: 60 },
          { id: "C", date: d("17"), durationMin: 60, amountCHF: 60 },
        ],
        subtotalCHF: 180,
      },
    ],
    subscriptionLines: [],
    totalCHF: 180,
    year: 2026,
    month: 8,
    invoiceNumber: "2026-0118",
  };

  const invoiceRow = {
    id: "inv-1",
    revision: 1,
    pdfPath: "2026-08-stud-a.pdf",
    createdAt: new Date("2026-08-31T10:00:00Z"),
    sentAt: null,
    paidAt: null,
  };

  const generated = shapeSnapshotFromGeneration({
    payload: generationPayload,
    invoice: invoiceRow,
    generatedAt: new Date("2026-08-31T10:00:00Z"),
  });

  it("beschreibt genau die erzeugten Lektionen", () => {
    expect(generated.sessionIds).toEqual(["A", "B", "C"]);
    expect(generated.sections[0].sessions.map((s) => s.amountCHF)).toEqual([60, 60, 60]);
    expect(generated.missingSessionIds).toEqual([]);
  });

  it("Kopfbetrag und Positionen stammen aus DEMSELBEN Payload", () => {
    // Der Kern des Fehlers: vorher kam totalCHF aus der Zeile und die Positionen
    // aus einer spaeteren Abfrage. Sie konnten sich widersprechen.
    expect(generated.totalCHF).toBe(180);
    expect(generated.sessionsSubtotalCHF).toBe(180);
    expect(generated.sections[0].subtotalCHF).toBe(180);
    expect(generated.totalCHF).toBe(generated.sessionsSubtotalCHF + generated.subscriptionTotalCHF);
  });

  it("DER Regressionsfall: spaetere Aenderungen an den Lektionen aendern ihn nicht", () => {
    // 1.-2. erzeugt und PDF gebaut (oben).
    // 3. Kalender-Sync aendert C von 60 auf 120 und loescht B.
    const liveNachAenderung = [
      { id: "A", amountCHF: 60 },
      { id: "C", amountCHF: 120 },
    ];
    // 4.-5. Ausliefern friert den GESPEICHERTEN Stand ein, nicht den neuen.
    const eingefroren = pickStoredGenerationPayload(JSON.parse(JSON.stringify(generated)));
    expect(eingefroren).not.toBeNull();
    expect(eingefroren!.sessionIds).toEqual(["A", "B", "C"]);
    expect(eingefroren!.totalCHF).toBe(180);
    // 6. Der eingefrorene Stand stimmt mit dem PDF ueberein, nicht mit den Live-Daten.
    const liveSumme = liveNachAenderung.reduce((a, s) => a + s.amountCHF, 0);
    expect(liveSumme).toBe(180); // gleiche Summe, ANDERE Positionen …
    expect(eingefroren!.sessionIds).not.toEqual(liveNachAenderung.map((s) => s.id));
    // … genau deshalb reicht ein Summenvergleich nicht.
  });

  it("ohne Aenderung ist der eingefrorene Stand identisch", () => {
    const wieder = shapeSnapshotFromGeneration({
      payload: generationPayload,
      invoice: invoiceRow,
      generatedAt: new Date("2026-08-31T10:00:00Z"),
    });
    expect(wieder).toEqual(generated);
  });

  it("Familienrechnung: jede Lektion genau einmal, Abschnitte pro Kind", () => {
    const familie = shapeSnapshotFromGeneration({
      payload: {
        ...generationPayload,
        sections: [
          { student: KIND_A, sessions: [{ id: "A", date: d("03"), durationMin: 60, amountCHF: 60 }], subtotalCHF: 60 },
          { student: KIND_B, sessions: [{ id: "B", date: d("04"), durationMin: 90, amountCHF: 90 }], subtotalCHF: 90 },
        ],
        subscriptionLines: [{ id: "sub-1", description: "Abo", amountCHF: 30 }],
        totalCHF: 180,
      },
      invoice: invoiceRow,
      generatedAt: new Date("2026-08-31T10:00:00Z"),
    });
    expect(familie.sections.map((s) => s.studentId)).toEqual(["stud-a", "stud-b"]);
    expect(familie.sessionIds).toEqual(["A", "B"]);
    expect(familie.sessionsSubtotalCHF).toBe(150);
    expect(familie.subscriptionTotalCHF).toBe(30);
    expect(familie.sessionsSubtotalCHF + familie.subscriptionTotalCHF).toBe(familie.totalCHF);
  });

  it("Betraege werden nicht neu gerundet, nur uebernommen", () => {
    const krumm = shapeSnapshotFromGeneration({
      payload: {
        ...generationPayload,
        sections: [{ student: KIND_A, sessions: [{ id: "A", date: d("03"), durationMin: 35, amountCHF: 57.75 }], subtotalCHF: 57.75 }],
        totalCHF: 57.75,
      },
      invoice: invoiceRow,
      generatedAt: new Date("2026-08-31T10:00:00Z"),
    });
    expect(krumm.totalCHF).toBe(57.75);
    expect(krumm.sessionsSubtotalCHF).toBe(57.75);
  });
});

describe("pickStoredGenerationPayload — Auswahl zwischen gespeichert und live", () => {
  const gueltig = { sessionIds: ["A"], totalCHF: 60, sections: [] };

  it("gespeicherter Stand gewinnt", () => {
    expect(pickStoredGenerationPayload(gueltig)).toBe(gueltig);
  });

  it("Altbestand ohne gespeicherten Stand faellt auf die Live-Abfrage zurueck", () => {
    // null = der Aufrufer nimmt buildInvoiceSnapshotPayload. Bestandsrechnungen
    // verhalten sich damit exakt wie vorher; es wird nichts umgeschrieben.
    expect(pickStoredGenerationPayload(null)).toBeNull();
    expect(pickStoredGenerationPayload(undefined)).toBeNull();
  });

  it("unbrauchbare Staende werden verworfen statt blind uebernommen", () => {
    expect(pickStoredGenerationPayload({})).toBeNull();
    expect(pickStoredGenerationPayload([])).toBeNull();
    expect(pickStoredGenerationPayload("kaputt")).toBeNull();
    expect(pickStoredGenerationPayload({ sessionIds: ["A"] })).toBeNull();
    expect(pickStoredGenerationPayload({ sessionIds: ["A"], totalCHF: NaN, sections: [] })).toBeNull();
    expect(pickStoredGenerationPayload({ totalCHF: 60, sections: [] })).toBeNull();
    expect(pickStoredGenerationPayload({ sessionIds: ["A"], totalCHF: 60 })).toBeNull();
  });

  it("ein leerer, aber gueltiger Stand ist brauchbar", () => {
    const leer = { sessionIds: [], totalCHF: 0, sections: [] };
    expect(pickStoredGenerationPayload(leer)).toBe(leer);
  });
});

describe("visibleSections — leerer Abschnitt des Zahlers", () => {
  const sec = (id: string, n: number) => ({ student: { id }, sessions: Array(n).fill(0) });

  it("laesst den Zahler weg, wenn er nur fuer seine Kinder zahlt", () => {
    // Vorher stand "Zwischensumme Nikola CHF 0.00" auf dem Beleg.
    const out = visibleSections([sec("nikola", 0), sec("william", 4)], "nikola");
    expect(out.map((s) => s.student.id)).toEqual(["william"]);
  });

  it("laesst Kinder ohne Lektionen weg, behaelt den Zahler mit Lektionen", () => {
    const out = visibleSections([sec("vincent", 7), sec("aurel", 0), sec("elenor", 4)], "vincent");
    expect(out.map((s) => s.student.id)).toEqual(["vincent", "elenor"]);
  });

  it("behaelt den Zahler, wenn sonst gar kein Abschnitt bliebe (z. B. reine Abo-Rechnung)", () => {
    const out = visibleSections([sec("nikola", 0), sec("william", 0)], "nikola");
    expect(out.map((s) => s.student.id)).toEqual(["nikola"]);
  });
});

describe("invoiceRecipientName — wer steht oben auf dem Beleg", () => {
  const sec = (id: string, name: string) => ({ student: { id, name } });

  it("nennt den Zahler UND das Kind, auch wenn nur das Kind Lektionen hat", () => {
    // Nikola zahlt fuer William; Williams Abschnitt ist der einzige.
    expect(invoiceRecipientName({ id: "nikola", name: "Nikola" }, [sec("william", "William")]))
      .toBe("Nikola & William");
  });

  it("Familienrechnung bleibt unveraendert", () => {
    expect(
      invoiceRecipientName({ id: "vincent", name: "Vincent" }, [
        sec("vincent", "Vincent"),
        sec("aurel", "Aurel"),
        sec("elenor", "Elenor"),
      ])
    ).toBe("Vincent & Aurel & Elenor");
  });

  it("Einzelrechnung nennt nur den Schueler selbst", () => {
    expect(invoiceRecipientName({ id: "aditya", name: "Aditya" }, [sec("aditya", "Aditya")]))
      .toBe("Aditya");
  });
});
