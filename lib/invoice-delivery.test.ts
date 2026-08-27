import { describe, expect, it } from "vitest";
import {
  BILLED_ELSEWHERE_WHERE,
  DELIVERED_INVOICE_WHERE,
  isBilledElsewhere,
  isDelivered,
  isPrunableDraft,
} from "./invoice-delivery";

const at = new Date("2026-08-02T08:57:20Z");
const none = { sentAt: null, paidAt: null, firstDownloadedAt: null };

describe("isDelivered", () => {
  it("is false only while nothing has gone out", () => {
    expect(isDelivered(none)).toBe(false);
  });

  it("counts a download as delivered, not just sent or paid", () => {
    expect(isDelivered({ ...none, firstDownloadedAt: at })).toBe(true);
    expect(isDelivered({ ...none, sentAt: at })).toBe(true);
    expect(isDelivered({ ...none, paidAt: at })).toBe(true);
  });

  it("keeps the Prisma filter in sync with the predicate", () => {
    // NOT(alle null) muss dieselben Felder pruefen wie isDelivered — seit dem
    // Audit vier, weil `voidedAt` dazugekommen ist (storniert = ausgeliefert).
    // Der Vergleich laeuft gegen die Felder, die das Praedikat tatsaechlich liest,
    // nicht gegen `none`: `voidedAt` ist dort optional und darf fehlen duerfen.
    const feldeDesPraedikats = ["sentAt", "paidAt", "firstDownloadedAt", "voidedAt"];
    expect(Object.keys(DELIVERED_INVOICE_WHERE.NOT).sort()).toEqual(feldeDesPraedikats.sort());
    // Und jedes einzelne Feld macht die Rechnung fuer sich genommen ausgeliefert:
    for (const feld of feldeDesPraedikats) {
      expect(isDelivered({ ...none, [feld]: at })).toBe(true);
    }
  });
});

/**
 * Das Aufraeumen stale gewordener Entwuerfe lief frueher als Nebenwirkung im GET
 * von /api/invoices — ein Lesezugriff, der Zeilen und PDFs loeschte. Es laeuft
 * jetzt nur noch ueber Mutationen; die Schutzbedingungen sind unveraendert und
 * stehen hier fest.
 */
describe("isPrunableDraft", () => {
  it("ein reiner Entwurf darf weg", () => {
    expect(isPrunableDraft(none)).toBe(true);
  });

  it("bezahlt wird nie entfernt", () => {
    expect(isPrunableDraft({ ...none, paidAt: at })).toBe(false);
    expect(isPrunableDraft({ ...none, paidAt: at }, { includeSent: true })).toBe(false);
  });

  it("heruntergeladen wird nie entfernt", () => {
    // Ab dem ersten Download ist die Rechnung ausgeliefert und unveraenderlich —
    // der Snapshot verweist auf ihre Positionen.
    expect(isPrunableDraft({ ...none, firstDownloadedAt: at })).toBe(false);
    expect(isPrunableDraft({ ...none, firstDownloadedAt: at }, { includeSent: true })).toBe(false);
  });

  it("gesendet nur mit ausdruecklichem includeSent", () => {
    expect(isPrunableDraft({ ...none, sentAt: at })).toBe(false);
    expect(isPrunableDraft({ ...none, sentAt: at }, { includeSent: true })).toBe(true);
  });

  it("gesendet UND heruntergeladen bleibt auch mit includeSent geschuetzt", () => {
    expect(
      isPrunableDraft({ ...none, sentAt: at, firstDownloadedAt: at }, { includeSent: true })
    ).toBe(false);
  });

  it("was ausgeliefert ist, ist nie ohne Weiteres entfernbar", () => {
    // Die Gegenrichtung von isDelivered: ohne includeSent duerfen sich die beiden
    // Praedikate nie ueberschneiden.
    const faelle = [
      { ...none, sentAt: at },
      { ...none, paidAt: at },
      { ...none, firstDownloadedAt: at },
    ];
    for (const f of faelle) {
      expect(isDelivered(f)).toBe(true);
      expect(isPrunableDraft(f)).toBe(false);
    }
  });
});

/**
 * Storno-Semantik. Vor dem Audit hatte KEIN Test `voidedAt` beruehrt — das ist
 * der Grund, warum gleich mehrere Loecher darin ueberlebt haben.
 */
describe("voidedAt in der Auslieferungs-Semantik", () => {
  const voided = { ...none, voidedAt: at };

  it("storniert zaehlt als ausgeliefert", () => {
    // voidInvoice setzt paidAt zurueck. War die Rechnung NUR ueber paidAt
    // ausgeliefert, fiel sie danach auf "Entwurf" — und Entwuerfe werden
    // ueberschrieben und geloescht. Nummer und Beleg waeren verschwunden.
    expect(isDelivered(voided)).toBe(true);
    expect(isDelivered({ ...none, paidAt: at })).toBe(true);
  });

  it("storniert ist nie prunebar", () => {
    expect(isPrunableDraft(voided)).toBe(false);
    expect(isPrunableDraft(voided, { includeSent: true })).toBe(false);
  });

  it("der Prisma-Filter prueft dieselben vier Felder wie das Praedikat", () => {
    expect(Object.keys(DELIVERED_INVOICE_WHERE.NOT).sort()).toEqual(
      ["firstDownloadedAt", "paidAt", "sentAt", "voidedAt"].sort()
    );
  });

  it("fehlendes voidedAt bleibt kompatibel", () => {
    // Aufrufer, die die Spalte nicht selektieren, verhalten sich wie vorher.
    expect(isDelivered({ sentAt: at, paidAt: null, firstDownloadedAt: null })).toBe(true);
    expect(isDelivered({ sentAt: null, paidAt: null, firstDownloadedAt: null })).toBe(false);
  });
});

describe("isBilledElsewhere — 'schon abgerechnet?' statt 'darf ich anfassen?'", () => {
  it("storniert rechnet NICHTS ab", () => {
    // Der Fall, der Lektionen verschwinden liess: Kind hatte eine Einzelrechnung,
    // wird der Familie zugeordnet, die Einzelrechnung wird storniert. Galt sie
    // weiter als "separat abgerechnet", blieben die Lektionen aus der
    // Familienrechnung draussen — und standen auf gar keiner Rechnung.
    expect(isBilledElsewhere({ ...none, sentAt: at, voidedAt: at })).toBe(false);
    expect(isDelivered({ ...none, sentAt: at, voidedAt: at })).toBe(true);
  });

  it("nicht storniert und ausgeliefert = abgerechnet", () => {
    expect(isBilledElsewhere({ ...none, sentAt: at })).toBe(true);
    expect(isBilledElsewhere({ ...none, paidAt: at })).toBe(true);
    expect(isBilledElsewhere({ ...none, firstDownloadedAt: at })).toBe(true);
  });

  it("reiner Entwurf rechnet nichts ab", () => {
    expect(isBilledElsewhere(none)).toBe(false);
  });

  it("Prisma-Filter spiegelt das Praedikat", () => {
    expect(BILLED_ELSEWHERE_WHERE.voidedAt).toBeNull();
    expect(BILLED_ELSEWHERE_WHERE.NOT).toEqual(DELIVERED_INVOICE_WHERE.NOT);
  });
});
