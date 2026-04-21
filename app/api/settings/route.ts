import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getTutorProfile } from "@/lib/tutor-profile";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getTutorProfile();
  return NextResponse.json(profile);
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as Partial<{
    name: string;
    email: string;
    address: string;
    phone: string;
    iban: string;
    bankName: string;
  }>;

  const data = {
    name: body.name?.trim() || "Max Mustermann",
    email: body.email?.trim() || "max@example.ch",
    address: body.address?.trim() || "Musterstrasse 1, 8000 Zürich",
    phone: body.phone?.trim() || "+41 79 000 00 00",
    iban: body.iban?.trim() || "CH00 0000 0000 0000 0000 0",
    bankName: body.bankName?.trim() || "Zürcher Kantonalbank",
  };

  const updated = await prisma.tutorProfile.upsert({
    where: { id: "default" },
    update: data,
    create: { id: "default", ...data },
  });

  return NextResponse.json(updated);
}
