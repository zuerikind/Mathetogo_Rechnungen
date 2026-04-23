import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { prisma } from "@/lib/prisma";
import { buildInvoicePdf } from "@/lib/invoice-pdf";
import { getInvoicePayload, getNextInvoiceNumber } from "@/lib/invoice";
import {
  INVOICE_BUCKET,
  invoicePublicUrl,
  invoiceStoragePath,
  supabase,
} from "@/lib/supabase";

function sanitizeFileName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year"));
    const month = Number(searchParams.get("month"));

    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json(
        { error: "year und month sind erforderlich." },
        { status: 400 }
      );
    }

    const sessions = await prisma.session.findMany({
      where: { year, month },
      select: {
        studentId: true,
        student: {
          select: { name: true },
        },
      },
      orderBy: { student: { name: "asc" } },
    });

    if (sessions.length === 0) {
      return NextResponse.json(
        { error: "Keine Sessions für diesen Monat gefunden." },
        { status: 404 }
      );
    }

    const students = new Map<string, string>();
    for (const row of sessions) {
      if (!students.has(row.studentId)) {
        students.set(row.studentId, row.student.name);
      }
    }

    const zip = new JSZip();
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    let added = 0;

    for (const [studentId, studentName] of Array.from(students.entries())) {
      const storagePath = invoiceStoragePath(year, month, studentId);
      const existing = await prisma.invoice.findUnique({
        where: { studentId_month_year: { studentId, month, year } },
      });

      let pdfBuffer: Buffer | null = null;

      if (existing?.pdfPath) {
        const { data } = await supabase.storage
          .from(INVOICE_BUCKET)
          .download(storagePath);
        if (data) {
          pdfBuffer = Buffer.from(await data.arrayBuffer());
        }
      }

      if (!pdfBuffer) {
        const payload = await getInvoicePayload(studentId, year, month);
        pdfBuffer = await buildInvoicePdf(payload);

        const { error: uploadError } = await supabase.storage
          .from(INVOICE_BUCKET)
          .upload(storagePath, pdfBuffer, {
            contentType: "application/pdf",
            upsert: true,
          });

        if (uploadError) {
          return NextResponse.json(
            {
              error: `PDF-Upload fehlgeschlagen (${studentName}): ${uploadError.message}`,
            },
            { status: 500 }
          );
        }

        const pdfUrl = invoicePublicUrl(year, month, studentId);
        const sessionIds = payload.sessions.map((s) => s.id);
        const existingNumber = existing?.invoiceNumber?.trim();
        const invoiceNumber = existingNumber?.length
          ? existingNumber
          : await getNextInvoiceNumber(year);

        await prisma.invoice.upsert({
          where: { studentId_month_year: { studentId, month, year } },
          update: {
            totalCHF: payload.totalCHF,
            sessionIds: JSON.stringify(sessionIds),
            pdfPath: pdfUrl,
            invoiceNumber,
          },
          create: {
            studentId,
            month,
            year,
            totalCHF: payload.totalCHF,
            sessionIds: JSON.stringify(sessionIds),
            pdfPath: pdfUrl,
            invoiceNumber,
          },
        });
      }

      const safeName = sanitizeFileName(studentName);
      zip.file(`${prefix}-${safeName}.pdf`, pdfBuffer);
      added += 1;
    }

    if (added === 0) {
      return NextResponse.json(
        { error: "Keine Rechnungen für den Export verfügbar." },
        { status: 404 }
      );
    }

    const archive = await zip.generateAsync({ type: "nodebuffer" });

    return new Response(new Uint8Array(archive), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="rechnungen-${prefix}.zip"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Monatsexport fehlgeschlagen.",
      },
      { status: 500 }
    );
  }
}
