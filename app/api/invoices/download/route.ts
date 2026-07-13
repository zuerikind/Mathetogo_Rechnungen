import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { buildInvoicePdf } from "@/lib/invoice-pdf";
import { getInvoicePayload, getNextInvoiceNumber } from "@/lib/invoice";
import { pruneStaleInvoiceIfUnbillable } from "@/lib/invoice-stale";
import { getSubscriptionInvoiceLines } from "@/lib/subscription-billing";
import {
  INVOICE_BUCKET,
  invoicePublicUrl,
  invoiceStoragePath,
  supabase,
} from "@/lib/supabase";
import { MANUAL_BASELINE_STUDENT_ID } from "@/lib/ui-types";

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
    const userSession = await auth();
    if (!userSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year"));
    const month = Number(searchParams.get("month"));

    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json(
        { error: "year und month sind erforderlich." },
        { status: 400 }
      );
    }

    // Familienrechnung: Sessions verlinkter Geschwister zählen zum Hauptschüler.
    const allStudents = await prisma.student.findMany({
      select: { id: true, name: true, billedToId: true },
    });
    const studentById = new Map(allStudents.map((s) => [s.id, s]));
    const nameOf = (id: string, fallback: string) => studentById.get(id)?.name ?? fallback;

    // Sent/paid invoices belong in the export even when their sessions were
    // since removed — they are real, delivered documents.
    const monthInvoices = await prisma.invoice.findMany({
      where: { year, month, NOT: { sentAt: null, paidAt: null } },
      select: { studentId: true, student: { select: { name: true } } },
    });
    // Schüler mit eigener gesendeter/bezahlter Rechnung für den Monat bleiben eigenständig —
    // ihre Lektionen dürfen nicht zusätzlich auf der Familienrechnung landen.
    const separatelyBilled = new Set(monthInvoices.map((i) => i.studentId));
    const billTarget = (id: string) =>
      separatelyBilled.has(id) ? id : studentById.get(id)?.billedToId ?? id;

    // Export everyone billable for the month (sessions + Abo), not only students with a saved Invoice row.
    const sessionRows = await prisma.session.findMany({
      where: { year, month },
      select: {
        studentId: true,
        student: { select: { name: true } },
      },
      orderBy: { student: { name: "asc" } },
    });

    const students = new Map<string, string>();
    for (const row of sessionRows) {
      if (row.studentId === MANUAL_BASELINE_STUDENT_ID) continue;
      const targetId = billTarget(row.studentId);
      if (!students.has(targetId)) {
        students.set(targetId, nameOf(targetId, row.student.name));
      }
    }

    const platformSubs = await prisma.platformSubscription.findMany({
      select: {
        id: true,
        studentId: true,
        amountCHF: true,
        billingMethod: true,
        durationMonths: true,
        startMonth: true,
        startYear: true,
        student: { select: { name: true } },
      },
    });
    const subsByStudent = new Map<string, typeof platformSubs>();
    for (const sub of platformSubs) {
      const targetId = billTarget(sub.studentId);
      const list = subsByStudent.get(targetId) ?? [];
      list.push(sub);
      subsByStudent.set(targetId, list);
    }
    for (const [studentId, subs] of Array.from(subsByStudent.entries())) {
      if (students.has(studentId)) continue;
      const lines = getSubscriptionInvoiceLines(subs, year, month);
      if (lines.length > 0) {
        students.set(studentId, nameOf(studentId, subs[0].student.name));
      }
    }

    for (const inv of monthInvoices) {
      if (!students.has(inv.studentId)) students.set(inv.studentId, inv.student.name);
    }

    if (students.size === 0) {
      return NextResponse.json(
        { error: "Keine Sessions für diesen Monat gefunden." },
        { status: 404 }
      );
    }

    const zip = new JSZip();
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    let added = 0;
    const usedZipNames = new Set<string>();

    for (const [studentId, studentName] of Array.from(students.entries()).sort((a, b) =>
      a[1].localeCompare(b[1], "de-CH")
    )) {
      const storagePath = invoiceStoragePath(year, month, studentId);
      const existing = await prisma.invoice.findUnique({
        where: { studentId_month_year: { studentId, month, year } },
      });

      let safeNameBase = sanitizeFileName(studentName);
      if (usedZipNames.has(safeNameBase)) {
        safeNameBase = `${safeNameBase}-${studentId.slice(0, 8)}`;
      }

      // Sent/paid invoices are frozen: serve the stored PDF exactly as delivered,
      // never regenerate or update the invoice row.
      if (existing?.sentAt || existing?.paidAt) {
        const { data: storedFile } = await supabase.storage
          .from(INVOICE_BUCKET)
          .download(storagePath);
        if (storedFile) {
          usedZipNames.add(safeNameBase);
          zip.file(`${prefix}-${safeNameBase}.pdf`, Buffer.from(await storedFile.arrayBuffer()));
          added += 1;
          continue;
        }
        // Stored PDF missing (should not happen): rebuild for the ZIP only,
        // without touching storage or the invoice row. Kann fehlschlagen, wenn der
        // Schüler inzwischen über eine Familienrechnung abgerechnet wird — dann überspringen.
        try {
          const payload = await getInvoicePayload(studentId, year, month);
          if (payload.totalCHF > 0) {
            usedZipNames.add(safeNameBase);
            zip.file(`${prefix}-${safeNameBase}.pdf`, await buildInvoicePdf(payload));
            added += 1;
          }
        } catch {
          // Rebuild nicht möglich — Eintrag auslassen statt ganzen Export abbrechen.
        }
        continue;
      }

      // Drafts: rebuild with the current InvoicePDF template so ZIP export never serves stale layouts.
      const payload = await getInvoicePayload(studentId, year, month);
      if (payload.totalCHF <= 0) {
        await pruneStaleInvoiceIfUnbillable(studentId, year, month);
        continue;
      }

      const pdfBuffer = await buildInvoicePdf(payload);

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

      usedZipNames.add(safeNameBase);
      zip.file(`${prefix}-${safeNameBase}.pdf`, pdfBuffer);
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
