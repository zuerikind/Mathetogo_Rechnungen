import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
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

  // Klare Meldung statt des generischen 404 aus removeInvoiceWhenUnbillable.
  const downloaded = await prisma.invoice.findUnique({
    where: { studentId_month_year: { studentId, month, year } },
    select: { firstDownloadedAt: true, invoiceNumber: true },
  });
  if (downloaded?.firstDownloadedAt) {
    return NextResponse.json(
      {
        error: `Rechnung ${downloaded.invoiceNumber} wurde bereits heruntergeladen und gilt als ausgeliefert — sie kann nicht mehr entfernt werden.`,
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
