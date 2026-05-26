import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  isMonthlyExpenseUnavailable,
  prismaHasMonthlyExpense,
} from "@/lib/monthly-expense-route-helpers";
import { parseMonthlyExpenseInput } from "@/lib/monthly-expenses-validation";
import { prisma } from "@/lib/prisma";

const STALE_CLIENT_HINT =
  "Prisma-Client kennt MonthlyExpense nicht. Im Projektordner: npx prisma generate — dann Dev-Server neu starten.";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!prismaHasMonthlyExpense(prisma)) {
    return NextResponse.json({ error: STALE_CLIENT_HINT }, { status: 503 });
  }

  const existing = await prisma.monthlyExpense.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json()) as {
    year?: unknown;
    month?: unknown;
    amountCHF?: unknown;
    notes?: unknown;
  };
  const parsed = parseMonthlyExpenseInput({
    year: body.year ?? existing.year,
    month: body.month ?? existing.month,
    amountCHF: body.amountCHF ?? existing.amountCHF,
    notes: body.notes !== undefined ? body.notes : existing.notes,
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const row = await prisma.monthlyExpense.update({
      where: { id: params.id },
      data: {
        year: parsed.year,
        month: parsed.month,
        amountCHF: parsed.amountCHF,
        notes: parsed.notes,
      },
    });
    return NextResponse.json(row);
  } catch (error) {
    if (isMonthlyExpenseUnavailable(error)) {
      return NextResponse.json(
        {
          error:
            "Tabelle fehlt oder DB nicht migriert. Bitte: npx prisma migrate deploy (bzw. migrate dev).",
        },
        { status: 503 }
      );
    }
    console.error("[monthly-expenses PATCH]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update fehlgeschlagen." },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!prismaHasMonthlyExpense(prisma)) {
    return NextResponse.json({ error: STALE_CLIENT_HINT }, { status: 503 });
  }

  try {
    await prisma.monthlyExpense.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isMonthlyExpenseUnavailable(error)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Loeschen fehlgeschlagen." },
      { status: 500 }
    );
  }
}
