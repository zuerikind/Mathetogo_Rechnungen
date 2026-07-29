import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getInvoicePdfDownloadBaseName } from "@/lib/invoice";
import { recordInvoiceDownload } from "@/lib/invoice-download";
import { INVOICE_BUCKET, invoiceStoragePath, supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Einziger Weg, eine einzelne Rechnungs-PDF herunterzuladen.
 *
 * Der Download ist der fachlich entscheidende Moment: ab hier ist die Rechnung
 * ausgeliefert. Deshalb läuft er über den Server statt über die Storage-URL —
 * nur so lässt sich der erste Download überhaupt feststellen und der ausgelieferte
 * Stand einfrieren. Seit der Bucket privat ist, gibt es auch keinen anderen Weg mehr.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      studentId: true,
      year: true,
      month: true,
      pdfPath: true,
      student: { select: { name: true } },
    },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Rechnung nicht gefunden." }, { status: 404 });
  }
  if (!invoice.pdfPath) {
    return NextResponse.json(
      { error: "Für diese Rechnung existiert noch kein PDF. Bitte zuerst generieren." },
      { status: 409 }
    );
  }

  const storagePath = invoiceStoragePath(invoice.year, invoice.month, invoice.studentId);
  const { data: file, error: downloadError } = await supabase.storage
    .from(INVOICE_BUCKET)
    .download(storagePath);

  if (downloadError || !file) {
    return NextResponse.json(
      { error: "PDF konnte nicht aus dem Speicher geladen werden." },
      { status: 404 }
    );
  }
  const pdfBuffer = Buffer.from(await file.arrayBuffer());

  // Erst nach erfolgreichem Laden protokollieren — ein fehlgeschlagener Abruf
  // darf die Rechnung nicht als heruntergeladen markieren.
  await recordInvoiceDownload(invoice.id, session.user?.email ?? "unbekannt", "Einzeldownload");

  const fileName = getInvoicePdfDownloadBaseName(invoice.student.name, invoice.month, invoice.year);
  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
