import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { zurichYearMonth } from "@/lib/month-math";
import { isExpiredAt } from "@/lib/subscription-utils";

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

  const amount = Number(amountCHF);
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: "amountCHF must be a non-negative number" }, { status: 400 });
  }
  const startM = Number(startMonth);
  const startY = Number(startYear);
  if (!Number.isInteger(startM) || startM < 1 || startM > 12) {
    return NextResponse.json({ error: "startMonth must be 1-12" }, { status: 400 });
  }
  if (!Number.isInteger(startY) || startY < 2000 || startY > 2100) {
    return NextResponse.json({ error: "startYear must be a valid year" }, { status: 400 });
  }

  // Abos deactivate automatically once their duration is over: flip expired
  // flags here (write-on-read), then only a still-running Abo blocks a new one.
  const actives = await prisma.platformSubscription.findMany({
    where: { studentId, active: true },
  });
  const nowRef = zurichYearMonth(new Date());
  const expiredIds = actives.filter((s) => isExpiredAt(s, nowRef)).map((s) => s.id);
  if (expiredIds.length > 0) {
    await prisma.platformSubscription.updateMany({
      where: { id: { in: expiredIds } },
      data: { active: false },
    });
  }
  if (actives.some((s) => !isExpiredAt(s, nowRef))) {
    return NextResponse.json(
      { error: "Student hat bereits ein aktives Abonnement" },
      { status: 409 }
    );
  }

  const subscription = await prisma.platformSubscription.create({
    data: {
      studentId,
      amountCHF: amount,
      durationMonths: Number(durationMonths),
      billingMethod,
      startMonth: startM,
      startYear: startY,
    },
    include: { charges: true },
  });

  return NextResponse.json(subscription, { status: 201 });
}
