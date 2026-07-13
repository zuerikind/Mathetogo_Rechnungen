import { NextRequest, NextResponse } from "next/server";
import { zurichYearMonth } from "@/lib/month-math";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function parseLocalDateOnly(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(y, mo, day);
  if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return null;
  return startOfLocalDay(d);
}

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

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, subject, ratePerMin, email, active } = body;
  const recalculateAllSessions = Boolean(body.recalculateAllSessions);
  const effectiveFromRaw = body.effectiveFrom as unknown;
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

  if (rateChanged && !recalculateAllSessions && parseLocalDateOnly(effectiveFromRaw) == null) {
    return NextResponse.json(
      {
        error:
          "Fuer Tarifaenderungen bitte effectiveFrom als YYYY-MM-DD angeben oder recalculateAllSessions auf true setzen.",
      },
      { status: 400 }
    );
  }

  const effectiveDay = recalculateAllSessions ? null : parseLocalDateOnly(effectiveFromRaw);

  let updates: { id: string; date: Date; durationMin: number }[] = [];
  if (rateChanged) {
    const sessions = await prisma.session.findMany({
      where: { studentId: params.id },
      select: { id: true, date: true, durationMin: true },
    });
    updates = sessions.filter((s) => {
      if (recalculateAllSessions) return true;
      if (!effectiveDay) return false;
      return s.date >= effectiveDay;
    });

    // Warn before rewriting amounts inside months whose invoice already went out.
    if (!Boolean(body.confirmBilledMonths) && updates.length > 0) {
      const affected = Array.from(
        new Set(updates.map((s) => `${zurichYearMonth(s.date).year}-${zurichYearMonth(s.date).month}`))
      ).map((key) => {
        const [y, m] = key.split("-").map(Number);
        return { year: y, month: m };
      });
      const billedInvoices = await prisma.invoice.findMany({
        where: {
          studentId: params.id,
          OR: affected.map((a) => ({ year: a.year, month: a.month })),
          NOT: { sentAt: null, paidAt: null },
        },
        select: { year: true, month: true },
        orderBy: [{ year: "asc" }, { month: "asc" }],
      });
      if (billedInvoices.length > 0) {
        return NextResponse.json(
          {
            error: "Tarifaenderung betrifft bereits gesendete/bezahlte Monate.",
            billedMonths: billedInvoices.map((i) => ({ year: i.year, month: i.month })),
          },
          { status: 409 }
        );
      }
    }
  }

  const student = await prisma.student.update({
    where: { id: params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(subject !== undefined && { subject }),
      ...(ratePerMin !== undefined && { ratePerMin: Number(ratePerMin) }),
      ...(email !== undefined && { email }),
      ...(active !== undefined && { active }),
      ...(billedToId !== undefined && { billedToId }),
    },
  });

  if (rateChanged) {
    // Keep the rate history in sync so late-synced past lessons get the correct tariff.
    if (recalculateAllSessions) {
      // "This rate always applied": collapse history to a single entry.
      await prisma.$transaction([
        prisma.studentRateHistory.deleteMany({ where: { studentId: params.id } }),
        prisma.studentRateHistory.create({
          data: { studentId: params.id, ratePerMin: nextRate, effectiveFrom: new Date(0) },
        }),
      ]);
    } else if (effectiveDay) {
      const historyCount = await prisma.studentRateHistory.count({
        where: { studentId: params.id },
      });
      if (historyCount === 0) {
        // Backfill: the old rate applied before this change.
        await prisma.studentRateHistory.create({
          data: { studentId: params.id, ratePerMin: existing.ratePerMin, effectiveFrom: new Date(0) },
        });
      }
      await prisma.studentRateHistory.create({
        data: { studentId: params.id, ratePerMin: nextRate, effectiveFrom: effectiveDay },
      });
    }

    if (updates.length > 0) {
      await prisma.$transaction(
        updates.map((s) => {
          const ym = zurichYearMonth(s.date);
          return prisma.session.update({
            where: { id: s.id },
            data: {
              amountCHF: Math.round(s.durationMin * nextRate * 100) / 100,
              month: ym.month,
              year: ym.year,
            },
          });
        })
      );
    }
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
