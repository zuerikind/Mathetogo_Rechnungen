import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
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
