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

  if (!name || !subject || ratePerMin == null) {
    return NextResponse.json({ error: "name, subject, ratePerMin required" }, { status: 400 });
  }

  const student = await prisma.student.create({
    data: { name, subject, ratePerMin: Number(ratePerMin), email },
  });
  return NextResponse.json(student, { status: 201 });
}
