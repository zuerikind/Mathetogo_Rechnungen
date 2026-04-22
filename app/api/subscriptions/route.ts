import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const studentId = req.nextUrl.searchParams.get("studentId");
  if (!studentId) {
    return NextResponse.json({ error: "studentId is required" }, { status: 400 });
  }

  const subscriptions = await prisma.platformSubscription.findMany({
    where: { studentId },
    include: {
      charges: {
        orderBy: [{ year: "asc" }, { month: "asc" }],
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(subscriptions);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { studentId, amountCHF, durationMonths, billingMethod, startMonth, startYear } = body;

  // Validate required fields
  if (
    studentId === undefined ||
    amountCHF === undefined ||
    durationMonths === undefined ||
    billingMethod === undefined ||
    startMonth === undefined ||
    startYear === undefined
  ) {
    return NextResponse.json(
      { error: "studentId, amountCHF, durationMonths, billingMethod, startMonth, and startYear are required" },
      { status: 400 }
    );
  }

  // Validate durationMonths
  if (![1, 6].includes(Number(durationMonths))) {
    return NextResponse.json(
      { error: "durationMonths must be 1 or 6" },
      { status: 400 }
    );
  }

  // Validate billingMethod
  if (!["invoice", "direct"].includes(billingMethod)) {
    return NextResponse.json(
      { error: "billingMethod must be 'invoice' or 'direct'" },
      { status: 400 }
    );
  }

  // Check for existing active subscription
  const existing = await prisma.platformSubscription.findFirst({
    where: { studentId, active: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Student hat bereits ein aktives Abonnement" },
      { status: 409 }
    );
  }

  const subscription = await prisma.platformSubscription.create({
    data: {
      studentId,
      amountCHF: Number(amountCHF),
      durationMonths: Number(durationMonths),
      billingMethod,
      startMonth: Number(startMonth),
      startYear: Number(startYear),
    },
    include: { charges: true },
  });

  return NextResponse.json(subscription, { status: 201 });
}
