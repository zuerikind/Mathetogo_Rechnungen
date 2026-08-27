import "server-only";
import { prisma } from "@/lib/prisma";
import { resolveSnapshotPayload } from "@/lib/invoice-snapshot";

/** Woher die Auslieferung kam — nur für das Audit-Log. */
export type DownloadSource =
  | "Einzeldownload"
  | "Monatsexport (ZIP)"
  | "E-Mail-Versand"
  | "Status: gesendet"
  | "Status: bezahlt";

/**
 * Friert den Stand einer Rechnung ein, ohne sie als heruntergeladen zu markieren.
 *
 * Auslieferung ist nicht nur der Download. Eine Rechnung, die per E-Mail rausgeht
 * oder von Hand auf "gesendet"/"bezahlt" gesetzt wird, ist genauso beim Kunden —
 * bisher schrieb aber nur der Download einen Snapshot. Ergebnis im Bestand: rund
 * 100 ausgelieferte Rechnungen ohne jeden eingefrorenen Stand. Fuer die kann die
 * Abweichungserkennung nichts vergleichen (sie verlangt einen Snapshot), und was
 * fakturiert wurde, steht nur noch im PDF-Blob.
 *
 * Idempotent: der Snapshot einer Revision wird nie ueberschrieben — einmal
 * eingefroren ist eingefroren. Mehrfachaufruf ist damit unschaedlich.
 */
export async function freezeInvoiceSnapshot(
  invoiceId: string,
  actor: string,
  source: DownloadSource,
  now: Date = new Date()
): Promise<void> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true, studentId: true, year: true, month: true, totalCHF: true,
      sessionIds: true, invoiceNumber: true, revision: true, pdfPath: true,
      sentAt: true, paidAt: true, createdAt: true, generatedPayloadJson: true,
    },
  });
  if (!invoice) return;

  const existing = await prisma.invoiceSnapshot.findUnique({
    where: { invoiceId_revision: { invoiceId: invoice.id, revision: invoice.revision } },
    select: { id: true },
  });
  if (existing) return;

  const { payload: snapshot } = await resolveSnapshotPayload(invoice, now);
  await prisma.$transaction(async (tx) => {
    await tx.invoiceSnapshot.upsert({
      where: { invoiceId_revision: { invoiceId: invoice.id, revision: invoice.revision } },
      update: {},
      create: {
        invoiceId: invoice.id,
        revision: invoice.revision,
        invoiceNumber: invoice.invoiceNumber,
        totalCHF: invoice.totalCHF,
        payloadJson: snapshot,
        pdfPath: invoice.pdfPath,
      },
    });
    await tx.invoiceAuditLog.create({
      data: {
        invoiceId: invoice.id,
        action: "delivered",
        actor,
        afterJson: {
          invoiceNumber: invoice.invoiceNumber,
          revision: invoice.revision,
          totalCHF: invoice.totalCHF,
          sessionCount: snapshot.sessionIds.length,
          deliveredAt: now.toISOString(),
        },
        note: `Rechnung ausgeliefert (${source}) — Stand eingefroren.`,
      },
    });
  });
}

/**
 * Hält fest, dass eine Rechnung ausgeliefert wurde.
 *
 * Beim ERSTEN Download wird der Stand eingefroren (Snapshot + Audit-Log), jeder
 * weitere aktualisiert nur downloadedAt. Einzeldownload und ZIP-Export laufen
 * bewusst durch dieselbe Funktion: beides ist dasselbe fachliche Ereignis, und
 * zwei Implementierungen würden früher oder später auseinanderlaufen.
 */
export async function recordInvoiceDownload(
  invoiceId: string,
  actor: string,
  source: DownloadSource,
  now: Date = new Date()
): Promise<void> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      studentId: true,
      year: true,
      month: true,
      totalCHF: true,
      sessionIds: true,
      invoiceNumber: true,
      revision: true,
      pdfPath: true,
      sentAt: true,
      paidAt: true,
      createdAt: true,
      generatedPayloadJson: true,
      firstDownloadedAt: true,
    },
  });
  if (!invoice) return;

  if (invoice.firstDownloadedAt) {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { downloadedAt: now } });
    return;
  }

  const { payload: snapshot } = await resolveSnapshotPayload(invoice, now);

  await prisma.$transaction(async (tx) => {
    // Bedingtes Update: bei zwei gleichzeitigen Downloads gewinnt genau einer und
    // schreibt den Snapshot; der andere aktualisiert nur downloadedAt.
    const claimed = await tx.invoice.updateMany({
      where: { id: invoice.id, firstDownloadedAt: null },
      data: { firstDownloadedAt: now, downloadedAt: now },
    });
    if (claimed.count === 0) {
      await tx.invoice.update({ where: { id: invoice.id }, data: { downloadedAt: now } });
      return;
    }

    // upsert statt create: Ein bereits vorhandener Snapshot für diese Revision
    // (z. B. aus einer früheren Ausstellung) darf den Download nicht mit einem
    // Unique-Fehler abbrechen — in PostgreSQL würde das die ganze Transaktion
    // abbrechen und die Rechnung wäre nicht auslieferbar. Der bestehende
    // Snapshot bleibt unangetastet: einmal eingefroren ist eingefroren.
    await tx.invoiceSnapshot.upsert({
      where: { invoiceId_revision: { invoiceId: invoice.id, revision: invoice.revision } },
      update: {},
      create: {
        invoiceId: invoice.id,
        revision: invoice.revision,
        invoiceNumber: invoice.invoiceNumber,
        totalCHF: invoice.totalCHF,
        payloadJson: snapshot,
        pdfPath: invoice.pdfPath,
      },
    });

    await tx.invoiceAuditLog.create({
      data: {
        invoiceId: invoice.id,
        action: "first_download",
        actor,
        afterJson: {
          invoiceNumber: invoice.invoiceNumber,
          revision: invoice.revision,
          totalCHF: invoice.totalCHF,
          sessionCount: snapshot.sessionIds.length,
          firstDownloadedAt: now.toISOString(),
        },
        note: `Rechnung ausgeliefert (${source}) — Stand eingefroren.`,
      },
    });
  });
}
