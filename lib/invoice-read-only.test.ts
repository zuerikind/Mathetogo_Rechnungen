import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression: GET /api/invoices raeumte auf.
 *
 * Der Endpunkt rief pruneStaleInvoicesInScope und loeschte dabei Rechnungszeilen
 * samt PDF im Storage — bei jedem Prefetch, jedem Retry, jedem doppelten Rendern.
 * Ein Lesezugriff darf das nicht.
 *
 * Diese Pruefung liest die Quelle statt sie auszufuehren: die Route haengt an
 * Prisma, Supabase und auth, und genau das soll hier nicht angefasst werden.
 * Sie faellt zuverlaessig, wenn jemand das Aufraeumen in den GET zurueckholt.
 */

const repoRoot = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

/** Kommentare weg — sie erwaehnen den frueheren Aufruf ausdruecklich. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const invoicesRoute = code(read("app/api/invoices/route.ts"));
const cleanupRoute = code(read("app/api/invoices/cleanup/route.ts"));

describe("GET /api/invoices ist rein lesend", () => {
  it("raeumt keine Rechnungen mehr auf", () => {
    expect(invoicesRoute).not.toContain("pruneStaleInvoicesInScope");
    expect(invoicesRoute).not.toContain("pruneStaleInvoiceIfUnbillable");
    expect(invoicesRoute).not.toContain("removeInvoiceWhenUnbillable");
  });

  it("importiert das Aufraeum-Modul gar nicht erst", () => {
    expect(invoicesRoute).not.toContain("invoice-stale");
  });

  it("schreibt und loescht nichts", () => {
    for (const verb of [
      ".delete(",
      ".deleteMany(",
      ".update(",
      ".updateMany(",
      ".create(",
      ".createMany(",
      ".upsert(",
      "storage",
    ]) {
      expect(invoicesRoute).not.toContain(verb);
    }
  });

  it("bietet nur GET an", () => {
    expect(invoicesRoute).toContain("export async function GET");
    expect(invoicesRoute).not.toContain("export async function POST");
    expect(invoicesRoute).not.toContain("export async function DELETE");
    expect(invoicesRoute).not.toContain("export async function PUT");
    expect(invoicesRoute).not.toContain("export async function PATCH");
  });
});

describe("Aufraeumen laeuft ueber einen ausdruecklichen Endpunkt", () => {
  it("existiert als POST", () => {
    expect(cleanupRoute).toContain("export async function POST");
    expect(cleanupRoute).toContain("pruneStaleInvoicesInScope");
  });

  it("bietet kein GET an", () => {
    expect(cleanupRoute).not.toContain("export async function GET");
  });

  it("verlangt eine angemeldete Sitzung", () => {
    expect(cleanupRoute).toContain("await auth()");
    expect(cleanupRoute).toContain("Unauthorized");
  });

  it("meldet Fehler, statt sie zu schlucken", () => {
    expect(cleanupRoute).toContain("status: 500");
  });
});

describe("die Schutzbedingungen bleiben im Aufraeum-Modul", () => {
  const stale = code(read("lib/invoice-stale.ts"));

  it("prueft ausgelieferte Rechnungen ueber das gemeinsame Praedikat", () => {
    expect(stale).toContain("isPrunableDraft");
    expect(stale).toContain("DELIVERED_INVOICE_WHERE");
  });

  it("holt nur Entwuerfe in den Aufraeum-Umfang", () => {
    // pruneStaleInvoicesInScope filtert bereits in der Abfrage auf sentAt/paidAt null.
    expect(stale).toContain("sentAt: null");
    expect(stale).toContain("paidAt: null");
  });
});

describe("Aufraeumen prueft die Schutzbedingungen VOR dem Loeschen", () => {
  const stale = code(read("lib/invoice-stale.ts"));

  it("isPrunableDraft steht vor jedem invoice.delete", () => {
    const guardAt = stale.indexOf("isPrunableDraft");
    const deleteAt = stale.indexOf("prisma.invoice.delete");
    expect(guardAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(deleteAt);
  });

  it("der Betrags-Check steht ebenfalls vor dem Loeschen", () => {
    // Nur wenn nichts mehr abrechenbar ist, darf ueberhaupt geloescht werden.
    expect(stale.indexOf("if (billable > 0) return false;")).toBeLessThan(
      stale.indexOf("prisma.invoice.delete")
    );
  });

  it("die PDF im Storage wird erst nach dem Zeilen-Delete angefasst", () => {
    // Reihenfolge ist Absicht: schlaegt das Delete fehl, bleibt auch der Beleg liegen.
    expect(stale.indexOf("prisma.invoice.delete")).toBeLessThan(stale.indexOf(".remove("));
  });
});

/**
 * Regression: der Monatsexport fror Rechnungen fortlaufend ein.
 *
 * Brach er beim fuenften Schueler ab, waren die ersten vier unveraenderlich
 * ausgeliefert — obwohl der Nutzer eine Fehlermeldung sah und nie ein Archiv
 * bekam. Korrigierbar nur noch ueber eine Revision. Jetzt in Phasen: erst alle
 * PDFs, dann das Archiv, und erst danach die Auslieferungs-Markierung.
 */
describe("ZIP-Export friert erst ein, wenn das Archiv steht", () => {
  const zipRoute = code(read("app/api/invoices/download/route.ts"));

  it("sammelt die Rechnungen, statt sie sofort einzufrieren", () => {
    expect(zipRoute).toContain("zuFrieren.push(");
  });

  it("kein recordInvoiceDownload VOR dem Archivbau", () => {
    const archiv = zipRoute.indexOf("zip.generateAsync");
    const ersterFreeze = zipRoute.indexOf("recordInvoiceDownload(");
    expect(archiv).toBeGreaterThan(-1);
    expect(ersterFreeze).toBeGreaterThan(-1);
    // Der einzige Aufruf steht hinter dem Archivbau.
    expect(ersterFreeze).toBeGreaterThan(archiv);
  });

  it("genau EIN Freeze-Aufruf, in der Schlussphase", () => {
    const treffer = zipRoute.match(/recordInvoiceDownload\(/g) ?? [];
    expect(treffer).toHaveLength(1);
  });

  it("ein Fehler beim Einfrieren verhindert das fertige Archiv nicht", () => {
    // Sonst haette der Nutzer PDFs in der Hand, die als nicht ausgeliefert gelten.
    const freezeBlock = zipRoute.slice(zipRoute.indexOf("zip.generateAsync"));
    expect(freezeBlock).toContain("try {");
    expect(freezeBlock).toContain("catch");
    expect(freezeBlock).toContain("console.error");
  });

  it("der Export bleibt POST — kein GET friert etwas ein", () => {
    expect(zipRoute).toContain("export async function POST");
    expect(zipRoute).not.toContain("export async function GET");
  });

  it("Nummernvergabe und Sperre bleiben unangetastet", () => {
    // reserveInvoiceRow traegt Advisory-Lock und Nummernwiederverwendung; ein
    // Wiederholungslauf bekommt deshalb dieselbe Nummer und legt keine zweite Zeile an.
    expect(zipRoute).toContain("reserveInvoiceRow");
    const invoiceLib = code(read("lib/invoice.ts"));
    expect(invoiceLib).toContain("pg_advisory_xact_lock");
    expect(invoiceLib).toContain("existingNumber?.length");
  });
});

describe("Erzeugungsstand ist die einzige Quelle beim Einfrieren", () => {
  const dl = code(read("lib/invoice-download.ts"));
  const snap = code(read("lib/invoice-snapshot.ts"));
  const inv = code(read("lib/invoice.ts"));

  it("beide Freeze-Pfade nehmen den gespeicherten Erzeugungsstand", () => {
    expect(dl).toContain("resolveSnapshotPayload");
    expect(dl).not.toContain("buildInvoiceSnapshotPayload");
    const treffer = dl.match(/resolveSnapshotPayload\(/g) ?? [];
    expect(treffer).toHaveLength(2); // freezeInvoiceSnapshot + recordInvoiceDownload
  });

  it("die Live-Abfrage bleibt nur als Rueckfall fuer Altbestand", () => {
    expect(snap).toContain("pickStoredGenerationPayload");
    expect(snap).toContain("buildInvoiceSnapshotPayload");
  });

  it("der Erzeugungsstand wird zusammen mit Betrag, Positionen und Pfad geschrieben", () => {
    expect(inv).toContain("generatedPayloadJson");
    expect(inv).toContain("shapeSnapshotFromGeneration");
    // Ein Datensatz, ein update — nicht in getrennten Schritten.
    const commit = inv.slice(inv.indexOf("export async function commitInvoiceContent"));
    expect(commit.indexOf("totalCHF: payload.totalCHF")).toBeGreaterThan(-1);
    expect(commit.indexOf("generatedPayloadJson")).toBeGreaterThan(-1);
  });

  it("die Neuausstellung fragt die Lektionen ebenfalls nicht erneut ab", () => {
    const rev = code(read("lib/invoice-revision.ts"));
    expect(rev).toContain("shapeSnapshotFromGeneration");
    expect(rev).not.toContain("buildInvoiceSnapshotPayload");
  });
});
