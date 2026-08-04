import "server-only";
import { prisma } from "@/lib/prisma";
import { isDelivered } from "@/lib/invoice-delivery";
import { pruneStaleInvoiceIfUnbillable } from "@/lib/invoice-stale";

/**
 * Auflösung der Löschvormerkungen aus dem Sync.
 *
 * Der Sync loescht nichts mehr selbst; er merkt vor. Hier wird entschieden:
 * bestaetigen loescht endgueltig, ablehnen behaelt die Lektion.
 *
 * Zum Audit: die Eintraege landen im InvoiceAuditLog. Das ist bewusst
 * fremdschluessel-frei, damit Nachweise das Loeschen ihres Bezugsobjekts
 * ueberdauern — genau der Fall hier. Existiert fuer den Monat keine Rechnung,
 * gibt es keine invoiceId; dann traegt der Eintrag einen sprechenden Ersatz-
 * schluessel. Sauberer waere eine eigene SessionAuditLog-Tabelle; das waere
 * eine Migration mehr fuer denselben Zweck.
 */
const monthKey = (studentId: string, year: number, month: number) =>
  `month:${studentId}:${year}-${String(month).padStart(2, "0")}`;

export type PendingDeletionRow = {
  id: string;
  date: Date;
  durationMin: number;
  amountCHF: number;
  year: number;
  month: number;
  studentName: string;
  pendingDeletionAt: Date;
  reason: string;
  /** Monat inzwischen ausgeliefert: Bestaetigen loescht dann NICHT. */
  monthDelivered: boolean;
};

/** Auf welche Rechnung laeuft der Monat dieser Lektion? (Familienrechnung beachtet) */
async function billingTargetId(studentId: string): Promise<string> {
  const s = await prisma.student.findUnique({
    where: { id: studentId },
    select: { billedToId: true },
  });
  return s?.billedToId ?? studentId;
}

async function isMonthDelivered(studentId: string, year: number, month: number): Promise<boolean> {
  const targetId = await billingTargetId(studentId);
  const invoice = await prisma.invoice.findUnique({
    where: { studentId_month_year: { studentId: targetId, month, year } },
    select: { sentAt: true, paidAt: true, firstDownloadedAt: true },
  });
  return invoice ? isDelivered(invoice) : false;
}

export async function listPendingDeletions(opts?: {
  year?: number;
  month?: number;
}): Promise<PendingDeletionRow[]> {
  const rows = await prisma.session.findMany({
    where: {
      pendingDeletionAt: { not: null },
      ...(opts?.year !== undefined ? { year: opts.year } : {}),
      ...(opts?.month !== undefined ? { month: opts.month } : {}),
    },
    orderBy: [{ year: "asc" }, { month: "asc" }, { date: "asc" }],
    select: {
      id: true, date: true, durationMin: true, amountCHF: true,
      year: true, month: true, studentId: true, pendingDeletionAt: true,
      student: { select: { name: true } },
    },
  });

  const out: PendingDeletionRow[] = [];
  for (const r of rows) {
    out.push({
      id: r.id,
      date: r.date,
      durationMin: r.durationMin,
      amountCHF: r.amountCHF,
      year: r.year,
      month: r.month,
      studentName: r.student.name,
      pendingDeletionAt: r.pendingDeletionAt as Date,
      reason: "Kalendereintrag gelöscht",
      monthDelivered: await isMonthDelivered(r.studentId, r.year, r.month),
    });
  }
  return out;
}

export type ResolveResult = {
  /** Endgueltig geloescht. */
  deleted: number;
  /** Vormerkung aufgehoben, Lektion bleibt (abgelehnt ODER Monat ausgeliefert). */
  released: number;
  /** Wegen ausgelieferter Rechnung NICHT geloescht — geht an P5. */
  blockedByDelivered: { sessionId: string; studentName: string; date: Date }[];
};

/**
 * Bestaetigen: loescht die Lektionen endgueltig.
 *
 * Ausnahme, die nicht wegoptimiert werden darf: Ist der Monat inzwischen
 * ausgeliefert, wird NICHT geloescht. Der Snapshot der Rechnung verweist auf
 * diese Session; sie zu entfernen risse die Belegkette auf. Stattdessen faellt
 * die Vormerkung weg und der Fall geht an die Abweichungserkennung (P5), die
 * ihn als session_removed meldet.
 */
export async function confirmPendingDeletions(
  sessionIds: string[],
  actor: string
): Promise<ResolveResult> {
  const sessions = await prisma.session.findMany({
    where: { id: { in: sessionIds }, pendingDeletionAt: { not: null } },
    select: {
      id: true, date: true, durationMin: true, amountCHF: true,
      year: true, month: true, studentId: true, calEventId: true,
      student: { select: { name: true } },
    },
  });

  const result: ResolveResult = { deleted: 0, released: 0, blockedByDelivered: [] };
  const touchedMonths = new Set<string>();
  const now = new Date();

  for (const s of sessions) {
    const delivered = await isMonthDelivered(s.studentId, s.year, s.month);
    const targetId = await billingTargetId(s.studentId);
    const invoice = await prisma.invoice.findUnique({
      where: { studentId_month_year: { studentId: targetId, month: s.month, year: s.year } },
      select: { id: true, invoiceNumber: true },
    });
    const auditId = invoice?.id ?? monthKey(s.studentId, s.year, s.month);
    const label =
      `${s.date.toISOString().slice(0, 10)}, ${s.student.name}, ${s.durationMin} Min, ` +
      `CHF ${s.amountCHF.toFixed(2)}`;

    if (delivered) {
      await prisma.$transaction([
        prisma.session.update({ where: { id: s.id }, data: { pendingDeletionAt: null } }),
        prisma.invoiceAuditLog.create({
          data: {
            invoiceId: auditId,
            action: "pending_deletion_released",
            actor,
            beforeJson: { sessionId: s.id, pendingDeletion: true },
            afterJson: { sessionId: s.id, deleted: false, reason: "month_delivered" },
            note:
              `Löschung abgelehnt, weil ${invoice?.invoiceNumber ?? "die Rechnung"} des Monats ` +
              `inzwischen ausgeliefert ist: ${label}. Die Lektion bleibt bestehen; die Abweichung ` +
              `wird über die Abweichungserkennung gemeldet.`,
          },
        }),
      ]);
      result.released += 1;
      result.blockedByDelivered.push({ sessionId: s.id, studentName: s.student.name, date: s.date });
      continue;
    }

    await prisma.$transaction([
      prisma.session.delete({ where: { id: s.id } }),
      prisma.invoiceAuditLog.create({
        data: {
          invoiceId: auditId,
          action: "session_deleted",
          actor,
          beforeJson: {
            sessionId: s.id, date: s.date.toISOString(), durationMin: s.durationMin,
            amountCHF: s.amountCHF, calEventId: s.calEventId,
          },
          afterJson: { deleted: true, confirmedAt: now.toISOString() },
          note: `Lektion nach Bestätigung entfernt (Kalendereintrag gelöscht): ${label}.`,
        },
      }),
    ]);
    result.deleted += 1;
    touchedMonths.add(`${targetId}|${s.year}|${s.month}`);
  }

  // Bleibt nach der Loeschung nichts Abrechenbares uebrig, faellt der Entwurf weg —
  // dasselbe Aufraeumen, das der Sync frueher direkt nach dem deleteMany machte.
  for (const key of Array.from(touchedMonths)) {
    const [studentId, y, m] = key.split("|");
    await pruneStaleInvoiceIfUnbillable(studentId, Number(y), Number(m));
  }

  return result;
}

/** Ablehnen: die Lektion bleibt, die Vormerkung faellt weg. */
export async function rejectPendingDeletions(
  sessionIds: string[],
  actor: string
): Promise<{ released: number }> {
  const sessions = await prisma.session.findMany({
    where: { id: { in: sessionIds }, pendingDeletionAt: { not: null } },
    select: {
      id: true, date: true, durationMin: true, amountCHF: true,
      year: true, month: true, studentId: true, student: { select: { name: true } },
    },
  });

  let released = 0;
  for (const s of sessions) {
    const targetId = await billingTargetId(s.studentId);
    const invoice = await prisma.invoice.findUnique({
      where: { studentId_month_year: { studentId: targetId, month: s.month, year: s.year } },
      select: { id: true },
    });
    await prisma.$transaction([
      prisma.session.update({ where: { id: s.id }, data: { pendingDeletionAt: null } }),
      prisma.invoiceAuditLog.create({
        data: {
          invoiceId: invoice?.id ?? monthKey(s.studentId, s.year, s.month),
          action: "pending_deletion_released",
          actor,
          beforeJson: { sessionId: s.id, pendingDeletion: true },
          afterJson: { sessionId: s.id, deleted: false, reason: "rejected_by_user" },
          note:
            `Löschung abgelehnt — die Lektion bleibt bestehen: ` +
            `${s.date.toISOString().slice(0, 10)}, ${s.student.name}, ${s.durationMin} Min, ` +
            `CHF ${s.amountCHF.toFixed(2)}.`,
        },
      }),
    ]);
    released += 1;
  }
  return { released };
}
