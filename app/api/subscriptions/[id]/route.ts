import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = params.id;
  const existing = await prisma.platformSubscription.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Abonnement nicht gefunden" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.platformCharge.deleteMany({ where: { subscriptionId: id } }),
    prisma.platformSubscription.delete({ where: { id } }),
  ]);

  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { amountCHF, billingMethod, active } = body;

  // Validate billingMethod if provided
  if (billingMethod !== undefined && !["invoice", "direct"].includes(billingMethod)) {
    return NextResponse.json(
      { error: "billingMethod must be 'invoice' or 'direct'" },
      { status: 400 }
    );
  }

  const subscription = await prisma.platformSubscription.update({
    where: { id: params.id },
    data: {
      ...(amountCHF !== undefined && { amountCHF: Number(amountCHF) }),
      ...(billingMethod !== undefined && { billingMethod }),
      ...(active !== undefined && { active: Boolean(active) }),
    },
    include: {
      charges: {
        orderBy: [{ year: "asc" }, { month: "asc" }],
      },
    },
  });

  if (billingMethod === "direct") {
    await prisma.platformCharge.updateMany({
      where: { subscriptionId: params.id, paidAt: null },
      data: { paidAt: new Date() },
    });
    const refreshed = await prisma.platformSubscription.findUnique({
      where: { id: params.id },
      include: {
        charges: { orderBy: [{ year: "asc" }, { month: "asc" }] },
      },
    });
    if (refreshed) return NextResponse.json(refreshed);
  }

  return NextResponse.json(subscription);
}
