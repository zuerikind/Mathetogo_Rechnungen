import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { buildInvoicePdf } from "@/lib/invoice-pdf";
import { commitInvoiceContent, getInvoicePayload, reserveInvoiceRow } from "@/lib/invoice";
import { DELIVERED_INVOICE_WHERE, isDelivered } from "@/lib/invoice-delivery";
import { recordInvoiceDownload } from "@/lib/invoice-download";
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

/**
 * Monatsexport als ZIP — bewusst POST, nicht GET.
 *
 * Der Export erfasst die enthaltenen Rechnungen als ausgeliefert und generiert
 * fehlende PDFs nach. Beides darf nicht passieren, weil ein Browser eine URL
 * spekulativ vorablädt; POST wird nie vorabgeladen.
 */
export async function POST(req: NextRequest) {
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

    // Ausgelieferte Rechnungen gehören in den Export, auch wenn ihre Lektionen
    // inzwischen entfernt wurden — es sind echte, zugestellte Dokumente.
    const monthInvoices = await prisma.invoice.findMany({
      where: { year, month, ...DELIVERED_INVOICE_WHERE },
      select: { studentId: true, student: { select: { name: true } } },
    });
    // Schüler mit eigener ausgelieferter Rechnung für den Monat bleiben eigenständig —
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
    /** Rechnungen, die ins Archiv gekommen sind — eingefroren wird erst am Ende. */
    const zuFrieren: string[] = [];
    const usedZipNames = new Set<string>();
    // Der ZIP-Export liefert dieselben Dokumente aus wie der Einzeldownload und wird
    // deshalb genauso erfasst: erster Download friert den Stand ein.
    const actor = userSession.user?.email ?? "unbekannt";
    const exportedAt = new Date();

    for (const [studentId, studentName] of Array.from(students.entries()).sort((a, b) =>
      a[1].localeCompare(b[1], "de-CH")
    )) {
      const existing = await prisma.invoice.findUnique({
        where: { studentId_month_year: { studentId, month, year } },
      });
      // Ausgelieferte Rechnungen kommen in ihrer aktuellen Revision in den Export;
      // fuer noch nicht angelegte Entwuerfe gilt Revision 1.
      const storagePath = invoiceStoragePath(year, month, studentId, existing?.revision ?? 1);

      let safeNameBase = sanitizeFileName(studentName);
      if (usedZipNames.has(safeNameBase)) {
        safeNameBase = `${safeNameBase}-${studentId.slice(0, 8)}`;
      }

      // Ausgelieferte Rechnungen sind eingefroren: die gespeicherte PDF wird
      // genau so ausgegeben, wie sie zugestellt wurde — nie neu gebaut, nie die
      // Rechnungszeile angefasst. "Heruntergeladen" zaehlt dazu; frueher fielen
      // solche Rechnungen in den Entwurfszweig und wurden dort still ueberschrieben.
      if (existing && isDelivered(existing)) {
        const { data: storedFile } = await supabase.storage
          .from(INVOICE_BUCKET)
          .download(storagePath);
        if (storedFile) {
          usedZipNames.add(safeNameBase);
          zip.file(`${prefix}-${safeNameBase}.pdf`, Buffer.from(await storedFile.arrayBuffer()));
          added += 1;
          // Noch NICHT einfrieren — erst wenn das Archiv wirklich steht (Phase 3).
          zuFrieren.push(existing.id);
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
            // Noch NICHT einfrieren — erst wenn das Archiv wirklich steht (Phase 3).
            zuFrieren.push(existing.id);
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

      // Wie in /api/invoice/generate: Nummer und Zeile vor dem PDF-Bau festlegen,
      // damit das exportierte PDF die gespeicherte Nummer trägt.
      const { invoiceId, invoiceNumber } = await reserveInvoiceRow({
        studentId,
        year,
        month,
        totalCHF: payload.totalCHF,
        sessionIds: payload.sessions.map((s) => s.id),
      });

      const pdfBuffer = await buildInvoicePdf({ ...payload, invoiceNumber });

      const { error: uploadError } = await supabase.storage
        .from(INVOICE_BUCKET)
        .upload(storagePath, pdfBuffer, {
          contentType: "application/pdf",
          // Nur Entwuerfe landen hier (siehe Guard oben) — das Schloss bleibt
          // trotzdem gesetzt, damit ein kuenftiger Pfad nicht still ueberschreibt.
          upsert: !existing || !isDelivered(existing),
        });

      if (uploadError) {
        return NextResponse.json(
          {
            error: `PDF-Upload fehlgeschlagen (${studentName}): ${uploadError.message}`,
          },
          { status: 500 }
        );
      }

      // Erst nach dem Upload festschreiben — gleiche Reihenfolge wie in
      // /api/invoice/generate, damit Zeile und gespeichertes PDF nie auseinanderlaufen.
      const pdfUrl = invoicePublicUrl(year, month, studentId);
      await commitInvoiceContent({ invoiceId, payload: { ...payload, invoiceNumber }, pdfPath: pdfUrl });

      usedZipNames.add(safeNameBase);
      zip.file(`${prefix}-${safeNameBase}.pdf`, pdfBuffer);
      added += 1;
      // Nach dem pdfPath-Update, damit der eingefrorene Stand den Speicherort kennt.
      // Noch NICHT einfrieren — erst wenn das Archiv wirklich steht (Phase 3).
      zuFrieren.push(invoiceId);
    }

    if (added === 0) {
      return NextResponse.json(
        { error: "Keine Rechnungen für den Export verfügbar." },
        { status: 404 }
      );
    }

    // Phase 2: Das Archiv muss zuerst stehen.
    const archive = await zip.generateAsync({ type: "nodebuffer" });

    // Phase 3: Erst jetzt ausliefern-markieren.
    //
    // Vorher wurde jede Rechnung sofort nach ihrem PDF eingefroren. Brach der
    // Export beim fuenften Schueler ab, waren die ersten vier unveraenderlich
    // ausgeliefert — obwohl der Nutzer eine Fehlermeldung sah und nie ein
    // Archiv bekam. Korrigierbar waren sie danach nur noch ueber eine Revision.
    //
    // Jetzt gilt: keine Datei, kein Einfrieren. Phase 1 (Nummer, PDF, Zeile)
    // bleibt wiederholbar — dieselbe Nummer, dasselbe PDF, siehe
    // reserveInvoiceRow —, ein Fehlversuch hinterlaesst also nur Entwuerfe.
    //
    // Verbleibende Bruchstelle, bewusst und dokumentiert: die Markierungen
    // selbst sind kein einzelner Commit. Faellt die Verbindung mitten in dieser
    // Schleife aus, sind einige Rechnungen eingefroren und andere nicht. Das ist
    // die harmlose Richtung — eingefroren wird nur, was tatsaechlich im Archiv
    // liegt, und der Wiederholungslauf ist idempotent (freezeInvoiceSnapshot und
    // recordInvoiceDownload steigen bei bereits eingefrorenen Rechnungen aus).
    // Ein Fehler hier darf das fertige Archiv nicht mehr verhindern: der Nutzer
    // haette sonst PDFs, die als nicht ausgeliefert gelten.
    let frozen = 0;
    const freezeErrors: string[] = [];
    for (const id of zuFrieren) {
      try {
        await recordInvoiceDownload(id, actor, "Monatsexport (ZIP)", exportedAt);
        frozen += 1;
      } catch (err) {
        freezeErrors.push(id);
        console.error("[zip-export] Einfrieren fehlgeschlagen:", id, err);
      }
    }
    if (freezeErrors.length > 0) {
      console.error(
        `[zip-export] ${freezeErrors.length} von ${zuFrieren.length} Rechnungen nicht als ausgeliefert markiert.`
      );
    }

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
