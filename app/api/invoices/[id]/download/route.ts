import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getInvoicePdfDownloadBaseName } from "@/lib/invoice";
import { recordInvoiceDownload } from "@/lib/invoice-download";
import { INVOICE_BUCKET, invoiceStoragePath, supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type LoadResult =
  | { ok: true; invoiceId: string; pdfBuffer: Buffer; fileName: string }
  | { ok: false; response: NextResponse };

/**
 * Auth prüfen und die PDF aus dem privaten Bucket holen — ohne jede Nebenwirkung.
 * Beide Methoden teilen sich das; nur POST protokolliert anschliessend.
 */
async function loadInvoicePdf(invoiceId: string): Promise<LoadResult> {
  const session = await auth();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
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
    return {
      ok: false,
      response: NextResponse.json({ error: "Rechnung nicht gefunden." }, { status: 404 }),
    };
  }
  if (!invoice.pdfPath) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Für diese Rechnung existiert noch kein PDF. Bitte zuerst generieren." },
        { status: 409 }
      ),
    };
  }

  const { data: file, error: downloadError } = await supabase.storage
    .from(INVOICE_BUCKET)
    .download(invoiceStoragePath(invoice.year, invoice.month, invoice.studentId));

  if (downloadError || !file) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "PDF konnte nicht aus dem Speicher geladen werden." },
        { status: 404 }
      ),
    };
  }

  return {
    ok: true,
    invoiceId: invoice.id,
    pdfBuffer: Buffer.from(await file.arrayBuffer()),
    fileName: getInvoicePdfDownloadBaseName(invoice.student.name, invoice.month, invoice.year),
  };
}

function pdfResponse(pdfBuffer: Buffer, fileName: string): Response {
  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Liefert die PDF aus — und sonst nichts.
 *
 * Bewusst nebenwirkungsfrei: Browser holen Links beim Hover oder Scrollen
 * spekulativ vor. Als das Einfrieren noch an diesem GET hing, hat ein solcher
 * Prefetch eine Rechnung als ausgeliefert markiert, ohne dass jemand geklickt hat.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const loaded = await loadInvoicePdf(params.id);
  if (!loaded.ok) return loaded.response;
  return pdfResponse(loaded.pdfBuffer, loaded.fileName);
}

/**
 * Auslieferung mit Protokoll: derselbe PDF-Inhalt, aber der Download wird
 * festgehalten (beim ersten Mal Snapshot + Audit-Log). Das ist der Weg, den die
 * Download-Buttons der App nehmen — POST, weil kein Browser POST vorablädt.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const loaded = await loadInvoicePdf(params.id);
  if (!loaded.ok) return loaded.response;

  const session = await auth();
  // Erst nach erfolgreichem Laden protokollieren — ein fehlgeschlagener Abruf
  // darf die Rechnung nicht als heruntergeladen markieren.
  await recordInvoiceDownload(loaded.invoiceId, session?.user?.email ?? "unbekannt", "Einzeldownload");

  return pdfResponse(loaded.pdfBuffer, loaded.fileName);
}
