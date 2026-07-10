import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { formatAmount, getPeriodLabel } from "@/lib/invoice";
import { supabase, INVOICE_BUCKET, invoiceStoragePath } from "@/lib/supabase";
import { getTutorProfile } from "@/lib/tutor-profile";

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "RESEND_API_KEY ist nicht gesetzt." }, { status: 500 });
    }
    const resend = new Resend(apiKey);

    const body = await req.json();
    const invoiceId = body.invoiceId as string;
    const forceResend = Boolean(body.forceResend);

    if (!invoiceId) {
      return NextResponse.json({ error: "invoiceId ist erforderlich." }, { status: 400 });
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { student: true },
    });

    if (!invoice) {
      return NextResponse.json({ error: "Rechnung nicht gefunden." }, { status: 404 });
    }

    if (invoice.sentAt && !forceResend) {
      return NextResponse.json(
        {
          error: `Diese Rechnung wurde bereits am ${new Intl.DateTimeFormat("de-CH").format(invoice.sentAt)} gesendet. Nochmals senden?`,
          alreadySent: true,
          sentAt: invoice.sentAt,
        },
        { status: 409 }
      );
    }

    if (!invoice.student.email) {
      return NextResponse.json(
        { error: "Bitte E-Mail-Adresse des Schülers hinterlegen." },
        { status: 400 }
      );
    }

    const storagePath = invoiceStoragePath(invoice.year, invoice.month, invoice.studentId);
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(INVOICE_BUCKET)
      .download(storagePath);

    if (downloadError || !fileData) {
      return NextResponse.json(
        { error: "PDF nicht gefunden. Bitte zuerst generieren." },
        { status: 404 }
      );
    }

    const pdfBuffer = Buffer.from(await fileData.arrayBuffer());
    const tutor = await getTutorProfile();
    // Email amounts come from the stored invoice so text and attached PDF always match.
    let lessonCount = 0;
    try {
      const ids = JSON.parse(invoice.sessionIds || "[]") as unknown;
      lessonCount = Array.isArray(ids) ? ids.length : 0;
    } catch {
      lessonCount = 0;
    }
    const monthLabel = getPeriodLabel(invoice.month, invoice.year);
    const fileName = storagePath;

    const subject = `Rechnung ${monthLabel} — Nachhilfe ${invoice.student.subject}`;
    const html = `
      <p>Liebe/r ${invoice.student.name},</p>
      <p>anbei findest du die Abrechnung für ${monthLabel}.</p>
      <p>${lessonCount} Lektionen, Total ${formatAmount(invoice.totalCHF)}</p>
      <p>Bei Fragen stehe ich gerne zur Verfügung.</p>
      <p>Beste Gruesse<br/>${tutor.name}</p>
    `;

    await resend.emails.send({
      from: tutor.email || process.env.TUTOR_EMAIL || "onboarding@resend.dev",
      to: invoice.student.email,
      subject,
      html,
      attachments: [{ filename: fileName, content: pdfBuffer }],
    });

    const updated = await prisma.invoice.update({
      where: { id: invoiceId },
      data: { sentAt: new Date() },
    });

    return NextResponse.json({ success: true, sentTo: invoice.student.email, sentAt: updated.sentAt });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fehler beim Versand." },
      { status: 500 }
    );
  }
}
