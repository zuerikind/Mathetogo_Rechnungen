import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isDelivered } from "@/lib/invoice-delivery";
import { getBillableTotalCHF, removeInvoiceWhenUnbillable } from "@/lib/invoice-stale";

/** Remove invoice for a month when there is nothing left to bill (incl. mistaken sent invoices). */
export async function POST(req: NextRequest) {
  const userSession = await auth();
  if (!userSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    studentId?: string;
    year?: number;
    month?: number;
  };

  const studentId = body.studentId;
  const year = Number(body.year);
  const month = Number(body.month);

  if (!studentId || !year || !month || month < 1 || month > 12) {
    return NextResponse.json(
      { error: "studentId, year und month sind erforderlich." },
      { status: 400 }
    );
  }

  const billable = await getBillableTotalCHF(studentId, year, month);
  if (billable > 0) {
    return NextResponse.json(
      {
        error: `Für diesen Monat sind noch CHF ${billable.toFixed(2)} abrechenbar — Rechnung kann nicht entfernt werden.`,
      },
      { status: 409 }
    );
  }

  // Dieser Weg loescht: Zeile weg, PDF aus dem Bucket weg. Fuer einen Entwurf ist
  // das richtig, fuer eine ausgelieferte Rechnung nicht — dort bliebe eine
  // unerklaerte Luecke in der Nummernfolge zurueck. Seit es den Storno gibt,
  // fuehrt der Weg fuer ausgelieferte Rechnungen ueber ihn.
  const existing = await prisma.invoice.findUnique({
    where: { studentId_month_year: { studentId, month, year } },
    select: {
      id: true,
      invoiceNumber: true,
      sentAt: true,
      paidAt: true,
      firstDownloadedAt: true,
    },
  });
  if (existing && isDelivered(existing)) {
    return NextResponse.json(
      {
        error:
          `Rechnung ${existing.invoiceNumber} ist bereits ausgeliefert und darf nicht gelöscht werden. ` +
          `Wenn sie gegenstandslos ist, storniere sie — dann bleiben Nummer und PDF als Nachweis erhalten.`,
        invoiceId: existing.id,
        voidInsteadOfDelete: true,
      },
      { status: 409 }
    );
  }

  const removed = await removeInvoiceWhenUnbillable(studentId, year, month, {
    includeSent: true,
  });

  if (!removed) {
    return NextResponse.json(
      { error: "Keine Rechnung gefunden, oder sie ist bereits bezahlt." },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
