import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

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

  return NextResponse.json(subscription);
}
