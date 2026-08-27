import { describe, expect, it } from "vitest";
import {
  assessYoyAvailability,
  averageMonthlyIncome,
  buildYoyMonthlySeries,
  computeEffectiveRates,
  computeInvoiceAging,
  computeMonthStatus,
  computePaymentBehavior,
  computeRevenueConcentration,
  computeStudentLifecycle,
  computeUtilizationHeatmap,
  computeWeeklyHours,
  STANDARD_HOURLY_CHF,
  zurichDayNumber,
  zurichParts,
  type AnalyticsInvoice,
  type AnalyticsSession,
  type AnalyticsStudent,
} from "./dashboard-analytics";

// Sonntag, 12.07.2026, 12:00 Zürich (Sommerzeit UTC+2)
const NOW = new Date("2026-07-12T10:00:00Z");

const student = (over: Partial<AnalyticsStudent> & { id: string; name: string }): AnalyticsStudent => ({
  active: true,
  ratePerMin: 1.2,
  billedToId: null,
  ...over,
});

const invoice = (over: Partial<AnalyticsInvoice> & { id: string }): AnalyticsInvoice => ({
  studentId: "s1",
  year: 2026,
  month: 5,
  totalCHF: 100,
  invoiceNumber: "2026-0001",
  sentAt: null,
  paidAt: null,
  reminderStage: 0,
  pdfPath: null,
  studentName: "Juri",
  ...over,
});

const session = (over: Partial<AnalyticsSession> & { id: string }): AnalyticsSession => ({
  studentId: "s1",
  date: "2026-07-06T08:00:00Z",
  durationMin: 60,
  amountCHF: 72,
  ...over,
});

describe("zurichParts / zurichDayNumber", () => {
  it("rollt über Mitternacht in die Zürcher Zeitzone (Sommerzeit)", () => {
    // 22:30 UTC am 11.07. = 00:30 am 12.07. in Zürich (Sonntag)
    const p = zurichParts(new Date("2026-07-11T22:30:00Z"));
    expect(p).toMatchObject({ year: 2026, month: 7, day: 12, hour: 0, weekday: 6 });
  });

  it("Winterzeit: UTC+1", () => {
    // 23:30 UTC am 10.01. = 00:30 am 11.01. in Zürich (Sonntag)
    const p = zurichParts(new Date("2026-01-10T23:30:00Z"));
    expect(p).toMatchObject({ year: 2026, month: 1, day: 11, weekday: 6 });
  });

  it("Tagesnummern differieren korrekt", () => {
    const a = zurichDayNumber(new Date("2026-07-12T10:00:00Z"));
    const b = zurichDayNumber(new Date("2026-07-10T10:00:00Z"));
    expect(a - b).toBe(2);
  });
});

describe("computeInvoiceAging", () => {
  it("teilt offene Rechnungen in Fälligkeits-Buckets", () => {
    const invoices: AnalyticsInvoice[] = [
      // Mai-Rechnung: fällig 15.06. → 27 Tage überfällig → 0–30
      invoice({ id: "a", month: 5, totalCHF: 200, sentAt: "2026-06-01T10:00:00Z" }),
      // April: fällig 15.05. → 58 Tage → 31–60
      invoice({ id: "b", month: 4, totalCHF: 300, sentAt: "2026-05-01T10:00:00Z" }),
      // März: fällig 15.04. → 88 Tage → >60
      invoice({ id: "c", month: 3, totalCHF: 400, sentAt: "2026-04-01T10:00:00Z" }),
      // Juni: fällig 15.07. → noch nicht fällig
      invoice({ id: "d", month: 6, totalCHF: 500, sentAt: "2026-07-01T10:00:00Z" }),
      // bezahlt → zählt nicht
      invoice({ id: "e", month: 5, totalCHF: 999, sentAt: "2026-06-01T10:00:00Z", paidAt: "2026-06-20T10:00:00Z" }),
      // nie gesendet (Entwurf) → zählt nicht
      invoice({ id: "f", month: 5, totalCHF: 999 }),
      // laufender Monat (Juli) → wird erst am Monatsende fakturiert, zählt nicht
      invoice({ id: "g", month: 7, totalCHF: 999, sentAt: "2026-07-05T10:00:00Z" }),
    ];
    const aging = computeInvoiceAging(invoices, NOW);
    expect(aging.totalOutstandingCHF).toBe(1400);
    expect(aging.buckets.d0_30).toEqual({ amountCHF: 200, count: 1 });
    expect(aging.buckets.d31_60).toEqual({ amountCHF: 300, count: 1 });
    expect(aging.buckets.d60plus).toEqual({ amountCHF: 400, count: 1 });
    expect(aging.buckets.notDue).toEqual({ amountCHF: 500, count: 1 });
    // sortiert: am längsten überfällig zuerst
    expect(aging.rows.map((r) => r.invoiceId)).toEqual(["c", "b", "a", "d"]);
    expect(aging.rows[0].daysOverdue).toBe(88);
    expect(aging.rows[2].daysOverdue).toBe(27);
    expect(aging.rows[3].daysOverdue).toBeLessThan(0);
    // Perioden-/Nummern-Felder für die Mahnungs-Tokens durchgereicht (März-Rechnung zuerst)
    expect(aging.rows[0]).toMatchObject({ invoiceId: "c", invoiceNumber: "2026-0001", year: 2026, month: 3 });
  });

  it("leer bei keinen offenen Rechnungen", () => {
    const aging = computeInvoiceAging([], NOW);
    expect(aging.totalOutstandingCHF).toBe(0);
    expect(aging.rows).toEqual([]);
  });
});

describe("computePaymentBehavior", () => {
  it("berechnet Ø Zahlungsdauer und markiert notorische Spätzahler", () => {
    const invoices: AnalyticsInvoice[] = [
      // 10 Tage, vor Fälligkeit (Mai-Rechnung, fällig 15.06.)
      invoice({ id: "a", month: 5, sentAt: "2026-06-01T10:00:00Z", paidAt: "2026-06-11T10:00:00Z" }),
      // Februar-Rechnung, fällig 15.03., bezahlt 01.05. → 61 Tage, spät
      invoice({ id: "b", month: 2, sentAt: "2026-03-01T10:00:00Z", paidAt: "2026-05-01T10:00:00Z" }),
    ];
    const behavior = computePaymentBehavior(invoices, [student({ id: "s1", name: "Juri" })]);
    expect(behavior.paidInvoiceCount).toBe(2);
    expect(behavior.avgDaysToPay).toBe(35.5);
    expect(behavior.payers).toHaveLength(1);
    expect(behavior.payers[0]).toMatchObject({ name: "Juri", paidCount: 2, habituallyLate: true });
  });

  it("spät versendete, aber prompt bezahlte Rechnung zählt nicht als Spätzahlung", () => {
    // Mai-Rechnung (fällig 15.06.) erst am 20.06. versendet, in 5 Tagen bezahlt
    const invoices: AnalyticsInvoice[] = [
      invoice({ id: "a", month: 5, sentAt: "2026-06-20T10:00:00Z", paidAt: "2026-06-25T10:00:00Z" }),
      invoice({ id: "b", month: 4, sentAt: "2026-05-20T10:00:00Z", paidAt: "2026-05-24T10:00:00Z" }),
    ];
    const behavior = computePaymentBehavior(invoices, [student({ id: "s1", name: "Juri" })]);
    expect(behavior.payers[0].lateShare).toBe(0);
    expect(behavior.payers[0].habituallyLate).toBe(false);
  });

  it("gruppiert Geschwister-Rechnungen unter dem Hauptschüler", () => {
    const students = [
      student({ id: "p", name: "Juri" }),
      student({ id: "c", name: "Anton", billedToId: "p" }),
    ];
    const invoices: AnalyticsInvoice[] = [
      invoice({ id: "a", studentId: "c", studentName: "Anton", month: 5, sentAt: "2026-06-01T10:00:00Z", paidAt: "2026-06-05T10:00:00Z" }),
    ];
    const behavior = computePaymentBehavior(invoices, students);
    expect(behavior.payers[0].name).toBe("Juri");
  });
});

describe("computeWeeklyHours", () => {
  it("bucketiert Lektionen in Zürcher Wochen (Mo–So)", () => {
    const sessions: AnalyticsSession[] = [
      // Montag 06.07. 10:00 Zürich, 120min → aktuelle Woche
      session({ id: "a", date: "2026-07-06T08:00:00Z", durationMin: 120 }),
      // Sonntag 05.07. → Vorwoche
      session({ id: "b", date: "2026-07-05T08:00:00Z", durationMin: 60 }),
      // weit ausserhalb des Fensters
      session({ id: "c", date: "2026-01-05T08:00:00Z", durationMin: 60 }),
    ];
    const wh = computeWeeklyHours(sessions, NOW, 12);
    expect(wh.weeks).toHaveLength(12);
    expect(wh.currentWeekHours).toBe(2);
    expect(wh.weeks[10].hours).toBe(1);
    // Ø über die 11 abgeschlossenen Wochen (nur 1h in einer Woche)
    expect(wh.avgHours).toBe(0.1);
    expect(wh.weeks[11].isCurrent).toBe(true);
  });

  it("Sonntagslektion 00:30 Zürich zählt zur richtigen Woche", () => {
    // 22:30 UTC Sa = 00:30 So Zürich → gehört noch zur laufenden Woche (Mo 06.07.)
    const wh = computeWeeklyHours(
      [session({ id: "a", date: "2026-07-11T22:30:00Z", durationMin: 60 })],
      NOW,
      2
    );
    expect(wh.currentWeekHours).toBe(1);
  });
});

describe("computeUtilizationHeatmap", () => {
  it("summiert Stunden pro Wochentag × Startstunde", () => {
    const sessions: AnalyticsSession[] = [
      // Dienstag 14:00 Zürich (12:00 UTC im Sommer), zweimal
      session({ id: "a", date: "2026-07-07T12:00:00Z", durationMin: 60 }),
      session({ id: "b", date: "2026-06-30T12:00:00Z", durationMin: 60 }),
      // Mittwoch 16:30 Zürich, 90min
      session({ id: "c", date: "2026-07-08T14:30:00Z", durationMin: 90 }),
      // ungültige Dauer wird ignoriert
      session({ id: "d", date: "2026-07-08T14:30:00Z", durationMin: 0 }),
    ];
    const hm = computeUtilizationHeatmap(sessions);
    expect(hm.hourSlots).toEqual([14, 15, 16]);
    expect(hm.cells[1][0]).toBe(2); // Di 14h
    expect(hm.cells[2][2]).toBe(1.5); // Mi 16h
    expect(hm.maxCellHours).toBe(2);
    expect(hm.totalHours).toBe(3.5);
  });

  it("leere Eingabe → leeres Raster", () => {
    expect(computeUtilizationHeatmap([])).toEqual({ hourSlots: [], cells: [], maxCellHours: 0, totalHours: 0 });
  });
});

describe("computeStudentLifecycle", () => {
  const students = [
    student({ id: "ok", name: "Aktiv Regelmässig" }),
    student({ id: "risk", name: "Lange Weg" }),
    student({ id: "none", name: "Nie Da" }),
    student({ id: "gone", name: "Inaktiv", active: false }),
    student({ id: "decl", name: "Rückläufig" }),
    student({ id: "future", name: "Ferien Mit Buchung" }),
  ];
  const extents = [
    { studentId: "ok", firstSession: "2026-07-01T08:00:00Z", lastSession: "2026-07-10T08:00:00Z", sessionCount: 5 },
    { studentId: "risk", firstSession: "2026-02-01T08:00:00Z", lastSession: "2026-06-01T08:00:00Z", sessionCount: 9 },
    { studentId: "gone", firstSession: "2025-01-01T08:00:00Z", lastSession: "2025-06-01T08:00:00Z", sessionCount: 3 },
    { studentId: "decl", firstSession: "2026-03-01T08:00:00Z", lastSession: "2026-07-08T08:00:00Z", sessionCount: 12 },
    // Zukünftige Lektion bereits im Kalender → nie als Risiko melden
    { studentId: "future", firstSession: "2026-01-01T08:00:00Z", lastSession: "2026-07-29T08:00:00Z", sessionCount: 20 },
  ];
  const recentSessions: AnalyticsSession[] = [
    // "ok": stabil in beiden 4-Wochen-Fenstern
    session({ id: "o1", studentId: "ok", date: "2026-07-10T08:00:00Z", durationMin: 120 }),
    session({ id: "o2", studentId: "ok", date: "2026-06-20T08:00:00Z", durationMin: 120 }),
    // "decl": 4h im Vorfenster, 1h zuletzt
    session({ id: "d1", studentId: "decl", date: "2026-07-08T08:00:00Z", durationMin: 60 }),
    session({ id: "d2", studentId: "decl", date: "2026-05-20T08:00:00Z", durationMin: 240 }),
  ];

  it("meldet Risiko-, rückläufige und lektionslose Schüler — inaktive nie", () => {
    const lc = computeStudentLifecycle({ students, extents, recentSessions, now: NOW });
    const byId = new Map(lc.atRisk.map((r) => [r.studentId, r]));
    expect(byId.get("risk")).toMatchObject({ status: "risiko", daysSinceLast: 41 });
    expect(byId.get("none")).toMatchObject({ status: "keine_lektionen", daysSinceLast: null });
    expect(byId.get("decl")).toMatchObject({ status: "ruecklaeufig", hoursLast4Weeks: 1, hoursPrev4Weeks: 4 });
    expect(byId.has("ok")).toBe(false);
    expect(byId.has("gone")).toBe(false);
    expect(byId.has("future")).toBe(false);
  });

  it("zählt neue Schüler nach Monat der ersten Lektion", () => {
    const lc = computeStudentLifecycle({ students, extents, recentSessions, now: NOW });
    const feb = lc.newByMonth.find((m) => m.key === "2026-02");
    const jul = lc.newByMonth.find((m) => m.key === "2026-07");
    expect(feb?.count).toBe(1);
    expect(feb?.names).toEqual(["Lange Weg"]);
    expect(jul?.count).toBe(1);
    expect(lc.newByMonth).toHaveLength(12);
  });
});

describe("computeRevenueConcentration", () => {
  it("berechnet Top-1- und Top-5-Anteile", () => {
    const students = [
      student({ id: "a", name: "A" }),
      student({ id: "b", name: "B" }),
      student({ id: "c", name: "C" }),
    ];
    const sessions = [
      session({ id: "1", studentId: "a", amountCHF: 500 }),
      session({ id: "2", studentId: "b", amountCHF: 300 }),
      session({ id: "3", studentId: "c", amountCHF: 200 }),
    ];
    const rc = computeRevenueConcentration(sessions, students);
    expect(rc.totalCHF).toBe(1000);
    expect(rc.top1Share).toBeCloseTo(0.5);
    expect(rc.top5Share).toBeCloseTo(1);
    // vollständige Rangliste aller Schüler
    expect(rc.ranked.map((r) => r.name)).toEqual(["A", "B", "C"]);
    expect(rc.ranked[0]).toMatchObject({ name: "A", incomeCHF: 500 });
  });

  it("null-Anteile ohne Umsatz", () => {
    const rc = computeRevenueConcentration([], []);
    expect(rc.top1Share).toBeNull();
    expect(rc.top5Share).toBeNull();
  });
});

describe("computeEffectiveRates", () => {
  it("Umsatz ÷ Stunden, Warnung deutlich unter Standardsatz", () => {
    const students = [
      student({ id: "std", name: "Standard", ratePerMin: 1.2 }),
      student({ id: "low", name: "Alt-Tarif", ratePerMin: 0.9 }),
      student({ id: "idle", name: "Ohne Lektionen" }),
      student({ id: "off", name: "Inaktiv", active: false }),
    ];
    const sessions = [
      session({ id: "1", studentId: "std", durationMin: 100, amountCHF: 120 }),
      session({ id: "2", studentId: "low", durationMin: 60, amountCHF: 50 }),
      session({ id: "3", studentId: "off", durationMin: 60, amountCHF: 60 }),
      // Dauer 0 wird sicher ignoriert
      session({ id: "4", studentId: "std", durationMin: 0, amountCHF: 999 }),
    ];
    const rows = computeEffectiveRates(sessions, students);
    expect(rows.map((r) => r.studentId)).toEqual(["low", "std"]); // schlechtester zuerst
    const low = rows[0];
    expect(low.effectiveHourlyCHF).toBe(50);
    expect(low.belowStandard).toBe(true);
    const std = rows[1];
    expect(std.effectiveHourlyCHF).toBe(72);
    expect(std.belowStandard).toBe(false);
    expect(std.diffVsStandardCHF).toBe(0);
    expect(STANDARD_HOURLY_CHF).toBe(72);
  });
});

describe("computeMonthStatus", () => {
  it("vergleicht den (bereits geplanten) Monatswert mit dem Ø der abgeschlossenen Monate", () => {
    const s = computeMonthStatus({ mtdIncomeCHF: 5300, ytdIncomeCHF: 41300, now: NOW, goalCHF: 5000 });
    // Juli: 6 abgeschlossene Monate → Ø (41300 − 5300) / 6 = 6000
    expect(s.monthIncomeCHF).toBe(5300);
    expect(s.avgCompletedMonthCHF).toBe(6000);
    expect(s.diffVsAvgCHF).toBe(-700);
    expect(s.goalPct).toBe(106);
  });

  it("ohne Ziel kein goalPct, im Januar kein Ø", () => {
    const s = computeMonthStatus({
      mtdIncomeCHF: 500,
      ytdIncomeCHF: 500,
      now: new Date("2026-01-10T12:00:00Z"),
    });
    expect(s.avgCompletedMonthCHF).toBeNull();
    expect(s.diffVsAvgCHF).toBeNull();
    expect(s.goalPct).toBeNull();
  });
});

describe("assessYoyAvailability / buildYoyMonthlySeries", () => {
  const cov = (year: number, month: number, amountCHF = 100) => ({ year, month, sessionCount: 5, amountCHF });

  it("kein Vergleich bei lückenhaftem Vorjahr", () => {
    // 2025 hat nur 2 Monate mit Daten
    const yoy = assessYoyAvailability([cov(2025, 4), cov(2025, 12), cov(2026, 1)], 2026);
    expect(yoy.available).toBe(false);
    expect(yoy.monthsWithData).toBe(2);
    expect(yoy.message).toContain("2025");
    expect(yoy.message).toContain("2 von 12");
  });

  it("verfügbar ab 10 Monaten Vorjahresdaten", () => {
    const coverage = Array.from({ length: 10 }, (_, i) => cov(2026, i + 1));
    expect(assessYoyAvailability(coverage, 2027).available).toBe(true);
    expect(assessYoyAvailability(coverage.slice(0, 9), 2027).available).toBe(false);
  });

  it("keine Daten → nicht verfügbar", () => {
    expect(assessYoyAvailability([], 2026).available).toBe(false);
  });

  it("baut 12 Monatspunkte mit beiden Jahren", () => {
    const series = buildYoyMonthlySeries([cov(2026, 3, 400), cov(2027, 3, 500)], 2027);
    expect(series).toHaveLength(12);
    expect(series[2]).toMatchObject({ month: 3, currentCHF: 500, previousCHF: 400 });
    expect(series[0]).toMatchObject({ month: 1, currentCHF: 0, previousCHF: 0 });
  });
});

/**
 * Regression: der Monatsdurchschnitt der Jahresuebersicht war zu hoch.
 *
 * Der Zaehler summierte alle zwoelf Monatspunkte, der Nenner zaehlte nur die
 * bereits vergangenen Monate. Der Kalender-Sync legt Lektionen im Voraus an und
 * ein 6-Monats-Abo verteilt sich ebenfalls in die Zukunft — beides floss in den
 * Zaehler, ohne je im Nenner aufzutauchen.
 */
describe("averageMonthlyIncome", () => {
  const punkte = (werte: number[]) =>
    werte.map((income, i) => ({ month: i + 1, income }));

  it("laufendes Jahr: Einkommen kuenftiger Monate zaehlt nicht mit", () => {
    // August (monthCount 8): Jan–Aug je 1000, Sep–Dez je 5000 geplant.
    const data = punkte([1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 5000, 5000, 5000, 5000]);
    expect(averageMonthlyIncome(data, 8)).toBe(1000);
    // Die alte Rechnung: (8*1000 + 4*5000) / 8 = 3500 — dreieinhalbmal zu hoch.
    expect(data.reduce((s, d) => s + d.income, 0) / 8).toBe(3500);
  });

  it("laufendes Jahr ohne Zukunftseinkommen: unveraendertes Ergebnis", () => {
    const data = punkte([1200, 800, 1000, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(averageMonthlyIncome(data, 3)).toBe(1000);
  });

  it("ein einzelnes kuenftiges Abo hebt den Durchschnitt nicht mehr an", () => {
    const ohneAbo = punkte([900, 900, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const mitKuenftigemAbo = punkte([900, 900, 0, 0, 60, 60, 60, 60, 60, 60, 0, 0]);
    expect(averageMonthlyIncome(mitKuenftigemAbo, 2)).toBe(averageMonthlyIncome(ohneAbo, 2));
    expect(averageMonthlyIncome(mitKuenftigemAbo, 2)).toBe(900);
  });

  it("abgeschlossenes Jahr: alle zwoelf Monate", () => {
    const data = punkte(Array.from({ length: 12 }, () => 600));
    expect(averageMonthlyIncome(data, 12)).toBe(600);
  });

  it("abgeschlossenes Jahr mit Luecken rechnet die Nullmonate mit", () => {
    const data = punkte([1200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(averageMonthlyIncome(data, 12)).toBe(100);
  });

  it("Januar des laufenden Jahres: nur der Januar", () => {
    const data = punkte([500, 4000, 4000, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(averageMonthlyIncome(data, 1)).toBe(500);
  });

  it("Zukunftsjahr (monthCount 0): kein Durchschnitt, keine Division durch 0", () => {
    const data = punkte([3000, 3000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(averageMonthlyIncome(data, 0)).toBe(0);
    expect(averageMonthlyIncome(data, -3)).toBe(0);
    expect(averageMonthlyIncome(data, NaN)).toBe(0);
  });

  it("leere Datenreihe ergibt 0", () => {
    expect(averageMonthlyIncome([], 8)).toBe(0);
  });
});

/**
 * Konsistenzfix: die beiden 4-Wochen-Fenster waren unterschiedlich lang.
 *
 * "Letzte 4 Wochen" lief ueber [nowDay-28, nowDay] und damit ueber 29 Tage,
 * das Vergleichsfenster ueber 28. Der Vergleich hinkte um einen Tag — eine
 * Lektion genau am Rand landete im juengeren Fenster und liess "rückläufig"
 * seltener anschlagen, als der Vergleich es hergab. Beide Fenster sind jetzt 28 Tage.
 */
describe("computeStudentLifecycle — 4-Wochen-Fenster", () => {
  const NOW_DAY = zurichDayNumber(NOW);
  const dayIso = (offset: number) => new Date((NOW_DAY + offset) * 86_400_000 + 10 * 3_600_000).toISOString();

  /** Lektion an einem Tag relativ zu heute, vormittags (Zuercher Kalendertag stabil). */
  const atOffset = (id: string, offsetDays: number, durationMin: number): AnalyticsSession => ({
    id,
    studentId: "s1",
    date: dayIso(offsetDays),
    durationMin,
    amountCHF: 0,
  });

  /**
   * Letzte Lektion vor 25 Tagen: der Schueler steht damit sicher als "risiko" in
   * der Liste, egal was in den beiden Fenstern liegt. Nur so lassen sich die
   * gemeldeten Stundenwerte ueberhaupt ablesen — atRisk enthaelt sonst nur
   * auffaellige Schueler, und die Fenstergrenzen blieben unpruefbar.
   */
  const hoursFor = (sessions: AnalyticsSession[]) => {
    const row = computeStudentLifecycle({
      students: [student({ id: "s1", name: "Grenzfall" })],
      extents: [
        { studentId: "s1", firstSession: dayIso(-200), lastSession: dayIso(-25), sessionCount: 10 },
      ],
      recentSessions: sessions,
      now: NOW,
    }).atRisk.find((r) => r.studentId === "s1");
    expect(row?.status).toBe("risiko");
    return { last4: row?.hoursLast4Weeks, prev4: row?.hoursPrev4Weeks };
  };

  it("beide Fenster umfassen genau 28 Tage", () => {
    // Randtage: -27 ist der aelteste Tag des juengsten Fensters, -55 der aelteste
    // des Vorfensters. Je 4h ergibt in beiden Fenstern denselben Wert.
    expect(hoursFor([atOffset("a", -27, 240), atOffset("b", -55, 240)])).toEqual({
      last4: 4,
      prev4: 4,
    });
  });

  it("heute zaehlt zum juengsten Fenster", () => {
    expect(hoursFor([atOffset("a", 0, 120)])).toEqual({ last4: 2, prev4: 0 });
  });

  it("Tag -28 gehoert zum Vorfenster, nicht mehr zum juengsten", () => {
    // Vorher lief last4 bis -28 einschliesslich und war damit 29 Tage lang;
    // dieser Tag fiel in beide Fenster-Definitionen zugleich.
    expect(hoursFor([atOffset("a", -28, 120)])).toEqual({ last4: 0, prev4: 2 });
  });

  it("Tag -56 liegt ausserhalb beider Fenster", () => {
    expect(hoursFor([atOffset("a", -56, 120)])).toEqual({ last4: 0, prev4: 0 });
  });

  it("die Fenster stossen lueckenlos aneinander", () => {
    // 28 Tage juengstes Fenster (-27..0) + 28 Tage Vorfenster (-55..-28): jede
    // Lektion in diesen 56 Tagen landet in genau einem der beiden.
    const jederTag = Array.from({ length: 56 }, (_, i) => atOffset(`t${i}`, -i, 60));
    const { last4, prev4 } = hoursFor(jederTag);
    expect(last4).toBe(28);
    expect(prev4).toBe(28);
  });

  it("halbierte Aktivitaet wird als rückläufig erkannt", () => {
    const row = computeStudentLifecycle({
      students: [student({ id: "s1", name: "Rückläufig" })],
      extents: [
        { studentId: "s1", firstSession: dayIso(-200), lastSession: dayIso(-3), sessionCount: 10 },
      ],
      recentSessions: [atOffset("a", -3, 60), atOffset("b", -40, 240)],
      now: NOW,
    }).atRisk.find((r) => r.studentId === "s1");
    expect(row).toMatchObject({ status: "ruecklaeufig", hoursLast4Weeks: 1, hoursPrev4Weeks: 4 });
  });

  it("gleichbleibende Aktivitaet ist kein Befund", () => {
    const lc = computeStudentLifecycle({
      students: [student({ id: "s1", name: "Stabil" })],
      extents: [
        { studentId: "s1", firstSession: dayIso(-200), lastSession: dayIso(-3), sessionCount: 10 },
      ],
      recentSessions: [atOffset("a", -3, 240), atOffset("b", -40, 240)],
      now: NOW,
    });
    expect(lc.atRisk.find((r) => r.studentId === "s1")).toBeUndefined();
  });
});
