import type { SyncUnmatchedEvent } from "@/lib/sync-unmatched";

export type { SyncUnmatchedEvent, SyncUnmatchedReason } from "@/lib/sync-unmatched";

export type Student = {
  id: string;
  name: string;
  subject: string;
  ratePerMin: number;
  currency?: string;
  email?: string | null;
  active?: boolean;
  /** Familienrechnung: id des Schülers, über dessen Rechnung abgerechnet wird. */
  billedToId?: string | null;
};

export type SessionWithStudent = {
  id: string;
  studentId: string;
  date: string;
  durationMin: number;
  amountCHF: number;
  month: number;
  year: number;
  notes?: string | null;
  student?: {
    id: string;
    name: string;
    subject?: string;
  };
};

export const MANUAL_BASELINE_STUDENT_ID = "manual-baseline-revenue";

export function isManualBaselineSession(
  session: Pick<SessionWithStudent, "studentId" | "notes">
): boolean {
  return (
    session.studentId === MANUAL_BASELINE_STUDENT_ID ||
    Boolean(session.notes?.toLowerCase().includes("manuell: gesamteinnahmen monat"))
  );
}

export type SyncResponse = {
  synced: number;
  skipped: number;
  unmatched: SyncUnmatchedEvent[];
  /** Offene, noch nicht entschiedene Kalender-Befunde insgesamt (inkl. frueherer Laeufe). */
  unmatchedOpenTotal?: number;
  /** In diesem Lauf zur Löschung vorgemerkt (Kalendereintrag nachweislich weg). */
  pendingDeletions?: number;
  /** Offene Vormerkungen im Monat insgesamt — warten auf eine Entscheidung. */
  pendingDeletionsTotal?: number;
  /** Kandidaten, die diesmal nicht mehr einzeln geprüft wurden (Limit pro Lauf). */
  pendingUnverified?: number;
  /**
   * Wurde die Google-Seitenkette bis zum Ende gelesen?
   *
   * false heisst: die Terminliste ist unvollständig. Der Abgleich der gelesenen
   * Termine stimmt weiterhin, aber "fehlt" bedeutet dann NICHT "abgesagt" — es
   * wird in diesem Lauf nichts wegen blosser Abwesenheit storniert.
   */
  pagesComplete?: boolean;
  pages?: number;
  /** Kompakte Bilanz des Laufs: was automatisch geschah, was offen bleibt. */
  summary?: {
    /** Lektionen, die eine neue Kalender-ID bekamen statt eines Duplikats. */
    relinked: number;
    /** Automatisch soft-stornierte Lektionen (Absage im Kalender). */
    cancelled: number;
    /** Automatisch wieder aktivierte Lektionen (Termin ist zurück). */
    reactivated: number;
    /** Befunde, die ein Mensch entscheiden muss — blockieren die Auslieferung. */
    needsReview: number;
  };
  /** Stornierkandidaten, die diesmal nicht mehr bei Google nachgefragt wurden. */
  cancelUnverified?: number;
  staleInvoicesRemoved?: number;
  /** From API when calendar returns events (debug / UX). */
  totalEvents?: number;
  /** Ausgelieferte Rechnungen des Monats, die auf Abweichungen geprüft wurden. */
  invoicesChecked?: number | null;
  /** Davon mit neu erkannter Abweichung (needsReview gesetzt). */
  invoicesFlagged?: number | null;
  /**
   * Gesetzt, wenn die Abweichungserkennung fehlschlug. Der Sync selbst war dann
   * trotzdem erfolgreich — nur ausgelieferte Rechnungen wurden nicht geprüft.
   */
  detectionError?: string | null;
  /** Set client-side when the sync request fails (HTTP or network). */
  clientError?: string;
  sessions?: SessionWithStudent[];
};

export type PlatformCharge = {
  id: string;
  subscriptionId: string;
  month: number;
  year: number;
  amountCHF: number;
  paidAt: string | null;
  createdAt: string;
};

export type PlatformSubscriptionWithCharges = {
  id: string;
  studentId: string;
  amountCHF: number;
  billingMethod: string;
  durationMonths: number;
  startMonth: number;
  startYear: number;
  active: boolean;
  charges: PlatformCharge[];
  createdAt: string;
  updatedAt: string;
};
