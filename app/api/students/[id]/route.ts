import { NextRequest, NextResponse } from "next/server";
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

  const existing = await prisma.student.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

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

  const student = await prisma.student.update({
    where: { id: params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(subject !== undefined && { subject }),
      ...(ratePerMin !== undefined && { ratePerMin: Number(ratePerMin) }),
      ...(email !== undefined && { email }),
      ...(active !== undefined && { active }),
    },
  });

  if (rateChanged) {
    const effectiveDay = recalculateAllSessions ? null : parseLocalDateOnly(effectiveFromRaw);
    const sessions = await prisma.session.findMany({
      where: { studentId: params.id },
      select: { id: true, date: true, durationMin: true },
    });

    const updates = sessions.filter((s) => {
      if (recalculateAllSessions) return true;
      if (!effectiveDay) return false;
      return s.date >= effectiveDay;
    });

    if (updates.length > 0) {
      await prisma.$transaction(
        updates.map((s) =>
          prisma.session.update({
            where: { id: s.id },
            data: {
              amountCHF: Math.round(s.durationMin * nextRate * 100) / 100,
              month: s.date.getMonth() + 1,
              year: s.date.getFullYear(),
            },
          })
        )
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
