import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { InvoiceChange } from "@/lib/invoice-diff";

/**
 * Zuletzt erkannte Abweichung einer ausgelieferten Rechnung — nur Lesen.
 *
 * Der Change Log liegt im InvoiceAuditLog (action "change_detected"); hier wird
 * er für die Anzeige aufbereitet. Kein Entscheid, keine Korrektur (P7).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    select: { id: true, invoiceNumber: true, needsReview: true, changeDetectedAt: true },
  });
  if (!invoice) return NextResponse.json({ error: "Rechnung nicht gefunden." }, { status: 404 });

  const entries = await prisma.invoiceAuditLog.findMany({
    where: { invoiceId: invoice.id, action: "change_detected" },
    orderBy: { createdAt: "desc" },
    select: { beforeJson: true, afterJson: true, note: true, actor: true, createdAt: true },
  });

  return NextResponse.json({
    invoiceNumber: invoice.invoiceNumber,
    needsReview: invoice.needsReview,
    changeDetectedAt: invoice.changeDetectedAt,
    entries: entries.map((entry) => {
      const after = (entry.afterJson ?? {}) as {
        totalCHF?: number | null;
        changes?: InvoiceChange[];
        affectedSessionIds?: string[];
        trigger?: string;
      };
      const before = (entry.beforeJson ?? {}) as { totalCHF?: number; revision?: number };
      return {
        detectedAt: entry.createdAt,
        actor: entry.actor,
        trigger: after.trigger ?? null,
        totalBeforeCHF: before.totalCHF ?? null,
        totalAfterCHF: after.totalCHF ?? null,
        affectedSessionIds: after.affectedSessionIds ?? [],
        changes: after.changes ?? [],
        note: entry.note,
      };
    }),
  });
}
