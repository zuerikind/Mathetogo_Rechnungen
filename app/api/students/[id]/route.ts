import { NextRequest, NextResponse } from "next/server";
import { affectedInvoiceMonths, billingScopeStudentIds } from "@/lib/billing-scope";
import { checkTariffEffectiveDate, earliestTariffDate } from "@/lib/delivered-freeze";
import { clearIncomeSummaryCache } from "@/lib/income-summary-cache";
import { DELIVERED_INVOICE_WHERE } from "@/lib/invoice-delivery";
import { zurichYearMonth } from "@/lib/month-math";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

const roundCents = (n: number) => Math.round(n * 100) / 100;

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({ where: { id: params.id } });
  if (!student) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(student);
}

/** Was eine Tarifaenderung konkret bewirkt — wird vor dem Speichern gezeigt. */
export type TariffPreview = {
  oldRate: number;
  newRate: number;
  effectiveFrom: string;
  lessonCount: number;
  beforeCHF: number;
  afterCHF: number;
  months: { year: number; month: number; lessonCount: number; beforeCHF: number; afterCHF: number }[];
  /** Monate im Umfang, deren Rechnung schon raus ist (nur Vormonat/laufender Monat moeglich). */
  billedMonths: { year: number; month: number }[];
};

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, subject, ratePerMin, email, active } = body;
  // undefined = nicht ändern; "" oder null = Verknüpfung lösen; string = neuer Rechnungsempfänger.
  const billedToId =
    body.billedToId === undefined ? undefined : body.billedToId ? String(body.billedToId) : null;

  const existing = await prisma.student.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (billedToId) {
    if (billedToId === params.id) {
      return NextResponse.json(
        { error: "Ein Schüler kann nicht über sich selbst abgerechnet werden." },
        { status: 400 }
      );
    }
    const target = await prisma.student.findUnique({
      where: { id: billedToId },
      select: { billedToId: true },
    });
    if (!target) {
      return NextResponse.json({ error: "Rechnungsempfänger nicht gefunden." }, { status: 400 });
    }
    if (target.billedToId) {
      return NextResponse.json(
        { error: "Der gewählte Schüler wird selbst über eine Familienrechnung abgerechnet." },
        { status: 400 }
      );
    }
    const hasChildren = await prisma.student.count({ where: { billedToId: params.id } });
    if (hasChildren > 0) {
      return NextResponse.json(
        { error: "Dieser Schüler ist bereits Rechnungsempfänger für andere Schüler." },
        { status: 400 }
      );
    }
  }

  const nextRate = ratePerMin !== undefined ? Number(ratePerMin) : existing.ratePerMin;
  const rateChanged = ratePerMin !== undefined && Number(ratePerMin) !== existing.ratePerMin;

  // ── Tarifaenderung ─────────────────────────────────────────────────────────
  //
  // Sie wirkt hoechstens im laufenden Monat und im Vormonat (plus Zukunft) —
  // dieselbe Grenze wie beim Kalender-Sync. Aeltere Monate sind abgeschlossen:
  // "gesamte Historie neu berechnen" gibt es deshalb nicht mehr.
  //
  // Und sie passiert nie ohne ausdrueckliche Bestaetigung: ohne confirmTariff
  // liefert die Route nur eine Vorschau (409) und schreibt nichts.
  let effectiveDay: Date | null = null;
  let updates: { id: string; date: Date; durationMin: number }[] = [];
  if (rateChanged) {
    if (body.recalculateAllSessions) {
      return NextResponse.json(
        { error: "Die gesamte Historie neu zu berechnen ist nicht mehr möglich — abgeschlossene Monate bleiben unverändert." },
        { status: 400 }
      );
    }
    if (!Number.isFinite(nextRate) || nextRate <= 0) {
      return NextResponse.json({ error: "Ungültiger Tarif." }, { status: 400 });
    }
    const now = new Date();
    const check = checkTariffEffectiveDate(body.effectiveFrom, now);
    if (!check.ok) {
      return NextResponse.json(
        { error: check.error, earliestEffectiveFrom: earliestTariffDate(now) },
        { status: 400 }
      );
    }
    effectiveDay = check.effectiveFrom;

    const sessions = await prisma.session.findMany({
      where: { studentId: params.id, date: { gte: effectiveDay } },
      select: { id: true, date: true, durationMin: true, amountCHF: true, cancelledAt: true },
      orderBy: { date: "asc" },
    });
    updates = sessions;

    if (body.confirmTariff !== true) {
      // Nur zaehlende Lektionen in die Vorschau — stornierte werden mit
      // umgerechnet, bewegen aber keinen Betrag.
      const counted = sessions.filter((s) => s.cancelledAt === null);
      const byMonth = new Map<string, TariffPreview["months"][number]>();
      for (const s of counted) {
        const ym = zurichYearMonth(s.date);
        const key = `${ym.year}-${ym.month}`;
        const row = byMonth.get(key) ?? { ...ym, lessonCount: 0, beforeCHF: 0, afterCHF: 0 };
        row.lessonCount += 1;
        row.beforeCHF = roundCents(row.beforeCHF + s.amountCHF);
        row.afterCHF = roundCents(row.afterCHF + roundCents(s.durationMin * nextRate));
        byMonth.set(key, row);
      }
      const months = Array.from(byMonth.values());

      const scopeIds = Array.from(
        new Set([
          ...billingScopeStudentIds(params.id, existing.billedToId),
          ...(billedToId !== undefined ? billingScopeStudentIds(params.id, billedToId) : []),
        ])
      );
      const affected = affectedInvoiceMonths(counted);
      const billedMonths =
        affected.length === 0
          ? []
          : await prisma.invoice.findMany({
              where: {
                studentId: { in: scopeIds },
                OR: affected.map((a) => ({ year: a.year, month: a.month })),
                ...DELIVERED_INVOICE_WHERE,
              },
              select: { year: true, month: true },
              orderBy: [{ year: "asc" }, { month: "asc" }],
            });

      const preview: TariffPreview = {
        oldRate: existing.ratePerMin,
        newRate: nextRate,
        effectiveFrom: String(body.effectiveFrom).trim(),
        lessonCount: counted.length,
        beforeCHF: roundCents(months.reduce((a, m) => a + m.beforeCHF, 0)),
        afterCHF: roundCents(months.reduce((a, m) => a + m.afterCHF, 0)),
        months,
        billedMonths,
      };
      return NextResponse.json({ needsConfirmation: true, preview }, { status: 409 });
    }
  }

  const student = await prisma.student.update({
    where: { id: params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(subject !== undefined && { subject }),
      ...(ratePerMin !== undefined && { ratePerMin: nextRate }),
      ...(email !== undefined && { email }),
      ...(active !== undefined && { active }),
      ...(billedToId !== undefined && { billedToId }),
    },
  });

  if (rateChanged && effectiveDay) {
    const historyCount = await prisma.studentRateHistory.count({
      where: { studentId: params.id },
    });
    // Verlauf und Lektionen in EINER Transaktion: entweder gilt der neue Tarif
    // ueberall ab Stichtag, oder nirgends.
    await prisma.$transaction([
      // Backfill: der alte Satz galt vor dieser Aenderung.
      ...(historyCount === 0
        ? [
            prisma.studentRateHistory.create({
              data: { studentId: params.id, ratePerMin: existing.ratePerMin, effectiveFrom: new Date(0) },
            }),
          ]
        : []),
      // Spaetere Verlaufseintraege widersprechen dem neuen Satz ab Stichtag und
      // wuerden neu synchronisierte Lektionen still mit dem alten Satz bepreisen.
      prisma.studentRateHistory.deleteMany({
        where: { studentId: params.id, effectiveFrom: { gte: effectiveDay } },
      }),
      prisma.studentRateHistory.create({
        data: { studentId: params.id, ratePerMin: nextRate, effectiveFrom: effectiveDay },
      }),
      ...updates.map((s) => {
        const ym = zurichYearMonth(s.date);
        return prisma.session.update({
          where: { id: s.id },
          data: {
            amountCHF: roundCents(s.durationMin * nextRate),
            month: ym.month,
            year: ym.year,
          },
        });
      }),
    ]);
    clearIncomeSummaryCache();
  }

  return NextResponse.json(student);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.update({
    where: { id: params.id },
    data: { active: false },
  });
  return NextResponse.json(student);
}
