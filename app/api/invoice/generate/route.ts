import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildInvoicePdf } from "@/lib/invoice-pdf";
import { getInvoicePayload, getNextInvoiceNumber } from "@/lib/invoice";
import { supabase, INVOICE_BUCKET, invoiceStoragePath, invoicePublicUrl } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const studentId = body.studentId as string;
    const year = Number(body.year);
    const month = Number(body.month);

    if (!studentId || !year || !month) {
      return NextResponse.json(
        { error: "studentId, year und month sind erforderlich." },
        { status: 400 }
      );
    }

    const existing = await prisma.invoice.findUnique({
      where: { studentId_month_year: { studentId, month, year } },
    });

    if (existing?.sentAt) {
      return NextResponse.json(
        { error: "Rechnung wurde bereits gesendet und darf nicht neu generiert werden." },
        { status: 409 }
      );
    }

    const payload = await getInvoicePayload(studentId, year, month);
    const pdfBuffer = await buildInvoicePdf(payload);

    const storagePath = invoiceStoragePath(year, month, studentId);
    const { error: uploadError } = await supabase.storage
      .from(INVOICE_BUCKET)
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: `PDF-Upload fehlgeschlagen: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const pdfUrl = invoicePublicUrl(year, month, studentId);
    const sessionIds = payload.sessions.map((s) => s.id);
    const existingNumber = existing?.invoiceNumber?.trim();
    const invoiceNumber = existingNumber?.length
      ? existingNumber
      : await getNextInvoiceNumber(year);

    const invoice = await prisma.invoice.upsert({
      where: { studentId_month_year: { studentId, month, year } },
      update: { totalCHF: payload.totalCHF, sessionIds: JSON.stringify(sessionIds), pdfPath: pdfUrl, invoiceNumber },
      create: { studentId, month, year, totalCHF: payload.totalCHF, sessionIds: JSON.stringify(sessionIds), pdfPath: pdfUrl, invoiceNumber },
    });

    return NextResponse.json({ invoiceId: invoice.id, pdfUrl });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fehler beim Generieren." },
      { status: 500 }
    );
  }
}
