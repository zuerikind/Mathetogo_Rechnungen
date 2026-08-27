import "server-only";
import { pickStoredGenerationPayload } from "@/lib/invoice-snapshot-shape";
import { prisma } from "@/lib/prisma";
import { getSubscriptionInvoiceLines } from "@/lib/subscription-billing";
import {
  parseSessionIds,
  shapeInvoiceSnapshot,
  type InvoiceSnapshotPayload,
} from "@/lib/invoice-snapshot-shape";

export type { InvoiceSnapshotPayload };

export type SnapshotInvoiceInput = {
  id: string;
  studentId: string;
  year: number;
  month: number;
  totalCHF: number;
  sessionIds: string;
  invoiceNumber: string;
  revision: number;
  pdfPath: string | null;
  sentAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
};

/**
 * Lädt alles, was zum Einfrieren nötig ist, und übergibt es an die reine
 * Formungsfunktion (lib/invoice-snapshot-shape.ts).
 */
/**
 * Der einzufrierende Stand einer Rechnung.
 *
 * Bevorzugt den beim Erzeugen festgeschriebenen Payload (`generatedPayloadJson`):
 * das ist exakt der Inhalt, aus dem das ausgelieferte PDF entstanden ist. Nur
 * wenn er fehlt — Rechnungen von vor dieser Aenderung — wird wie bisher live
 * nachgeschlagen. Damit gibt es fuer neu erzeugte Rechnungen keine zweite
 * Lektionsabfrage mehr, die den gedruckten Inhalt neu definieren koennte.
 */
export async function resolveSnapshotPayload(
  invoice: SnapshotInvoiceInput & { generatedPayloadJson?: unknown },
  frozenAt: Date
): Promise<{ payload: InvoiceSnapshotPayload; source: "generation" | "live" }> {
  const stored = pickStoredGenerationPayload(invoice.generatedPayloadJson);
  if (stored) return { payload: stored, source: "generation" };
  return { payload: await buildInvoiceSnapshotPayload(invoice, frozenAt), source: "live" };
}

export async function buildInvoiceSnapshotPayload(
  invoice: SnapshotInvoiceInput,
  frozenAt: Date
): Promise<InvoiceSnapshotPayload> {
  const sessionIds = parseSessionIds(invoice.sessionIds);

  const [root, children, sessions] = await Promise.all([
    prisma.student.findUnique({
      where: { id: invoice.studentId },
      select: { id: true, name: true, subject: true },
    }),
    prisma.student.findMany({
      where: { billedToId: invoice.studentId },
      select: { id: true, name: true, subject: true },
      orderBy: { name: "asc" },
    }),
    sessionIds.length > 0
      ? prisma.session.findMany({
          where: { id: { in: sessionIds } },
          select: {
            id: true,
            studentId: true,
            date: true,
            durationMin: true,
            amountCHF: true,
            student: { select: { id: true, name: true, subject: true } },
          },
          orderBy: { date: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const memberIds = Array.from(
    new Set([invoice.studentId, ...children.map((c) => c.id), ...sessions.map((s) => s.studentId)])
  );
  const subscriptions = await prisma.platformSubscription.findMany({
    where: { studentId: { in: memberIds } },
    select: {
      id: true,
      studentId: true,
      amountCHF: true,
      billingMethod: true,
      durationMonths: true,
      startMonth: true,
      startYear: true,
    },
  });

  return shapeInvoiceSnapshot({
    invoice,
    root,
    children,
    sessions,
    sessionIds,
    subscriptionLines: getSubscriptionInvoiceLines(subscriptions, invoice.year, invoice.month),
    frozenAt,
  });
}
