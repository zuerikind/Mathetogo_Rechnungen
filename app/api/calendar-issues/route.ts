import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { billingTargetIdOf } from "@/lib/billing-scope";
import { MANUAL_CANCELLATION_ACTION } from "@/lib/calendar-cancellation";
import { clearIncomeSummaryCache } from "@/lib/income-summary-cache";
import { sessionIdsFromIssueDetails } from "@/lib/invoice-preflight";

/**
 * Kalender-Befunde — lesen und entscheiden.
 *
 * Vier Entscheide mit unterschiedlicher Bedeutung (siehe lib/calendar-sync-issues):
 *   resolve    — geprueft/behoben. Aendert sich der Termin spaeter materiell, meldet
 *                der Sync ihn wieder. Bei Zustandsbefunden (Integritaet) haelt das
 *                nur bis zum naechsten Lauf: integrityIssueStatus oeffnet sie erneut,
 *                solange der Zustand besteht.
 *   ignore     — absichtlich so. Gilt fuer diese Event-ID dauerhaft.
 *   cancel     — die Absage aus dem Kalender jetzt von Hand nachziehen.
 *   reactivate — den Storno von Hand aufheben.
 *
 * Die letzten beiden gibt es, weil der Sync bei `cancel_needs_review` und
 * `reactivate_needs_review` bewusst NICHT eingreift (Vergangenheit oder bereits
 * fakturiert, siehe lib/calendar-cancellation). Ohne sie blieb dem Nutzer nur
 * Wegklicken — die Lektion zaehlte weiter zum Betrag, obwohl der Termin abgesagt
 * war. Der Storno ist weich: die Zeile bleibt stehen und faellt nur aus den
 * Geldabfragen, die Belegkette einer ausgelieferten Rechnung bleibt also heil.
 * Die Abweichung zum ausgelieferten Stand meldet die Abweichungserkennung.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.calendarSyncIssue.findMany({
    where: { status: "open" },
    orderBy: [{ startAt: "desc" }, { lastSeenAt: "desc" }],
    select: {
      id: true,
      externalEventId: true,
      reason: true,
      title: true,
      startAt: true,
      endAt: true,
      calendarId: true,
      detailsJson: true,
      firstSeenAt: true,
      lastSeenAt: true,
    },
  });

  return NextResponse.json({ rows, openCount: rows.length });
}

/** Welcher Befund erlaubt welchen Eingriff — ein Storno gehoert nur an seinen Befund. */
const EINGRIFF_ERLAUBT = Object.fromEntries(
  Object.entries(MANUAL_CANCELLATION_ACTION).map(([reason, action]) => [action, reason])
) as Record<"cancel" | "reactivate", string>;

/**
 * Auf welche Rechnung laeuft der Monat — und wie heisst sie im Audit?
 *
 * Fehlt die Rechnung (noch kein Entwurf), traegt der Eintrag einen sprechenden
 * Ersatzschluessel. Dasselbe Verfahren wie in lib/pending-deletion: das
 * InvoiceAuditLog ist fremdschluessel-frei, damit Nachweise ihr Bezugsobjekt
 * ueberdauern.
 */
async function auditZiel(studentId: string, year: number, month: number) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { billedToId: true },
  });
  const targetId = billingTargetIdOf(studentId, student?.billedToId ?? null);
  const invoice = await prisma.invoice.findUnique({
    where: { studentId_month_year: { studentId: targetId, month, year } },
    select: { id: true, invoiceNumber: true },
  });
  return {
    auditId: invoice?.id ?? `month:${targetId}:${year}-${String(month).padStart(2, "0")}`,
    invoiceNumber: invoice?.invoiceNumber ?? null,
  };
}

/**
 * Storno setzen oder aufheben — der Entscheid, den der Sync nicht treffen durfte.
 *
 * Bewusst weich und protokolliert: `cancelledAt` steuert, ob die Lektion zum
 * Betrag zaehlt, die Zeile selbst bleibt unangetastet. Jede Aenderung landet im
 * InvoiceAuditLog, denn sie veraendert einen Rechnungsbetrag.
 */
async function entscheideStorno(
  action: "cancel" | "reactivate",
  issueIds: string[],
  actor: string
) {
  const issues = await prisma.calendarSyncIssue.findMany({
    where: { id: { in: issueIds } },
    select: { id: true, reason: true, detailsJson: true },
  });
  const erwartet = EINGRIFF_ERLAUBT[action];
  const fremd = issues.filter((i) => i.reason !== erwartet);
  if (fremd.length > 0) {
    return NextResponse.json(
      { error: `Dieser Eingriff gilt nur für Befunde vom Typ "${erwartet}".` },
      { status: 400 }
    );
  }

  const sessionIds = Array.from(
    new Set(issues.flatMap((i) => sessionIdsFromIssueDetails(i.detailsJson)))
  );
  if (sessionIds.length === 0) {
    return NextResponse.json(
      { error: "Zu diesem Befund ist keine Lektion hinterlegt — bitte von Hand prüfen." },
      { status: 400 }
    );
  }

  const sessions = await prisma.session.findMany({
    where: {
      id: { in: sessionIds },
      // Nur was den Zustand wirklich wechselt: ein zweiter Klick soll nicht
      // ein zweites Audit-Protokoll erzeugen.
      cancelledAt: action === "cancel" ? null : { not: null },
    },
    select: {
      id: true, date: true, durationMin: true, amountCHF: true,
      year: true, month: true, studentId: true,
      student: { select: { name: true } },
    },
  });

  const now = new Date();
  for (const s of sessions) {
    const { auditId, invoiceNumber } = await auditZiel(s.studentId, s.year, s.month);
    const label =
      `${s.date.toISOString().slice(0, 10)}, ${s.student.name}, ${s.durationMin} Min, ` +
      `CHF ${s.amountCHF.toFixed(2)}`;
    await prisma.$transaction([
      prisma.session.update({
        where: { id: s.id },
        data:
          action === "cancel"
            ? { cancelledAt: now, cancelReason: "manual_review" }
            : { cancelledAt: null, cancelReason: null },
      }),
      prisma.invoiceAuditLog.create({
        data: {
          invoiceId: auditId,
          action: action === "cancel" ? "session_cancelled" : "session_reactivated",
          actor,
          beforeJson: { sessionId: s.id, cancelled: action === "reactivate" },
          afterJson: { sessionId: s.id, cancelled: action === "cancel", amountCHF: s.amountCHF },
          note:
            action === "cancel"
              ? `Lektion nach Kalenderabsage von Hand storniert: ${label}. Sie zählt nicht mehr ` +
                `zum Betrag${invoiceNumber ? `; betrifft ${invoiceNumber}` : ""}.`
              : `Storno von Hand aufgehoben, Termin steht wieder im Kalender: ${label}. Sie zählt ` +
                `wieder zum Betrag${invoiceNumber ? `; betrifft ${invoiceNumber}` : ""}.`,
        },
      }),
    ]);
  }

  // Der Befund ist beantwortet. Beim naechsten Sync entsteht er nicht neu:
  // eine stornierte Lektion gilt als "already_cancelled" und wird uebersprungen.
  await prisma.calendarSyncIssue.updateMany({
    where: { id: { in: issues.map((i) => i.id) } },
    data: { status: "resolved", resolvedAt: now, ignoredAt: null },
  });

  // Betraege haben sich geaendert — die zwischengespeicherte Summe stimmt nicht mehr.
  clearIncomeSummaryCache();

  return NextResponse.json({ action, updated: issues.length, sessions: sessions.length });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { action?: string; ids?: unknown };
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === "string")
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids sind erforderlich." }, { status: 400 });
  }
  if (body.action === "cancel" || body.action === "reactivate") {
    try {
      return await entscheideStorno(body.action, ids, session.user?.email ?? "unbekannt");
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Entscheid fehlgeschlagen." },
        { status: 500 }
      );
    }
  }
  if (body.action !== "resolve" && body.action !== "ignore") {
    return NextResponse.json(
      { error: 'action muss "resolve", "ignore", "cancel" oder "reactivate" sein.' },
      { status: 400 }
    );
  }

  const now = new Date();
  try {
    const updated = await prisma.calendarSyncIssue.updateMany({
      where: { id: { in: ids } },
      data:
        body.action === "resolve"
          ? { status: "resolved", resolvedAt: now, ignoredAt: null }
          : { status: "ignored", ignoredAt: now },
    });
    return NextResponse.json({ updated: updated.count, action: body.action });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Entscheid fehlgeschlagen." },
      { status: 500 }
    );
  }
}
