import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { freezeInvoiceSnapshot } from "@/lib/invoice-download";
import { calendarPreflight, getPeriodLabel, parseInvoiceSessionIds } from "@/lib/invoice";
import { isDelivered } from "@/lib/invoice-delivery";
import { preflightBlockMessage } from "@/lib/invoice-preflight";
import { prisma } from "@/lib/prisma";
import { parseReminderStage } from "@/lib/reminder-tokens";

type InvoiceStatusUpdate = "sent" | "paid" | "reminder" | "unpaid";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
    const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      select: {
        id: true,
        pdfPath: true,
        sentAt: true,
        paidAt: true,
        firstDownloadedAt: true,
        voidedAt: true,
        invoiceNumber: true,
        sessionIds: true,
        month: true,
        year: true,
      },
    });

    if (!invoice) {
      return NextResponse.json({ error: "Rechnung nicht gefunden." }, { status: 404 });
    }

    // Storniert: der Zustand ist entschieden. Ohne diese Pruefung liess sich eine
    // stornierte Rechnung wieder auf "bezahlt" setzen — und genau das `paidAt`
    // zurueckschreiben, das der Storno bewusst geloescht hat.
    if (invoice.voidedAt) {
      return NextResponse.json(
        { error: `Rechnung ${invoice.invoiceNumber} ist storniert — der Status kann nicht mehr geändert werden.` },
        { status: 409 }
      );
    }

    if (status === "sent" && !invoice.pdfPath) {
      return NextResponse.json(
        { error: "Bitte zuerst die Rechnung generieren." },
        { status: 409 }
      );
    }

    // "Gesendet"/"bezahlt" von Hand friert den Stand ein — dieselbe Auslieferung
    // wie der E-Mail-Versand, also dieselbe Vorpruefung. Eine bereits
    // ausgelieferte Rechnung laeuft nicht hinein: dort ist das Dokument raus, und
    // eine Sperre wuerde nur noch die Nachpflege des Status verhindern.
    if ((status === "sent" || status === "paid") && !isDelivered(invoice)) {
      const blocking = await calendarPreflight(parseInvoiceSessionIds(invoice.sessionIds));
      if (blocking.length > 0) {
        return NextResponse.json(
          {
            error: preflightBlockMessage(blocking, getPeriodLabel(invoice.month, invoice.year)),
            calendarIssues: blocking.map((i) => ({ key: i.key, reason: i.reason, title: i.title })),
          },
          { status: 409 }
        );
      }
    }

    const now = new Date();

    if (status === "reminder") {
      // stage optional: ohne Angabe (Button "Erinnerung gesendet") bleibt die bisherige Stufe stehen.
      const stage = parseReminderStage(body?.stage);
      await prisma.$executeRaw`
        UPDATE "Invoice"
        SET "sentAt" = COALESCE("sentAt", ${now}),
            "reminderSentAt" = ${now},
            "reminderStage" = COALESCE(${stage}::int, "reminderStage")
        WHERE "id" = ${invoiceId}
      `;
      const updated = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { id: true, sentAt: true, paidAt: true, reminderStage: true },
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

    // "gesendet"/"bezahlt" von Hand ist ebenfalls eine Auslieferung: der Stand wird
    // eingefroren, bevor die Rechnung unveraenderlich wird. Idempotent, also
    // unschaedlich, wenn schon ein Snapshot existiert.
    await freezeInvoiceSnapshot(
      invoiceId,
      session.user?.email ?? "system",
      status === "sent" ? "Status: gesendet" : "Status: bezahlt",
      now
    );

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
