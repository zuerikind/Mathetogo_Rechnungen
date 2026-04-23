import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

/** All subscriptions (for dashboard analysis proration). */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const yearParam = req.nextUrl.searchParams.get("year");
  const year = yearParam ? Number(yearParam) : new Date().getFullYear();
  if (!Number.isFinite(year)) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  }

  const subscriptions = await prisma.platformSubscription.findMany({
    select: {
      id: true,
      studentId: true,
      student: { select: { name: true, subject: true } },
      amountCHF: true,
      billingMethod: true,
      durationMonths: true,
      startMonth: true,
      startYear: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ year, subscriptions });
}
