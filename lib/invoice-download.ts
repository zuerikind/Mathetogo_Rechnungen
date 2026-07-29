import "server-only";
import { prisma } from "@/lib/prisma";
import { buildInvoiceSnapshotPayload } from "@/lib/invoice-snapshot";

/** Woher die Auslieferung kam — nur für das Audit-Log. */
export type DownloadSource = "Einzeldownload" | "Monatsexport (ZIP)";

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
      firstDownloadedAt: true,
    },
  });
  if (!invoice) return;

  if (invoice.firstDownloadedAt) {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { downloadedAt: now } });
    return;
  }

  const snapshot = await buildInvoiceSnapshotPayload(invoice, now);

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
