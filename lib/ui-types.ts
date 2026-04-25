export type Student = {
  id: string;
  name: string;
  subject: string;
  ratePerMin: number;
  currency?: string;
  email?: string | null;
  active?: boolean;
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
  unmatched: string[];
  /** From API when calendar returns events (debug / UX). */
  totalEvents?: number;
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
