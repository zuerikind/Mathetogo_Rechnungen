import "server-only";
import { prisma } from "@/lib/prisma";
import { getInvoicePayload } from "@/lib/invoice";
import {
  diffInvoiceAgainstLive,
  type DiffLiveSession,
  type DiffSubscriptionLine,
  type InvoiceDiff,
} from "@/lib/invoice-diff";
import type { InvoiceSnapshotPayload } from "@/lib/invoice-snapshot-shape";

/**
 * Erkennt Abweichungen zwischen ausgelieferten Rechnungen und dem heutigen Stand.
 *
 * Läuft ausschliesslich für Rechnungen mit Snapshot, also für heruntergeladene.
 * Erkennen und protokollieren, mehr nicht: es wird nichts neu berechnet, keine
 * Revision erzeugt und kein Flag automatisch zurückgenommen — das Aufheben ist
 * eine Entscheidung des Nutzers (P7).
 */
export type ChangeDetectionResult = {
  /** Geprüfte ausgelieferte Rechnungen. */
  checked: number;
  /** Rechnungen, bei denen diesmal eine neue Abweichung protokolliert wurde. */
  flagged: number;
};

export async function detectInvoiceChangesInScope(opts: {
  year: number;
  month: number;
  /** Auslösender Vorgang, landet im Change Log (z. B. "Kalender-Sync"). */
  trigger: string;
  actor?: string;
  /**
   * Sessions mit nachweislich gelöschtem Kalendereintrag, deren DB-Zeile der
   * H3-Guard bewahrt hat. Nur der Sync kann das feststellen.
   */
  calendarDeletedSessionIds?: Set<string>;
}): Promise<ChangeDetectionResult> {
  const { year, month, trigger } = opts;
  const actor = opts.actor ?? "system";
  const calendarDeletedSessionIds = opts.calendarDeletedSessionIds ?? new Set<string>();

  const invoices = await prisma.invoice.findMany({
    where: { year, month, firstDownloadedAt: { not: null } },
    select: { id: true, studentId: true, year: true, month: true, invoiceNumber: true },
  });

  let flagged = 0;
  for (const invoice of invoices) {
    const detected = await detectChangesForInvoice(
      invoice,
      trigger,
      actor,
      calendarDeletedSessionIds
    );
    if (detected) flagged += 1;
  }

  return { checked: invoices.length, flagged };
}

async function detectChangesForInvoice(
  invoice: { id: string; studentId: string; year: number; month: number; invoiceNumber: string },
  trigger: string,
  actor: string,
  calendarDeletedSessionIds: Set<string>
): Promise<boolean> {
  const snapshot = await prisma.invoiceSnapshot.findFirst({
    where: { invoiceId: invoice.id },
    orderBy: { revision: "desc" },
    select: { revision: true, payloadJson: true, createdAt: true },
  });
  // Ohne Snapshot gibt es keinen ausgelieferten Stand, gegen den sich vergleichen liesse.
  if (!snapshot) return false;

  const payload = snapshot.payloadJson as unknown as InvoiceSnapshotPayload;
  const snapshotSessions = (payload.sections ?? []).flatMap((section) => section.sessions ?? []);
  const snapshotSessionIds = payload.sessionIds ?? [];

  const liveSessions =
    snapshotSessionIds.length > 0
      ? await prisma.session.findMany({
          where: { id: { in: snapshotSessionIds } },
          select: {
            id: true,
            studentId: true,
            date: true,
            durationMin: true,
            amountCHF: true,
            year: true,
            month: true,
          },
        })
      : [];
  const liveSessionsById = new Map<string, DiffLiveSession>(liveSessions.map((s) => [s.id, s]));

  // getInvoicePayload wirft, wenn die Rechnung heute nicht mehr eigenständig
  // abrechenbar ist (z. B. der Schüler läuft jetzt über eine Familienrechnung).
  // Genau das ist eine der Abweichungen, die wir suchen.
  let liveInvoiceSessions: DiffLiveSession[] | null = null;
  let liveSubscriptionLines: DiffSubscriptionLine[] = [];
  let liveTotalCHF: number | null = null;
  let unbillableReason: string | null = null;
  try {
    const live = await getInvoicePayload(invoice.studentId, invoice.year, invoice.month);
    liveInvoiceSessions = live.sections.flatMap((section) =>
      section.sessions.map((s) => ({
        id: s.id,
        studentId: section.student.id,
        date: s.date,
        durationMin: s.durationMin,
        amountCHF: s.amountCHF,
        year: s.year,
        month: s.month,
      }))
    );
    liveSubscriptionLines = live.subscriptionLines;
    liveTotalCHF = live.totalCHF;
  } catch (error) {
    unbillableReason =
      error instanceof Error ? error.message : "Rechnung ist nicht mehr abrechenbar.";
  }

  const diff = diffInvoiceAgainstLive({
    year: invoice.year,
    month: invoice.month,
    snapshotSessions,
    snapshotSessionIds,
    snapshotSubscriptionLines: payload.subscriptionLines ?? [],
    snapshotTotalCHF: payload.totalCHF,
    liveSessionsById,
    liveInvoiceSessions,
    liveSubscriptionLines,
    liveTotalCHF,
    unbillableReason,
    calendarDeletedSessionIds,
  });

  if (diff.changes.length === 0) return false;

  // Derselbe Befund bei jedem Sync erneut protokolliert wäre Lärm — das Change Log
  // soll die Änderung festhalten, nicht die Häufigkeit der Syncs.
  const last = await prisma.invoiceAuditLog.findFirst({
    where: { invoiceId: invoice.id, action: "change_detected" },
    orderBy: { createdAt: "desc" },
    select: { afterJson: true },
  });
  const lastFingerprint = (last?.afterJson as { fingerprint?: string } | null)?.fingerprint;
  if (lastFingerprint === diff.fingerprint) return false;

  await writeChangeLog(invoice, snapshot.revision, diff, trigger, actor);
  return true;
}

async function writeChangeLog(
  invoice: { id: string; invoiceNumber: string },
  revision: number,
  diff: InvoiceDiff,
  trigger: string,
  actor: string
): Promise<void> {
  const now = new Date();
  const affectedSessionIds = Array.from(new Set(diff.changes.flatMap((c) => c.sessionIds)));
  const totalAfter =
    diff.totalAfterCHF === null ? "nicht mehr abrechenbar" : `CHF ${diff.totalAfterCHF.toFixed(2)}`;

  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { needsReview: true, changeDetectedAt: now },
    });
    await tx.invoiceAuditLog.create({
      data: {
        invoiceId: invoice.id,
        action: "change_detected",
        actor,
        beforeJson: {
          revision,
          totalCHF: diff.totalBeforeCHF,
        },
        afterJson: {
          totalCHF: diff.totalAfterCHF,
          changes: diff.changes,
          affectedSessionIds,
          fingerprint: diff.fingerprint,
          trigger,
          detectedAt: now.toISOString(),
        },
        note:
          `${trigger}: ${diff.changes.length} Abweichung(en) seit der Auslieferung von ` +
          `${invoice.invoiceNumber} (CHF ${diff.totalBeforeCHF.toFixed(2)} → ${totalAfter}). ` +
          `Keine automatische Korrektur — Entscheid offen.`,
      },
    });
  });
}
