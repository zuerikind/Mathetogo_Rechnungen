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
