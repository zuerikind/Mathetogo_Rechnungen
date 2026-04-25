import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type InvoiceStatusUpdate = "sent" | "paid" | "reminder" | "unpaid";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const invoiceId = params.id;
    const body = await req.json();
    const status = body?.status as InvoiceStatusUpdate | undefined;

    if (!invoiceId) {
      return NextResponse.json({ error: "invoiceId ist erforderlich." }, { status: 400 });
    }

    if (status !== "sent" && status !== "paid" && status !== "reminder" && status !== "unpaid") {
      return NextResponse.json({ error: "Ungültiger Status." }, { status: 400 });
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, pdfPath: true, sentAt: true, paidAt: true },
    });

    if (!invoice) {
      return NextResponse.json({ error: "Rechnung nicht gefunden." }, { status: 404 });
    }

    if (status === "sent" && !invoice.pdfPath) {
      return NextResponse.json(
        { error: "Bitte zuerst die Rechnung generieren." },
        { status: 409 }
      );
    }

    const now = new Date();

    if (status === "reminder") {
      await prisma.$executeRaw`
        UPDATE "Invoice"
        SET "sentAt" = COALESCE("sentAt", ${now}),
            "reminderSentAt" = ${now}
        WHERE "id" = ${invoiceId}
      `;
      const updated = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { id: true, sentAt: true, paidAt: true },
      });
      return NextResponse.json({ success: true, invoice: updated });
    }

    if (status === "unpaid") {
      const updated = await prisma.invoice.update({
        where: { id: invoiceId },
        data: { paidAt: null },
        select: { id: true, sentAt: true, paidAt: true },
      });
      return NextResponse.json({ success: true, invoice: updated });
    }

    const updated = await prisma.invoice.update({
      where: { id: invoiceId },
      data: status === "sent" ? { sentAt: now, paidAt: null } : { sentAt: invoice.sentAt ?? now, paidAt: now },
      select: { id: true, sentAt: true, paidAt: true },
    });

    return NextResponse.json({ success: true, invoice: updated });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Status konnte nicht aktualisiert werden." },
      { status: 500 }
    );
  }
}
