/**
 * Read-only Dashboard-Analysen: reine Rechenfunktionen ohne DB-Zugriff.
 * Alle Datums-/Wochengrenzen in Europe/Zurich. Es wird nichts zurückgeschrieben.
 */

import { STANDARD_RATE_PER_MIN } from "@/lib/pricing";
import { getPeriodLabel } from "@/lib/invoice-format";

// ── Eingabetypen (rohe Zeilen aus /api/analytics/dashboard) ────────────────

export type AnalyticsInvoice = {
  id: string;
  studentId: string;
  year: number;
  month: number;
  totalCHF: number;
  sentAt: string | null;
  paidAt: string | null;
  studentName: string;
};

export type AnalyticsSession = {
  id: string;
  studentId: string;
  date: string;
  durationMin: number;
  amountCHF: number;
  notes?: string | null;
};

export type AnalyticsStudent = {
  id: string;
  name: string;
  active: boolean;
  ratePerMin: number;
  billedToId: string | null;
};

export type StudentSessionExtent = {
  studentId: string;
  firstSession: string | null;
  lastSession: string | null;
  sessionCount: number;
};

// ── Zürich-Zeit-Helfer ─────────────────────────────────────────────────────

const zurichFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  weekday: "short",
});

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
};

export type ZurichParts = {
  year: number;
  month: number;
  day: number;
  /** 0–23; Intl liefert für Mitternacht "24" → auf 0 normalisiert. */
  hour: number;
  /** 0 = Montag … 6 = Sonntag */
  weekday: number;
};

export function zurichParts(date: Date): ZurichParts {
  const parts = zurichFmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hourRaw = Number(get("hour"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: hourRaw === 24 ? 0 : hourRaw,
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

/** Fortlaufende Tagesnummer des Zürcher Kalendertags (TZ-unabhängig vergleichbar). */
export function zurichDayNumber(date: Date): number {
  const p = zurichParts(date);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
}

function dayNumberToLabel(dayNumber: number): string {
  const d = new Date(dayNumber * 86_400_000);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.`;
}

// ── 1) Offene Rechnungen / Aging ───────────────────────────────────────────

/** Fälligkeit = 15. des Folgemonats (gleiche Regel wie getInvoiceDueDate), als Tagesnummer. */
export function invoiceDueDayNumber(year: number, month: number): number {
  return Math.floor(Date.UTC(year, month, 15) / 86_400_000);
}

export type AgingBucketKey = "notDue" | "d0_30" | "d31_60" | "d60plus";

export type InvoiceAgingRow = {
  invoiceId: string;
  studentName: string;
  periodLabel: string;
  totalCHF: number;
  /** Negativ = noch nicht fällig. */
  daysOverdue: number;
  bucket: AgingBucketKey;
};

export type InvoiceAging = {
  totalOutstandingCHF: number;
  buckets: Record<AgingBucketKey, { amountCHF: number; count: number }>;
  rows: InvoiceAgingRow[];
};

export function computeInvoiceAging(invoices: AnalyticsInvoice[], now: Date): InvoiceAging {
  const nowDay = zurichDayNumber(now);
  const nowP = zurichParts(now);
  const buckets: InvoiceAging["buckets"] = {
    notDue: { amountCHF: 0, count: 0 },
    d0_30: { amountCHF: 0, count: 0 },
    d31_60: { amountCHF: 0, count: 0 },
    d60plus: { amountCHF: 0, count: 0 },
  };
  const rows: InvoiceAgingRow[] = [];
  let total = 0;

  for (const inv of invoices) {
    if (!inv.sentAt || inv.paidAt) continue; // offen = gesendet, aber nicht bezahlt
    // Der laufende Monat wird erst am Monatsende fakturiert — auf Zahlung wartet
    // man nur für Vormonate (z. B. im Juli auf die Juni-Rechnungen).
    if (inv.year > nowP.year || (inv.year === nowP.year && inv.month >= nowP.month)) continue;
    const daysOverdue = nowDay - invoiceDueDayNumber(inv.year, inv.month);
    const bucket: AgingBucketKey =
      daysOverdue < 0 ? "notDue" : daysOverdue <= 30 ? "d0_30" : daysOverdue <= 60 ? "d31_60" : "d60plus";
    buckets[bucket].amountCHF += inv.totalCHF;
    buckets[bucket].count += 1;
    total += inv.totalCHF;
    rows.push({
      invoiceId: inv.id,
      studentName: inv.studentName,
      periodLabel: getPeriodLabel(inv.month, inv.year),
      totalCHF: inv.totalCHF,
      daysOverdue,
      bucket,
    });
  }

  rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return { totalOutstandingCHF: Math.round(total * 100) / 100, buckets, rows };
}

// ── 1b) Zahlungsverhalten ──────────────────────────────────────────────────

export type PayerPaymentStats = {
  name: string;
  paidCount: number;
  avgDaysToPay: number;
  /** Anteil der Zahlungen nach Fälligkeitsdatum. */
  lateShare: number;
  /** Zahlt regelmässig spät: ≥ 2 Rechnungen und ≥ 50 % davon nach Fälligkeit. */
  habituallyLate: boolean;
};

export type PaymentBehavior = {
  avgDaysToPay: number | null;
  paidInvoiceCount: number;
  payers: PayerPaymentStats[];
};

/** Rechnungen eines verknüpften Geschwisters zählen zur Familie (Hauptschüler-Name). */
export function computePaymentBehavior(
  invoices: AnalyticsInvoice[],
  students: AnalyticsStudent[]
): PaymentBehavior {
  const byId = new Map(students.map((s) => [s.id, s]));
  const payerName = (inv: AnalyticsInvoice): string => {
    const s = byId.get(inv.studentId);
    if (s?.billedToId) return byId.get(s.billedToId)?.name ?? inv.studentName;
    return s?.name ?? inv.studentName;
  };

  type Acc = { days: number[]; late: number };
  const acc = new Map<string, Acc>();
  let allDays = 0;
  let paidCount = 0;

  for (const inv of invoices) {
    if (!inv.sentAt || !inv.paidAt) continue;
    const sentDay = zurichDayNumber(new Date(inv.sentAt));
    const paidDay = zurichDayNumber(new Date(inv.paidAt));
    const days = paidDay - sentDay;
    if (days < 0) continue; // inkonsistente Daten überspringen
    // Spät = nach Fälligkeit UND mehr als 14 Tage nach Versand — sonst würden
    // spät versendete Rechnungen prompte Zahler fälschlich als Spätzahler markieren.
    const late = paidDay > Math.max(invoiceDueDayNumber(inv.year, inv.month), sentDay + 14);
    const name = payerName(inv);
    const entry = acc.get(name) ?? { days: [], late: 0 };
    entry.days.push(days);
    if (late) entry.late += 1;
    acc.set(name, entry);
    allDays += days;
    paidCount += 1;
  }

  const payers: PayerPaymentStats[] = Array.from(acc.entries())
    .map(([name, a]) => {
      const avg = a.days.reduce((s, d) => s + d, 0) / a.days.length;
      const lateShare = a.late / a.days.length;
      return {
        name,
        paidCount: a.days.length,
        avgDaysToPay: Math.round(avg * 10) / 10,
        lateShare,
        habituallyLate: a.days.length >= 2 && lateShare >= 0.5,
      };
    })
    .sort((a, b) => b.avgDaysToPay - a.avgDaysToPay);

  return {
    avgDaysToPay: paidCount > 0 ? Math.round((allDays / paidCount) * 10) / 10 : null,
    paidInvoiceCount: paidCount,
    payers,
  };
}

// ── 2) Wochenstunden & Auslastung ──────────────────────────────────────────

export type WeeklyHoursPoint = {
  weekStartDay: number;
  label: string;
  hours: number;
  isCurrent: boolean;
};

export type WeeklyHours = {
  weeks: WeeklyHoursPoint[];
  /** Ø der abgeschlossenen Wochen (aktuelle Teilwoche ausgenommen). */
  avgHours: number;
  currentWeekHours: number;
};

export function computeWeeklyHours(
  sessions: AnalyticsSession[],
  now: Date,
  weekCount = 12
): WeeklyHours {
  const nowP = zurichParts(now);
  const nowDay = zurichDayNumber(now);
  const currentWeekStart = nowDay - nowP.weekday;

  const weeks: WeeklyHoursPoint[] = [];
  for (let i = weekCount - 1; i >= 0; i--) {
    const start = currentWeekStart - i * 7;
    weeks.push({ weekStartDay: start, label: dayNumberToLabel(start), hours: 0, isCurrent: i === 0 });
  }
  const firstStart = weeks[0].weekStartDay;

  for (const s of sessions) {
    if (!s.date || !Number.isFinite(s.durationMin)) continue;
    const day = zurichDayNumber(new Date(s.date));
    if (day < firstStart || day >= currentWeekStart + 7) continue;
    const idx = Math.floor((day - firstStart) / 7);
    weeks[idx].hours += s.durationMin / 60;
  }
  for (const w of weeks) w.hours = Math.round(w.hours * 10) / 10;

  const completed = weeks.filter((w) => !w.isCurrent);
  const avg =
    completed.length > 0
      ? Math.round((completed.reduce((s, w) => s + w.hours, 0) / completed.length) * 10) / 10
      : 0;

  return { weeks, avgHours: avg, currentWeekHours: weeks[weeks.length - 1]?.hours ?? 0 };
}

export type UtilizationHeatmap = {
  /** Stunden-Slots (Startstunde der Lektion), aufsteigend. */
  hourSlots: number[];
  /** [weekday 0–6][index in hourSlots] = Summe Unterrichtsstunden. */
  cells: number[][];
  maxCellHours: number;
  totalHours: number;
};

/** Lektionen werden ihrem Start-Stundenslot zugeordnet (Zürich-Zeit). */
export function computeUtilizationHeatmap(sessions: AnalyticsSession[]): UtilizationHeatmap {
  const byDayHour = new Map<string, number>();
  let minHour = 24;
  let maxHour = -1;
  let totalHours = 0;

  for (const s of sessions) {
    if (!s.date || !Number.isFinite(s.durationMin) || s.durationMin <= 0) continue;
    const p = zurichParts(new Date(s.date));
    const key = `${p.weekday}-${p.hour}`;
    byDayHour.set(key, (byDayHour.get(key) ?? 0) + s.durationMin / 60);
    minHour = Math.min(minHour, p.hour);
    maxHour = Math.max(maxHour, p.hour);
    totalHours += s.durationMin / 60;
  }

  if (maxHour < 0) return { hourSlots: [], cells: [], maxCellHours: 0, totalHours: 0 };

  const hourSlots: number[] = [];
  for (let h = minHour; h <= maxHour; h++) hourSlots.push(h);

  const cells: number[][] = Array.from({ length: 7 }, () => hourSlots.map(() => 0));
  let maxCell = 0;
  for (const [key, hours] of Array.from(byDayHour.entries())) {
    const [wd, h] = key.split("-").map(Number);
    const col = h - minHour;
    const v = Math.round(hours * 10) / 10;
    cells[wd][col] = v;
    maxCell = Math.max(maxCell, v);
  }

  return { hourSlots, cells, maxCellHours: maxCell, totalHours: Math.round(totalHours * 10) / 10 };
}

// ── 3) Schüler-Lebenszyklus & Konzentration ────────────────────────────────

export type NewStudentsMonth = { key: string; label: string; count: number; names: string[] };

export type AtRiskStudent = {
  studentId: string;
  name: string;
  lastSession: string | null;
  daysSinceLast: number | null;
  hoursLast4Weeks: number;
  hoursPrev4Weeks: number;
  status: "risiko" | "ruecklaeufig" | "keine_lektionen";
};

export type StudentLifecycle = {
  newByMonth: NewStudentsMonth[];
  atRisk: AtRiskStudent[];
};

export function computeStudentLifecycle(args: {
  students: AnalyticsStudent[];
  extents: StudentSessionExtent[];
  recentSessions: AnalyticsSession[];
  now: Date;
  riskAfterDays?: number;
}): StudentLifecycle {
  const { students, extents, recentSessions, now } = args;
  const riskAfterDays = args.riskAfterDays ?? 21;
  const nowDay = zurichDayNumber(now);
  const nowP = zurichParts(now);
  const extentById = new Map(extents.map((e) => [e.studentId, e]));

  // Neue Schüler pro Monat (letzte 12 Monate, nach erster Lektion überhaupt)
  const monthKeys: { key: string; label: string; year: number; month: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const total = nowP.year * 12 + (nowP.month - 1) - i;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    monthKeys.push({ key: `${y}-${String(m).padStart(2, "0")}`, label: `${String(m).padStart(2, "0")}/${String(y).slice(2)}`, year: y, month: m });
  }
  const newByMonth: NewStudentsMonth[] = monthKeys.map((mk) => ({ key: mk.key, label: mk.label, count: 0, names: [] }));
  const byKey = new Map(newByMonth.map((m) => [m.key, m]));
  for (const s of students) {
    const first = extentById.get(s.id)?.firstSession;
    if (!first) continue;
    const p = zurichParts(new Date(first));
    const entry = byKey.get(`${p.year}-${String(p.month).padStart(2, "0")}`);
    if (entry) {
      entry.count += 1;
      entry.names.push(s.name);
    }
  }

  // Risiko / rückläufige Aktivität (nur aktive Schüler; Flags werden NIE verändert)
  const hoursIn = (studentId: string, fromDay: number, toDayExcl: number) =>
    recentSessions
      .filter((s) => s.studentId === studentId)
      .filter((s) => {
        const d = zurichDayNumber(new Date(s.date));
        return d >= fromDay && d < toDayExcl;
      })
      .reduce((sum, s) => sum + s.durationMin / 60, 0);

  const atRisk: AtRiskStudent[] = [];
  for (const s of students) {
    if (!s.active) continue;
    const extent = extentById.get(s.id);
    if (!extent?.lastSession) {
      atRisk.push({
        studentId: s.id,
        name: s.name,
        lastSession: null,
        daysSinceLast: null,
        hoursLast4Weeks: 0,
        hoursPrev4Weeks: 0,
        status: "keine_lektionen",
      });
      continue;
    }
    const daysSince = nowDay - zurichDayNumber(new Date(extent.lastSession));
    // Zukünftige/heutige Lektion gebucht (Kalender-Sync legt Sessions im Voraus an) → kein Risiko.
    if (daysSince <= 0) continue;
    const last4 = Math.round(hoursIn(s.id, nowDay - 28, nowDay + 1) * 10) / 10;
    const prev4 = Math.round(hoursIn(s.id, nowDay - 56, nowDay - 28) * 10) / 10;
    if (daysSince >= riskAfterDays) {
      atRisk.push({
        studentId: s.id,
        name: s.name,
        lastSession: extent.lastSession,
        daysSinceLast: daysSince,
        hoursLast4Weeks: last4,
        hoursPrev4Weeks: prev4,
        status: "risiko",
      });
    } else if (prev4 >= 2 && last4 <= prev4 * 0.5) {
      atRisk.push({
        studentId: s.id,
        name: s.name,
        lastSession: extent.lastSession,
        daysSinceLast: daysSince,
        hoursLast4Weeks: last4,
        hoursPrev4Weeks: prev4,
        status: "ruecklaeufig",
      });
    }
  }
  atRisk.sort((a, b) => (b.daysSinceLast ?? Infinity) === (a.daysSinceLast ?? Infinity)
    ? a.name.localeCompare(b.name, "de-CH")
    : (b.daysSinceLast ?? Number.MAX_SAFE_INTEGER) - (a.daysSinceLast ?? Number.MAX_SAFE_INTEGER));

  return { newByMonth, atRisk };
}

export type RevenueConcentration = {
  totalCHF: number;
  top1Share: number | null;
  top5Share: number | null;
  /** Alle Schüler, absteigend nach Umsatz. */
  ranked: { name: string; incomeCHF: number; share: number }[];
};

export function computeRevenueConcentration(
  sessions: AnalyticsSession[],
  students: AnalyticsStudent[]
): RevenueConcentration {
  const nameById = new Map(students.map((s) => [s.id, s.name]));
  const byStudent = new Map<string, number>();
  let total = 0;
  for (const s of sessions) {
    const name = nameById.get(s.studentId) ?? "Unbekannt";
    byStudent.set(name, (byStudent.get(name) ?? 0) + s.amountCHF);
    total += s.amountCHF;
  }
  const ranked = Array.from(byStudent.entries())
    .map(([name, incomeCHF]) => ({
      name,
      incomeCHF: Math.round(incomeCHF * 100) / 100,
      share: total > 0 ? incomeCHF / total : 0,
    }))
    .sort((a, b) => b.incomeCHF - a.incomeCHF);

  return {
    totalCHF: Math.round(total * 100) / 100,
    top1Share: total > 0 && ranked.length > 0 ? ranked[0].share : null,
    top5Share: total > 0 ? ranked.slice(0, 5).reduce((s, r) => s + r.share, 0) : null,
    ranked,
  };
}

// ── 4) Effektiver Stundensatz ──────────────────────────────────────────────

export const STANDARD_HOURLY_CHF = Math.round(STANDARD_RATE_PER_MIN * 60 * 100) / 100;

export type EffectiveRateRow = {
  studentId: string;
  name: string;
  revenueCHF: number;
  hours: number;
  effectiveHourlyCHF: number;
  /** Aktueller Tarif als CHF/h (ratePerMin × 60) — nur Anzeige, wird nicht verändert. */
  currentTariffHourlyCHF: number;
  diffVsStandardCHF: number;
  /** Deutlich unter Standardsatz (> 10 % darunter). */
  belowStandard: boolean;
};

export function computeEffectiveRates(
  sessions: AnalyticsSession[],
  students: AnalyticsStudent[]
): EffectiveRateRow[] {
  const acc = new Map<string, { revenue: number; minutes: number }>();
  for (const s of sessions) {
    if (!Number.isFinite(s.durationMin) || s.durationMin <= 0) continue;
    const entry = acc.get(s.studentId) ?? { revenue: 0, minutes: 0 };
    entry.revenue += s.amountCHF;
    entry.minutes += s.durationMin;
    acc.set(s.studentId, entry);
  }

  const rows: EffectiveRateRow[] = [];
  for (const student of students) {
    if (!student.active) continue;
    const a = acc.get(student.id);
    if (!a || a.minutes <= 0) continue;
    const hours = a.minutes / 60;
    const eff = a.revenue / hours;
    rows.push({
      studentId: student.id,
      name: student.name,
      revenueCHF: Math.round(a.revenue * 100) / 100,
      hours: Math.round(hours * 10) / 10,
      effectiveHourlyCHF: Math.round(eff * 100) / 100,
      currentTariffHourlyCHF: Math.round(student.ratePerMin * 60 * 100) / 100,
      diffVsStandardCHF: Math.round((eff - STANDARD_HOURLY_CHF) * 100) / 100,
      belowStandard: eff < STANDARD_HOURLY_CHF * 0.9,
    });
  }
  rows.sort((a, b) => a.effectiveHourlyCHF - b.effectiveHourlyCHF);
  return rows;
}

// ── 5) Monatsbilanz ────────────────────────────────────────────────────────

export type MonthStatus = {
  /** Einkommen des laufenden Monats — enthält bereits geplante Lektionen (Kalender-Sync). */
  monthIncomeCHF: number;
  /** Ø der abgeschlossenen Monate dieses Jahres; null im Januar. */
  avgCompletedMonthCHF: number | null;
  diffVsAvgCHF: number | null;
  /** Zielerreichung in % (Monatseinkommen ÷ Ziel); null ohne gesetztes Ziel. */
  goalPct: number | null;
};

/**
 * Keine Hochrechnung: der Kalender-Sync legt Lektionen im Voraus an, das
 * Monatseinkommen ist also bereits der geplante Monatswert. Verglichen wird
 * direkt mit dem Ø der abgeschlossenen Monate und dem optionalen Ziel.
 */
export function computeMonthStatus(args: {
  mtdIncomeCHF: number;
  ytdIncomeCHF: number;
  now: Date;
  goalCHF?: number | null;
}): MonthStatus {
  const p = zurichParts(args.now);
  const completedMonths = p.month - 1;
  const avg =
    completedMonths > 0
      ? Math.round(((args.ytdIncomeCHF - args.mtdIncomeCHF) / completedMonths) * 100) / 100
      : null;
  const goal = args.goalCHF ?? null;
  return {
    monthIncomeCHF: Math.round(args.mtdIncomeCHF * 100) / 100,
    avgCompletedMonthCHF: avg,
    diffVsAvgCHF: avg !== null ? Math.round((args.mtdIncomeCHF - avg) * 100) / 100 : null,
    goalPct: goal && goal > 0 ? Math.round((args.mtdIncomeCHF / goal) * 100) : null,
  };
}

// ── 6) Vorjahresvergleich: Datenlage & Serie ───────────────────────────────

/** Lektionsumsatz pro Kalendermonat (aggregiert über alle Jahre in der DB). */
export type MonthCoverage = {
  year: number;
  month: number;
  sessionCount: number;
  amountCHF: number;
};

export type YoyAvailability = {
  available: boolean;
  prevYear: number;
  monthsWithData: number;
  message: string;
};

/** Fairer Vergleich nur, wenn das Vorjahr in fast allen Monaten Lektionsdaten hat. */
export function assessYoyAvailability(
  coverage: MonthCoverage[],
  chartYear: number,
  minMonths = 10
): YoyAvailability {
  const prevYear = chartYear - 1;
  const monthsWithData = new Set(
    coverage.filter((c) => c.year === prevYear && c.sessionCount > 0).map((c) => c.month)
  ).size;
  const available = monthsWithData >= minMonths;
  return {
    available,
    prevYear,
    monthsWithData,
    message: available
      ? ""
      : `Für ${prevYear} gibt es nur in ${monthsWithData} von 12 Monaten Lektionsdaten — zu wenig für einen aussagekräftigen Vorjahresvergleich.`,
  };
}

export type YoyMonthPoint = {
  month: number;
  label: string;
  currentCHF: number;
  previousCHF: number;
};

/** Lektionsumsatz je Monat: Chart-Jahr vs. Vorjahr (nur Lektionen, keine Abos/Zusätze). */
export function buildYoyMonthlySeries(coverage: MonthCoverage[], chartYear: number): YoyMonthPoint[] {
  const get = (y: number, m: number) =>
    coverage
      .filter((c) => c.year === y && c.month === m)
      .reduce((s, c) => s + c.amountCHF, 0);
  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    return {
      month: m,
      label: String(m).padStart(2, "0"),
      currentCHF: Math.round(get(chartYear, m) * 100) / 100,
      previousCHF: Math.round(get(chartYear - 1, m) * 100) / 100,
    };
  });
}
