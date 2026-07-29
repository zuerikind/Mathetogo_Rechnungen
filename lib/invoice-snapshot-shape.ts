/**
 * Reine Formung des eingefrorenen Rechnungsstands — kein DB-Zugriff, damit sie
 * testbar bleibt. Die IO-Seite liegt in lib/invoice-snapshot.ts.
 *
 * Verankert an der Rechnungszeile (sessionIds, totalCHF), NICHT an "was wäre jetzt
 * abrechenbar": Der Snapshot bildet ab, was ausgeliefert wurde. Genau gegen diesen
 * Stand vergleicht P5 später den Kalender.
 */

export type SnapshotSession = {
  id: string;
  studentId: string;
  date: string;
  durationMin: number;
  amountCHF: number;
};

export type SnapshotSection = {
  studentId: string;
  studentName: string;
  subject: string;
  subtotalCHF: number;
  sessions: SnapshotSession[];
};

export type SnapshotSubscriptionLine = {
  id: string;
  description: string;
  amountCHF: number;
};

export type InvoiceSnapshotPayload = {
  invoiceId: string;
  invoiceNumber: string;
  revision: number;
  studentId: string;
  studentName: string;
  year: number;
  month: number;
  /** Gesamtbetrag laut Rechnungszeile — der Betrag, der auf dem PDF steht. */
  totalCHF: number;
  sessionsSubtotalCHF: number;
  subscriptionTotalCHF: number;
  sections: SnapshotSection[];
  subscriptionLines: SnapshotSubscriptionLine[];
  /** Alle Session-IDs laut Rechnungszeile, auch nicht mehr auffindbare. */
  sessionIds: string[];
  /** IDs aus sessionIds, zu denen beim Einfrieren keine Session mehr existierte. */
  missingSessionIds: string[];
  pdfPath: string | null;
  sentAt: string | null;
  paidAt: string | null;
  invoiceCreatedAt: string;
  frozenAt: string;
};

export type ShapeMember = { id: string; name: string; subject: string };

export type ShapeSession = {
  id: string;
  studentId: string;
  date: Date;
  durationMin: number;
  amountCHF: number;
  student: ShapeMember;
};

export type ShapeInput = {
  invoice: {
    id: string;
    studentId: string;
    year: number;
    month: number;
    totalCHF: number;
    invoiceNumber: string;
    revision: number;
    pdfPath: string | null;
    sentAt: Date | null;
    paidAt: Date | null;
    createdAt: Date;
  };
  /** Hauptschüler; null, wenn er nicht mehr existiert. */
  root: ShapeMember | null;
  /** Geschwister der Familienrechnung, alphabetisch. */
  children: ShapeMember[];
  /** Zu den gespeicherten sessionIds gefundene Sessions. */
  sessions: ShapeSession[];
  /** Session-IDs laut Rechnungszeile, in gespeicherter Reihenfolge. */
  sessionIds: string[];
  subscriptionLines: SnapshotSubscriptionLine[];
  frozenAt: Date;
};

export function parseSessionIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

const roundCents = (n: number) => Math.round(n * 100) / 100;

export function shapeInvoiceSnapshot(input: ShapeInput): InvoiceSnapshotPayload {
  const { invoice, root, children, sessions, sessionIds, subscriptionLines, frozenAt } = input;

  const found = new Set(sessions.map((s) => s.id));
  const missingSessionIds = sessionIds.filter((id) => !found.has(id));

  // Abschnitte in PDF-Reihenfolge: Hauptschüler zuerst, dann Geschwister, zuletzt
  // Schüler, die nur noch über die Sessions bekannt sind (z. B. Verknüpfung gelöst).
  const memberOrder: ShapeMember[] = [
    ...(root ? [root] : []),
    ...children,
    ...sessions.map((s) => s.student),
  ];

  const seen = new Set<string>();
  const sections: SnapshotSection[] = [];
  for (const member of memberOrder) {
    if (seen.has(member.id)) continue;
    seen.add(member.id);
    const own = sessions.filter((s) => s.studentId === member.id);
    // Der Hauptschüler bleibt auch ohne Lektionen sichtbar (er trägt die Rechnung).
    if (own.length === 0 && member.id !== invoice.studentId) continue;
    sections.push({
      studentId: member.id,
      studentName: member.name,
      subject: member.subject,
      subtotalCHF: roundCents(own.reduce((acc, s) => acc + s.amountCHF, 0)),
      sessions: own.map((s) => ({
        id: s.id,
        studentId: s.studentId,
        date: s.date.toISOString(),
        durationMin: s.durationMin,
        amountCHF: s.amountCHF,
      })),
    });
  }

  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    revision: invoice.revision,
    studentId: invoice.studentId,
    studentName: root?.name ?? "",
    year: invoice.year,
    month: invoice.month,
    totalCHF: invoice.totalCHF,
    sessionsSubtotalCHF: roundCents(sessions.reduce((acc, s) => acc + s.amountCHF, 0)),
    subscriptionTotalCHF: roundCents(subscriptionLines.reduce((acc, l) => acc + l.amountCHF, 0)),
    sections,
    subscriptionLines,
    sessionIds,
    missingSessionIds,
    pdfPath: invoice.pdfPath,
    sentAt: invoice.sentAt?.toISOString() ?? null,
    paidAt: invoice.paidAt?.toISOString() ?? null,
    invoiceCreatedAt: invoice.createdAt.toISOString(),
    frozenAt: frozenAt.toISOString(),
  };
}
