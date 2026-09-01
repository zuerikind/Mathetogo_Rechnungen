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

/**
 * Der Rechnungsstand, wie er BEIM ERZEUGEN feststand — die Form, die auch das
 * PDF gerendert hat.
 *
 * Bewusst nur die Felder, die getInvoicePayload ohnehin liefert; die Funktion
 * kennt keine Datenbank. `sections` traegt bereits die Zuordnung Lektion →
 * Schueler, deshalb muss hier nichts nachgeschlagen werden.
 */
export type GenerationPayloadLike = {
  student: { id: string; name: string; subject: string };
  sections: {
    student: { id: string; name: string; subject: string };
    sessions: { id: string; date: Date; durationMin: number; amountCHF: number }[];
    subtotalCHF: number;
  }[];
  subscriptionLines: SnapshotSubscriptionLine[];
  totalCHF: number;
  year: number;
  month: number;
  invoiceNumber: string;
};

export type GenerationShapeInput = {
  payload: GenerationPayloadLike;
  invoice: {
    id: string;
    revision: number;
    pdfPath: string | null;
    createdAt: Date;
    sentAt: Date | null;
    paidAt: Date | null;
  };
  /** Zeitpunkt der Erzeugung — ab hier steht der Inhalt fest. */
  generatedAt: Date;
};

/**
 * Formt den eingefrorenen Stand aus dem ERZEUGUNGS-Payload statt aus einer
 * neuen Abfrage.
 *
 * Vorher entstand der Snapshot erst bei der Auslieferung und las die Lektionen
 * dabei frisch aus der Datenbank, waehrend `totalCHF` aus der Rechnungszeile
 * kam. Zwischen Erzeugen und Ausliefern konnte ein Kalender-Sync die Betraege
 * aendern — der "eingefrorene" Stand widersprach dann dem PDF, das der Kunde
 * hat, und der Abweichungserkennung fiel nichts auf, weil sie den geaenderten
 * Stand gegen sich selbst verglich.
 *
 * Jetzt gilt: was das PDF gerendert hat, wird eingefroren. Dieselbe
 * Abschnittslogik wie beim nachtraeglichen Einfrieren — deshalb laeuft alles
 * durch shapeInvoiceSnapshot und nicht durch eine zweite Implementierung.
 */
export function shapeSnapshotFromGeneration(input: GenerationShapeInput): InvoiceSnapshotPayload {
  const { payload, invoice, generatedAt } = input;

  const sessions: ShapeSession[] = payload.sections.flatMap((section) =>
    section.sessions.map((s) => ({
      id: s.id,
      studentId: section.student.id,
      date: s.date,
      durationMin: s.durationMin,
      amountCHF: s.amountCHF,
      student: section.student,
    }))
  );

  return shapeInvoiceSnapshot({
    invoice: {
      id: invoice.id,
      studentId: payload.student.id,
      year: payload.year,
      month: payload.month,
      // Der Betrag stammt aus demselben Payload wie die Positionen — Kopf und
      // Zeilen koennen sich damit nicht mehr widersprechen.
      totalCHF: payload.totalCHF,
      invoiceNumber: payload.invoiceNumber,
      revision: invoice.revision,
      pdfPath: invoice.pdfPath,
      sentAt: invoice.sentAt,
      paidAt: invoice.paidAt,
      createdAt: invoice.createdAt,
    },
    root: {
      id: payload.student.id,
      name: payload.student.name,
      subject: payload.student.subject,
    },
    children: payload.sections
      .filter((sec) => sec.student.id !== payload.student.id)
      .map((sec) => sec.student),
    sessions,
    sessionIds: sessions.map((s) => s.id),
    subscriptionLines: payload.subscriptionLines,
    frozenAt: generatedAt,
  });
}

/**
 * Welche Abschnitte gehoeren auf den Beleg?
 *
 * Abschnitte ohne Lektionen fallen weg — auch der des Zahlers. Zahlt jemand nur
 * fuer seine Kinder, stand sonst sein leerer Abschnitt mit "Zwischensumme … CHF
 * 0.00" auf der Rechnung. Nur wenn dadurch gar nichts uebrig bliebe (z. B. eine
 * reine Abo-Rechnung), bleibt der Zahler stehen, damit der Beleg jemanden nennt.
 */
export function visibleSections<T extends { student: { id: string }; sessions: unknown[] }>(
  sections: T[],
  payerId: string
): T[] {
  const withSessions = sections.filter((sec) => sec.sessions.length > 0);
  if (withSessions.length > 0) return withSessions;
  return sections.filter((sec) => sec.student.id === payerId);
}

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

/**
 * Nimmt den gespeicherten Erzeugungsstand — oder null, wenn keiner brauchbar ist.
 *
 * Rein, damit die Auswahlregel pruefbar ist: fuer neu erzeugte Rechnungen MUSS
 * der gespeicherte Stand gewinnen, sonst waere die Live-Abfrage wieder im Spiel.
 * Fuer Altbestand (null) faellt der Aufrufer bewusst auf die Live-Abfrage zurueck.
 */
export function pickStoredGenerationPayload(stored: unknown): InvoiceSnapshotPayload | null {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const c = stored as Partial<InvoiceSnapshotPayload>;
  // Minimale Plausibilitaet: ohne Positionen oder Betrag waere der gespeicherte
  // Stand schlechter als eine frische Abfrage.
  if (!Array.isArray(c.sessionIds)) return null;
  if (typeof c.totalCHF !== "number" || !Number.isFinite(c.totalCHF)) return null;
  if (!Array.isArray(c.sections)) return null;
  return stored as InvoiceSnapshotPayload;
}
