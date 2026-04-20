import { NextRequest, NextResponse } from "next/server";
import { buildInvoicePdf } from "@/lib/invoice-pdf";
import { getInvoicePayload } from "@/lib/invoice";

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

    return new Response(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="rechnung-${year}-${month}-${studentId}.pdf"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fehler bei Vorschau." },
      { status: 500 }
    );
  }
}
