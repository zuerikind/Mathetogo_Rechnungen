import { describe, expect, it } from "vitest";
import {
  parseSessionIds,
  shapeInvoiceSnapshot,
  type ShapeInput,
  type ShapeMember,
  type ShapeSession,
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
