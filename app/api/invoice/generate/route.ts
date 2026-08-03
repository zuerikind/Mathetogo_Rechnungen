import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildInvoicePdf } from "@/lib/invoice-pdf";
import { getInvoicePayload, reserveInvoiceRow } from "@/lib/invoice";
import { isDelivered } from "@/lib/invoice-delivery";
import { pruneStaleInvoiceIfUnbillable } from "@/lib/invoice-stale";
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

    // Ausgeliefert = unveraenderlich. Es gibt bewusst KEIN force mehr: der frueher
    // erlaubte Ueberschreibpfad hat PDF und Betrag einer bereits zugestellten
    // Rechnung unter derselben Nummer ersetzt, ohne Spur. Korrekturen laufen ab
    // jetzt ausschliesslich ueber die Neuausstellung, die die alte Fassung erhaelt.
    if (existing && isDelivered(existing)) {
      return NextResponse.json(
        {
          error:
            `Rechnung ${existing.invoiceNumber} ist bereits ausgeliefert und darf nicht ` +
            `überschrieben werden. Korrektur über "Neu ausstellen" in der Rechnungsübersicht.`,
          invoiceId: existing.id,
          reissueRequired: true,
        },
        { status: 409 }
      );
    }

    const payload = await getInvoicePayload(studentId, year, month);
    if (payload.totalCHF <= 0) {
      await pruneStaleInvoiceIfUnbillable(studentId, year, month);
      return NextResponse.json(
        {
          error:
            "Keine abrechenbaren Lektionen oder Abo-Posten für diesen Monat — Rechnung wurde nicht erstellt.",
        },
        { status: 400 }
      );
    }

    // Nummer + Rechnungszeile zuerst (eine Transaktion), damit das PDF exakt die
    // Nummer trägt, die auch gespeichert ist.
    const { invoiceId, invoiceNumber } = await reserveInvoiceRow({
      studentId,
      year,
      month,
      totalCHF: payload.totalCHF,
      sessionIds: payload.sessions.map((s) => s.id),
    });

    const pdfBuffer = await buildInvoicePdf({ ...payload, invoiceNumber });

    const storagePath = invoiceStoragePath(year, month, studentId);
    const { error: uploadError } = await supabase.storage
      .from(INVOICE_BUCKET)
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        // Zweites Schloss hinter dem 409: ein Entwurf darf beliebig oft neu
        // gebaut werden, eine ausgelieferte Fassung nie ueberschrieben. Greift
        // der Guard oben einmal nicht, scheitert der Upload laut statt still.
        upsert: !existing || !isDelivered(existing),
      });

    if (uploadError) {
      return NextResponse.json(
        { error: `PDF-Upload fehlgeschlagen: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const pdfUrl = invoicePublicUrl(year, month, studentId);
    await prisma.invoice.update({ where: { id: invoiceId }, data: { pdfPath: pdfUrl } });

    return NextResponse.json({ invoiceId, pdfUrl, invoiceNumber });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fehler beim Generieren." },
      { status: 500 }
    );
  }
}
