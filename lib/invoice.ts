import "server-only";
import { Prisma, Session, Student } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  formatAmount,
  formatDate,
  formatDuration,
  getInvoiceDueDate,
  getPeriodLabel,
  getStudentInitials,
} from "@/lib/invoice-format";
import {
  collectBilledSessionIds,
  excludeAlreadyBilledSessions,
} from "@/lib/billing-scope";
import { BILLED_ELSEWHERE_WHERE } from "@/lib/invoice-delivery";
import { shapeSnapshotFromGeneration } from "@/lib/invoice-snapshot-shape";
import { getTutorProfile, TutorProfileData } from "@/lib/tutor-profile";
import { getSubscriptionInvoiceLines } from "@/lib/subscription-billing";

// amountCHF bewusst neu gesetzt statt aus Session gepickt: das Prisma-Modell
// fuehrt es seit P2c als Decimal, der erweiterte Client in lib/prisma.ts liefert
// aber number. Wer hier den rohen Modelltyp picken wuerde, bekaeme Decimal und
// damit einen Typ, den es zur Laufzeit nie gibt.
export type InvoiceSession = Pick<
  Session,
  "id" | "date" | "durationMin" | "month" | "year"
> & { amountCHF: number };

export type InvoiceSubscriptionLine = {
  id: string;
  description: string;
  amountCHF: number;
};

/** Ein Schüler-Abschnitt auf der Rechnung (Familienrechnung: einer pro Kind). */
export type InvoiceSection = {
  student: Pick<Student, "id" | "name" | "subject">;
  sessions: InvoiceSession[];
  subtotalCHF: number;
};

export type InvoicePayload = {
  student: Pick<Student, "id" | "name" | "email" | "subject" | "currency">;
  tutor: TutorProfileData;
  /** Alle Sessions der Rechnungsgruppe, in Abschnitts-Reihenfolge. */
  sessions: InvoiceSession[];
  /** Pro Schüler der Gruppe (Hauptschüler zuerst); Länge 1 bei Einzelrechnung. */
  sections: InvoiceSection[];
  /** Nachhilfe-Sessions only (excludes Abo on invoice). */
  sessionsSubtotalCHF: number;
  /** Rechnung-Abo: full amount on Abo-Startmonat; Überweisung omitted. */
  subscriptionLines: InvoiceSubscriptionLine[];
  year: number;
  month: number;
  periodLabel: string;
  totalCHF: number;
  totalMinutes: number;
  invoiceNumber: string;
  /** Ausgabestand. Fehlt/1 = Erstausstellung, ab 2 traegt das PDF den Revisionsvermerk. */
  revision?: number;
  /** Auslieferungszeitpunkt der Fassung, die diese Revision ersetzt. */
  replacesDeliveredAt?: Date | null;
};

export { formatAmount, formatDate, formatDuration, getInvoiceDueDate, getPeriodLabel };

export async function getInvoicePayload(
  studentId: string,
  year: number,
  month: number
): Promise<InvoicePayload> {
  const [student, children, existingInvoice, tutor] = await Promise.all([
    prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        name: true,
        email: true,
        subject: true,
        currency: true,
        billedToId: true,
        billedTo: { select: { name: true } },
      },
    }),
    prisma.student.findMany({
      where: { billedToId: studentId },
      select: { id: true, name: true, subject: true },
      orderBy: { name: "asc" },
    }),
    prisma.invoice.findUnique({
      where: { studentId_month_year: { studentId, month, year } },
      select: { invoiceNumber: true },
    }),
    getTutorProfile(),
  ]);

  if (!student) {
    throw new Error("Schüler nicht gefunden");
  }
  if (student.billedToId) {
    throw new Error(
      `${student.name} wird über die Rechnung von ${student.billedTo?.name ?? "einem anderen Schüler"} abgerechnet.`
    );
  }

  // Kinder mit bereits AUSGELIEFERTER Einzelrechnung für diesen Monat (z. B. vor der
  // Verknüpfung) bleiben draussen — sonst würden ihre Lektionen doppelt verrechnet.
  // Heruntergeladen zählt dazu: das Dokument ist raus, die Lektionen sind fakturiert.
  const childrenBilledSeparately =
    children.length > 0
      ? await prisma.invoice.findMany({
          where: {
            studentId: { in: children.map((c) => c.id) },
            year,
            month,
            // BILLED_ELSEWHERE, nicht DELIVERED: eine STORNIERTE Einzelrechnung
            // rechnet nichts ab, ihre Lektionen gehoeren zurueck in die Gruppe.
            // Vorher fielen sie zwischen beide Rechnungen und wurden nie fakturiert.
            ...BILLED_ELSEWHERE_WHERE,
          },
          select: { studentId: true },
        })
      : [];
  const excludedChildIds = new Set(childrenBilledSeparately.map((i) => i.studentId));

  const members = [
    { id: student.id, name: student.name, subject: student.subject },
    ...children.filter((c) => !excludedChildIds.has(c.id)),
  ];
  const memberIds = members.map((m) => m.id);

  const [allGroupSessions, subscriptions] = await Promise.all([
    prisma.session.findMany({
      where: { studentId: { in: memberIds }, year, month },
      orderBy: { date: "asc" },
      select: {
        id: true,
        studentId: true,
        date: true,
        durationMin: true,
        amountCHF: true,
        month: true,
        year: true,
      },
    }),
    prisma.platformSubscription.findMany({
      where: { studentId: { in: memberIds } },
      select: {
        id: true,
        studentId: true,
        amountCHF: true,
        billingMethod: true,
        durationMonths: true,
        startMonth: true,
        startYear: true,
      },
    }),
  ]);

  // Struktureller Schutz gegen Doppelfakturierung.
  //
  // Bis hierher entscheidet nur die Gruppenzugehoerigkeit, welche Lektionen auf
  // die Rechnung kommen — und die ist beweglich: `billedToId` ist eine normale
  // Spalte ohne Historie. Wird ein Kind von Eltern A zu Eltern B umgehaengt,
  // gehoeren seine Lektionen ploetzlich zu B, auch die Monate, die auf A's
  // bereits ausgelieferter Rechnung stehen. Sie wuerden ein zweites Mal
  // fakturiert, unter einer zweiten Nummer, an einen zweiten Zahler.
  //
  // Invoice.sessionIds haelt fest, welche Lektionen eine Rechnung tatsaechlich
  // abgerechnet hat. Steht eine Lektion dort auf einem ausgelieferten, nicht
  // stornierten Beleg, ist sie fakturiert — unabhaengig davon, zu welcher
  // Gruppe der Schueler heute gehoert. Das ist die einzige Stelle im System,
  // die "schon abgerechnet" aus dem Beleg selbst ableitet statt aus der
  // aktuellen Zuordnung.
  const otherBilledInvoices = await prisma.invoice.findMany({
    where: {
      year,
      month,
      studentId: { not: studentId },
      ...BILLED_ELSEWHERE_WHERE,
    },
    select: { sessionIds: true },
  });
  const groupSessions = excludeAlreadyBilledSessions(
    allGroupSessions,
    collectBilledSessionIds(otherBilledInvoices)
  );

  const roundCents = (n: number) => Math.round(n * 100) / 100;
  const sections: InvoiceSection[] = members
    .map((m) => {
      const own = groupSessions.filter((s) => s.studentId === m.id);
      return {
        student: m,
        sessions: own,
        subtotalCHF: roundCents(own.reduce((acc, s) => acc + s.amountCHF, 0)),
      };
    })
    // Kinder ohne Lektionen im Monat erscheinen nicht auf der Rechnung.
    .filter((sec) => sec.student.id === student.id || sec.sessions.length > 0);

  const sessions = sections.flatMap((sec) => sec.sessions);
  const sessionsSubtotalCHF = roundCents(sessions.reduce((acc, s) => acc + s.amountCHF, 0));
  const subscriptionLines = members.flatMap((m) =>
    getSubscriptionInvoiceLines(
      subscriptions.filter((s) => s.studentId === m.id),
      year,
      month
    ).map((line) =>
      members.length > 1 ? { ...line, description: `${m.name} — ${line.description}` } : line
    )
  );
  const subscriptionTotalCHF = subscriptionLines.reduce((acc, l) => acc + l.amountCHF, 0);
  const totalCHF = roundCents(sessionsSubtotalCHF + subscriptionTotalCHF);
  const totalMinutes = sessions.reduce((acc, s) => acc + s.durationMin, 0);
  const stored = existingInvoice?.invoiceNumber?.trim();
  const provisional = `${year}-${String(month).padStart(2, "0")}-${getStudentInitials(student.name)}`;
  const invoiceNumber = stored && stored.length > 0 ? stored : provisional;

  return {
    student,
    tutor,
    sessions,
    sections,
    sessionsSubtotalCHF,
    subscriptionLines,
    year,
    month,
    periodLabel: getPeriodLabel(month, year),
    totalCHF,
    totalMinutes,
    invoiceNumber,
  };
}

/**
 * Der Client, den `prisma.$transaction` seinem Callback übergibt. Wird vom echten
 * (per $extends erweiterten) Client abgeleitet — `Prisma.TransactionClient` passt
 * dazu nicht, weil die Erweiterung in lib/prisma.ts den Typ verändert.
 */
type InvoiceTx = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export function formatInvoiceNumber(year: number, sequential: number): string {
  return `${year}-${String(sequential).padStart(4, "0")}`;
}

/**
 * Zieht die nächste Rechnungsnummer des Jahres.
 *
 * Ein einziges INSERT ... ON CONFLICT DO UPDATE ... RETURNING: PostgreSQL sperrt
 * die Zählerzeile für die Dauer des Statements, parallele Aufrufe werden serialisiert
 * und bekommen zwingend verschiedene Nummern. Das frühere max(invoiceNumber)+1 war ein
 * Read-Modify-Write ohne Sperre und hat im Bestand 34 doppelte Nummern erzeugt.
 *
 * Muss innerhalb derselben Transaktion laufen wie das Anlegen der Rechnungszeile,
 * damit eine gezogene Nummer nicht ohne zugehörige Rechnung verfällt.
 */
export async function allocateInvoiceNumber(tx: InvoiceTx, year: number): Promise<string> {
  const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
    INSERT INTO "InvoiceNumberSequence" ("year", "lastNumber", "updatedAt")
    VALUES (${year}, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("year") DO UPDATE
      SET "lastNumber" = "InvoiceNumberSequence"."lastNumber" + 1,
          "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "lastNumber"
  `;
  const next = rows[0]?.lastNumber;
  if (!Number.isInteger(next) || next < 1) {
    throw new Error("Rechnungsnummer konnte nicht vergeben werden.");
  }
  return formatInvoiceNumber(year, next);
}

/**
 * Legt die Rechnungszeile an (oder aktualisiert sie) und stellt sicher, dass sie
 * eine endgültige Nummer trägt — beides in einer Transaktion.
 *
 * Bewusst VOR dem PDF-Bau aufzurufen: nur so trägt das PDF dieselbe Nummer wie die
 * Datenbank. Früher wurde das PDF zuerst gebaut und bekam die provisorische
 * Initialen-Nummer, während die DB eine sequenzielle speicherte.
 *
 * `pdfPath` wird hier NICHT gesetzt — das übernimmt der Aufrufer nach dem Upload.
 * Schlägt der PDF-Bau fehl, bleibt die Zeile mit ihrer Nummer bestehen und ein
 * erneuter Versuch verwendet dieselbe Nummer wieder.
 */
export async function reserveInvoiceRow(params: {
  studentId: string;
  year: number;
  month: number;
  totalCHF: number;
  sessionIds: string[];
}): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const { studentId, year, month, totalCHF, sessionIds } = params;
  return prisma.$transaction(async (tx) => {
    // Ein Doppelklick auf "Generieren" schickt zwei Requests. Beide lesen "keine
    // Nummer", beide vergeben eine: die erste committet, die zweite ueberschreibt
    // die Zeile mit ihrer eigenen Nummer — die erste ist verbrannt, und das PDF im
    // Storage kann die Nummer tragen, die in der Datenbank nicht mehr steht. Der
    // Zaehler serialisiert nur die Vergabe, nicht das Lesen davor. Diese Sperre
    // macht Lesen und Schreiben pro (Schueler, Monat) atomar; sie faellt mit der
    // Transaktion automatisch weg.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${studentId}:${year}:${month}`}))`;

    const existing = await tx.invoice.findUnique({
      where: { studentId_month_year: { studentId, month, year } },
      select: { invoiceNumber: true },
    });
    const existingNumber = existing?.invoiceNumber?.trim();
    const invoiceNumber = existingNumber?.length
      ? existingNumber
      : await allocateInvoiceNumber(tx, year);

    // Beim Anlegen stehen Betrag und Positionen mit drin — es gibt noch kein PDF,
    // das ihnen widersprechen koennte. Bei einer BESTEHENDEN Zeile bleiben sie
    // unangetastet: solange das neue PDF nicht liegt, zeigt pdfPath noch auf das
    // alte, und Betrag/Positionen muessen zu genau diesem Dokument passen.
    // Geschrieben werden sie erst nach dem Upload, zusammen mit pdfPath.
    const row = await tx.invoice.upsert({
      where: { studentId_month_year: { studentId, month, year } },
      update: { invoiceNumber },
      create: {
        studentId,
        month,
        year,
        totalCHF,
        sessionIds: JSON.stringify(sessionIds),
        invoiceNumber,
      },
      select: { id: true },
    });
    return { invoiceId: row.id, invoiceNumber };
  });
}

/**
 * Betrag, Positionen und PDF-Pfad in einem Zug — erst wenn das PDF wirklich liegt.
 *
 * Vorher committete reserveInvoiceRow den neuen Betrag und scheiterte danach am
 * PDF-Bau oder Upload. Die Zeile sagte dann 480.00, waehrend pdfPath noch auf das
 * alte 360.00-PDF zeigte; der Kunde bekam beim Download das alte Dokument,
 * Buchhaltung und Snapshot behaupteten den neuen Betrag. Diese Reihenfolge macht
 * das unmoeglich: was in der Zeile steht, ist immer das, was im Storage liegt.
 */
export async function commitInvoiceContent(params: {
  invoiceId: string;
  /** Der Payload, aus dem das soeben hochgeladene PDF gerendert wurde. */
  payload: InvoicePayload;
  pdfPath: string;
  now?: Date;
}): Promise<void> {
  const { invoiceId, payload, pdfPath } = params;
  const now = params.now ?? new Date();

  const row = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, revision: true, createdAt: true, sentAt: true, paidAt: true },
  });
  if (!row) throw new Error("Rechnungszeile nicht gefunden.");

  // Der Erzeugungsstand wird zusammen mit Betrag, Positionen und Pfad
  // festgeschrieben: ein Datensatz, eine Wahrheit. Beim Ausliefern wird genau
  // dieser Stand eingefroren — es gibt dort keine zweite Lektionsabfrage mehr,
  // die den bereits gedruckten Inhalt neu definieren koennte.
  const generated = shapeSnapshotFromGeneration({
    payload,
    invoice: {
      id: row.id,
      revision: row.revision,
      pdfPath,
      createdAt: row.createdAt,
      sentAt: row.sentAt,
      paidAt: row.paidAt,
    },
    generatedAt: now,
  });

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      totalCHF: payload.totalCHF,
      sessionIds: JSON.stringify(payload.sessions.map((s) => s.id)),
      pdfPath,
      generatedPayloadJson: generated as unknown as Prisma.InputJsonValue,
    },
  });
}

/** Safe ASCII-ish basename for downloads, e.g. `aiyana_04_2026.pdf` */
export function getInvoicePdfDownloadBaseName(studentName: string, month: number, year: number): string {
  const mm = String(month).padStart(2, "0");
  const slug = studentName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
  const base = slug.length > 0 ? `${slug}_${mm}_${year}` : `rechnung_${mm}_${year}`;
  return `${base}.pdf`;
}
