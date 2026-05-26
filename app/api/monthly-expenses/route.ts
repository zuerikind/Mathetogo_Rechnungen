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

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!prismaHasMonthlyExpense(prisma)) {
    return NextResponse.json({ rows: [], error: STALE_CLIENT_HINT }, { status: 503 });
  }

  const year = Number(req.nextUrl.searchParams.get("year"));
  const where: { year?: number } = {};
  if (Number.isFinite(year) && year >= 2000 && year <= 2100) where.year = Math.floor(year);

  try {
    const rows = await prisma.monthlyExpense.findMany({
      where,
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    return NextResponse.json({ rows });
  } catch (error) {
    if (isMonthlyExpenseUnavailable(error)) {
      return NextResponse.json({ rows: [] });
    }
    console.error("[monthly-expenses GET]", error);
    return NextResponse.json(
      { rows: [], error: error instanceof Error ? error.message : "Laden fehlgeschlagen." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!prismaHasMonthlyExpense(prisma)) {
    return NextResponse.json({ error: STALE_CLIENT_HINT }, { status: 503 });
  }

  const body = (await req.json()) as {
    year?: unknown;
    month?: unknown;
    amountCHF?: unknown;
    notes?: unknown;
  };
  const parsed = parseMonthlyExpenseInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const existing = await prisma.monthlyExpense.findFirst({
      where: { year: parsed.year, month: parsed.month },
    });
    const row = existing
      ? await prisma.monthlyExpense.update({
          where: { id: existing.id },
          data: { amountCHF: parsed.amountCHF, notes: parsed.notes },
        })
      : await prisma.monthlyExpense.create({
          data: {
            year: parsed.year,
            month: parsed.month,
            amountCHF: parsed.amountCHF,
            notes: parsed.notes,
          },
        });
    return NextResponse.json(row);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      const again = await prisma.monthlyExpense.findFirst({
        where: { year: parsed.year, month: parsed.month },
      });
      if (again) {
        const row = await prisma.monthlyExpense.update({
          where: { id: again.id },
          data: { amountCHF: parsed.amountCHF, notes: parsed.notes },
        });
        return NextResponse.json(row);
      }
    }
    if (isMonthlyExpenseUnavailable(error)) {
      return NextResponse.json(
        {
          error:
            "Tabelle fehlt oder DB nicht migriert. Bitte: npx prisma migrate deploy (bzw. migrate dev), dann npx prisma generate.",
        },
        { status: 503 }
      );
    }
    console.error("[monthly-expenses POST]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Speichern fehlgeschlagen." },
      { status: 500 }
    );
  }
}
