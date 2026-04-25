/**
 * File defaults for Jan.–Mär. manual totals (used when DB has no saved values).
 */
export const MANUAL_BASELINE_YEAR = 2026;

export type ManualRevenueEntry = {
  month: number;
  amountCHF: number;
};

export const MANUAL_BASELINE_BY_MONTH: ReadonlyArray<ManualRevenueEntry> = [
  { month: 1, amountCHF: 8501.8 },
  { month: 2, amountCHF: 4197.5 },
  { month: 3, amountCHF: 4624.0 },
];

export type ManualBaseline = {
  year: number;
  entries: ManualRevenueEntry[];
};

type DbManualFields = {
  manualQ1Year: number | null;
  manualQ1M1Chf: number | null;
  manualQ1M2Chf: number | null;
  manualQ1M3Chf: number | null;
} | null;

/**
 * Returns saved DB values if all three month amounts are set; otherwise file defaults.
 */
export function getEffectiveManualBaseline(db: DbManualFields): ManualBaseline & { fromDatabase: boolean } {
  if (
    db &&
    db.manualQ1M1Chf != null &&
    db.manualQ1M2Chf != null &&
    db.manualQ1M3Chf != null
  ) {
    return {
      year: db.manualQ1Year ?? MANUAL_BASELINE_YEAR,
      entries: [
        { month: 1, amountCHF: db.manualQ1M1Chf },
        { month: 2, amountCHF: db.manualQ1M2Chf },
        { month: 3, amountCHF: db.manualQ1M3Chf },
      ],
      fromDatabase: true,
    };
  }
  return {
    year: MANUAL_BASELINE_YEAR,
    entries: [...MANUAL_BASELINE_BY_MONTH],
    fromDatabase: false,
  };
}

type SessionLike = {
  id: string;
  studentId: string;
  date: Date;
  durationMin: number;
  amountCHF: number;
  calEventId: string | null;
  month: number;
  year: number;
  notes: string | null;
  createdAt: Date;
  student: {
    id: string;
    name: string;
    subject: string;
  } | null;
};

type MergeQuery = {
  studentId: string | null;
  year: string | null;
  month: string | null;
};

const MANUAL_ID = "manual-baseline-revenue";

function syntheticSession(baseline: ManualBaseline, month: number, amountCHF: number): SessionLike {
  const d = new Date(baseline.year, month - 1, 15, 12, 0, 0, 0);
  return {
    id: `${MANUAL_ID}-${baseline.year}-${month}`,
    studentId: MANUAL_ID,
    date: d,
    durationMin: 0,
    amountCHF,
    calEventId: null,
    month,
    year: baseline.year,
    notes:
      "Manuell: Gesamteinnahmen Monat (Historie; ab April aus Kalender).",
    createdAt: d,
    student: {
      id: MANUAL_ID,
      name: "Gesamt (manuell)",
      subject: "—",
    },
  };
}

const monthSet = (b: ManualBaseline) => new Set(b.entries.map((e) => e.month));

/**
 * Merges manual Jan–Mar totals for the baseline year (from DB or file defaults) when
 * listing all students (no `studentId`). Replaces DB sessions in those months.
 */
export function mergeManualBaselineSessions<T extends SessionLike>(
  sessions: T[],
  query: MergeQuery,
  baseline: ManualBaseline
): T[] {
  if (query.studentId) return sessions;

  const yearStr = query.year;
  const hasYearParam = yearStr !== null && yearStr !== undefined && yearStr !== "";
  const baselineYear = baseline.year;
  const months = monthSet(baseline);

  if (hasYearParam) {
    if (Number(yearStr) !== baselineYear) return sessions;
  } else {
    const hasAnyBaselineYear = sessions.some((s) => s.year === baselineYear);
    if (!hasAnyBaselineYear) return sessions;
  }

  // Start by removing old synthetic rows and all baseline-month rows for baseline year.
  // Manual Q1 should act as strict month override, independent from existing real rows.
  const cleaned = sessions.filter((s) => {
    const isSynthetic =
      s.studentId === MANUAL_ID ||
      (s.notes ?? "").toLowerCase().includes("manuell: gesamteinnahmen monat");
    if (isSynthetic) return false;
    const isBaselineMonthRow = s.year === baselineYear && months.has(s.month);
    return !isBaselineMonthRow;
  }) as T[];

  let entries = [...baseline.entries];
  if (query.month) {
    const m = Number(query.month);
    if (!Number.isFinite(m) || !months.has(m)) return cleaned;
    entries = entries.filter((e) => e.month === m);
  }

  const added = entries.map((e) => syntheticSession(baseline, e.month, e.amountCHF) as T);
  const combined = [...cleaned, ...added] as T[];
  combined.sort((a, b) => b.date.getTime() - a.date.getTime());
  return combined;
}
