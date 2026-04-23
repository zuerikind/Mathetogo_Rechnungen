import { NextRequest, NextResponse } from "next/server";
import { buildInvoicePdf } from "@/lib/invoice-pdf";
import { getInvoicePayload, getInvoicePdfDownloadBaseName } from "@/lib/invoice";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const studentId = searchParams.get("studentId");
    const year = Number(searchParams.get("year"));
    const month = Number(searchParams.get("month"));

    if (!studentId || !year || !month) {
      return NextResponse.json(
        { error: "studentId, year und month sind erforderlich." },
        { status: 400 }
      );
    }

    const payload = await getInvoicePayload(studentId, year, month);
    const pdfBuffer = await buildInvoicePdf(payload);

    const fileName = getInvoicePdfDownloadBaseName(payload.student.name, month, year);
    const download = searchParams.get("download");
    const disposition =
      download === "1" || download === "true"
        ? `attachment; filename="${fileName}"`
        : `inline; filename="${fileName}"`;

    return new Response(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": disposition,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fehler bei Vorschau." },
      { status: 500 }
    );
  }
}
