import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const students = await prisma.student.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(students);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, subject, ratePerMin, email } = body;
  const billedToId = body.billedToId ? String(body.billedToId) : null;

  if (!name || !subject || ratePerMin == null) {
    return NextResponse.json({ error: "name, subject, ratePerMin required" }, { status: 400 });
  }

  if (billedToId) {
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
  }

  const student = await prisma.student.create({
    data: {
      name,
      subject,
      ratePerMin: Number(ratePerMin),
      email,
      billedToId,
      // Initial rate applies to all dates until a Tarifänderung adds a newer entry.
      rateHistory: { create: { ratePerMin: Number(ratePerMin), effectiveFrom: new Date(0) } },
    },
  });
  return NextResponse.json(student, { status: 201 });
}
