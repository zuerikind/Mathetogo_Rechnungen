import "server-only";
import { prisma } from "@/lib/prisma";
import { buildInvoicePdf } from "@/lib/invoice-pdf";
import { getInvoicePayload } from "@/lib/invoice";
import { isDelivered } from "@/lib/invoice-delivery";
import { buildInvoiceSnapshotPayload } from "@/lib/invoice-snapshot";
import { INVOICE_BUCKET, invoiceStoragePath, invoicePublicUrl } from "@/lib/invoice-storage-path";
import { supabase } from "@/lib/supabase";

export type RevisionResult = {
  invoiceNumber: string;
  revision: number;
  totalBeforeCHF: number;
  totalAfterCHF: number;
};

const SELECT = {
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
  firstDownloadedAt: true,
  needsReview: true,
  createdAt: true,
} as const;

export class RevisionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Stellt eine ausgelieferte Rechnung unter derselben Nummer neu aus.
 *
 * Nicht-destruktiv: die bisherige PDF und ihr Snapshot bleiben unangetastet,
 * die neue Fassung wird unter einem eigenen Revisionspfad abgelegt. Erlaubt,
 * sobald die Rechnung ausgeliefert ist — nicht nur bei needsReview: die
 * Begruendung steht ohnehin im Audit-Log, und eine engere Sperre erzeugt nur
 * den naechsten Umgehungspfad.
 */
export async function reissueInvoice(invoiceId: string, actor: string): Promise<RevisionResult> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: SELECT });
  if (!invoice) throw new RevisionError("Rechnung nicht gefunden.", 404);
  if (!isDelivered(invoice)) {
    throw new RevisionError(
      "Diese Rechnung ist noch nicht ausgeliefert — sie kann normal neu generiert werden.",
      409
    );
  }

  const payload = await getInvoicePayload(invoice.studentId, invoice.year, invoice.month);
  if (payload.totalCHF <= 0) {
    throw new RevisionError("Für diesen Monat ist nichts mehr abrechenbar.", 409);
  }

  const nextRevision = invoice.revision + 1;
  const storagePath = invoiceStoragePath(
    invoice.year,
    invoice.month,
    invoice.studentId,
    nextRevision
  );

  // PDF zuerst: der Pfad gehoert allein dieser neuen Revision, ein upsert kann
  // dort nur einen eigenen Fehlversuch ueberschreiben — nie eine ausgelieferte
  // Fassung. Bricht danach die Transaktion ab, liegt eine verwaiste Datei im
  // Bucket, auf die nichts zeigt; der naechste Versuch ersetzt sie.
  const pdfBuffer = await buildInvoicePdf({
    ...payload,
    invoiceNumber: invoice.invoiceNumber,
    revision: nextRevision,
    replacesDeliveredAt: invoice.firstDownloadedAt ?? invoice.sentAt,
  });

  const { error: uploadError } = await supabase.storage
    .from(INVOICE_BUCKET)
    .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: true });
  if (uploadError) {
    throw new RevisionError(`PDF-Upload fehlgeschlagen: ${uploadError.message}`, 500);
  }

  const now = new Date();
  const pdfUrl = invoicePublicUrl(invoice.year, invoice.month, invoice.studentId, nextRevision);
  const sessionIds = payload.sessions.map((s) => s.id);
  const snapshot = await buildInvoiceSnapshotPayload(
    {
      ...invoice,
      totalCHF: payload.totalCHF,
      sessionIds: JSON.stringify(sessionIds),
      revision: nextRevision,
      pdfPath: pdfUrl,
    },
    now
  );

  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        revision: nextRevision,
        totalCHF: payload.totalCHF,
        sessionIds: JSON.stringify(sessionIds),
        pdfPath: pdfUrl,
        // Der Befund ist mit der Neuausstellung erledigt.
        needsReview: false,
        reviewedAt: now,
      },
    });
    await tx.invoiceSnapshot.create({
      data: {
        invoiceId: invoice.id,
        revision: nextRevision,
        invoiceNumber: invoice.invoiceNumber,
        totalCHF: payload.totalCHF,
        payloadJson: snapshot,
        pdfPath: pdfUrl,
      },
    });
    await tx.invoiceAuditLog.create({
      data: {
        invoiceId: invoice.id,
        action: "revised",
        actor,
        beforeJson: { revision: invoice.revision, totalCHF: invoice.totalCHF },
        afterJson: { revision: nextRevision, totalCHF: payload.totalCHF, pdfPath: pdfUrl },
        note:
          `Neu ausgestellt als Revision ${nextRevision} von ${invoice.invoiceNumber} ` +
          `(CHF ${invoice.totalCHF.toFixed(2)} → CHF ${payload.totalCHF.toFixed(2)}). ` +
          `Frühere Fassung bleibt abrufbar.`,
      },
    });
  });

  return {
    invoiceNumber: invoice.invoiceNumber,
    revision: nextRevision,
    totalBeforeCHF: invoice.totalCHF,
    totalAfterCHF: payload.totalCHF,
  };
}

/**
 * Storniert eine ausgelieferte Rechnung, ohne sie zu loeschen.
 *
 * Die Zeile bleibt, die Nummer bleibt vergeben (keine Luecke in der Folge), die
 * PDF bleibt unangetastet. Ab jetzt zaehlt sie weder als Ertrag noch als offene
 * Forderung. Gegenstueck zum alten Weg ueber /api/invoices/void, der die Zeile
 * samt PDF geloescht und keinerlei Spur hinterlassen hat.
 *
 * Ein faelschlich gesetztes paidAt wird dabei zurueckgenommen: eine Rechnung
 * kann nicht gleichzeitig bezahlt und gegenstandslos sein, und ohne die
 * Ruecknahme bliebe sie im rechnungsbasierten Umsatz stehen.
 */
export async function voidInvoice(
  invoiceId: string,
  actor: string,
  reason: string
): Promise<{ invoiceNumber: string; clearedPaidAt: Date | null }> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true, invoiceNumber: true, totalCHF: true, revision: true,
      sentAt: true, paidAt: true, firstDownloadedAt: true, voidedAt: true,
    },
  });
  if (!invoice) throw new RevisionError("Rechnung nicht gefunden.", 404);
  if (invoice.voidedAt) {
    throw new RevisionError(
      `Rechnung ${invoice.invoiceNumber} ist bereits storniert.`,
      409
    );
  }
  if (!isDelivered(invoice)) {
    throw new RevisionError(
      "Diese Rechnung ist noch nicht ausgeliefert — ein Entwurf braucht keinen Storno und kann entfernt werden.",
      409
    );
  }

  const now = new Date();
  const clearedPaidAt = invoice.paidAt;
  await prisma.$transaction([
    prisma.invoice.update({
      where: { id: invoice.id },
      data: { voidedAt: now, paidAt: null, needsReview: false, reviewedAt: now },
    }),
    prisma.invoiceAuditLog.create({
      data: {
        invoiceId: invoice.id,
        action: "voided",
        actor,
        beforeJson: {
          totalCHF: invoice.totalCHF,
          paidAt: clearedPaidAt?.toISOString() ?? null,
          revision: invoice.revision,
        },
        afterJson: {
          voidedAt: now.toISOString(),
          paidAt: null,
          paidAtCleared: clearedPaidAt !== null,
          reason,
        },
        note:
          `Storniert: ${reason}. Rechnung ${invoice.invoiceNumber} über ` +
          `CHF ${invoice.totalCHF.toFixed(2)} bleibt mit Nummer und PDF bestehen, ` +
          `zählt aber weder als Ertrag noch als offene Forderung.` +
          (clearedPaidAt
            ? ` Zahlungsvermerk vom ${clearedPaidAt.toISOString().slice(0, 10)} zurückgenommen — er war keine echte Zahlung.`
            : ""),
      },
    }),
  ]);

  return { invoiceNumber: invoice.invoiceNumber, clearedPaidAt };
}

/**
 * "Original bleibt gültig": nimmt den Alarm weg, ohne etwas zu aendern.
 *
 * Der akzeptierte Fingerabdruck wandert ins Audit-Log. Die Erkennung
 * protokolliert denselben Befund ohnehin nicht erneut (invoice-change-detection
 * vergleicht gegen den letzten change_detected-Eintrag), waehrend eine NEUE,
 * andere Abweichung wieder markiert — genau das soll sie auch.
 */
export async function acceptInvoiceChanges(
  invoiceId: string,
  actor: string
): Promise<{ invoiceNumber: string }> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, invoiceNumber: true, totalCHF: true, revision: true, needsReview: true },
  });
  if (!invoice) throw new RevisionError("Rechnung nicht gefunden.", 404);
  if (!invoice.needsReview) {
    throw new RevisionError("Für diese Rechnung steht kein Entscheid offen.", 409);
  }

  const last = await prisma.invoiceAuditLog.findFirst({
    where: { invoiceId: invoice.id, action: "change_detected" },
    orderBy: { createdAt: "desc" },
    select: { afterJson: true },
  });
  const detected = (last?.afterJson ?? {}) as { fingerprint?: string; totalCHF?: number | null };

  const now = new Date();
  await prisma.$transaction([
    prisma.invoice.update({
      where: { id: invoice.id },
      data: { needsReview: false, reviewedAt: now },
    }),
    prisma.invoiceAuditLog.create({
      data: {
        invoiceId: invoice.id,
        action: "reviewed",
        actor,
        beforeJson: { needsReview: true },
        afterJson: {
          decision: "original_bleibt_gueltig",
          revision: invoice.revision,
          totalCHF: invoice.totalCHF,
          acceptedFingerprint: detected.fingerprint ?? null,
          liveTotalCHF: detected.totalCHF ?? null,
        },
        note:
          `Abweichung geprüft und akzeptiert: ${invoice.invoiceNumber} bleibt in der ` +
          `ausgelieferten Fassung gültig. Keine Neuausstellung.`,
      },
    }),
  ]);

  return { invoiceNumber: invoice.invoiceNumber };
}
