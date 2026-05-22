import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { parseAdditionalEarningInput } from "@/lib/additional-earnings-validation";
import { prisma } from "@/lib/prisma";

function isMissingTableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2021"
  );
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const year = Number(req.nextUrl.searchParams.get("year"));
  const month = Number(req.nextUrl.searchParams.get("month"));
  const where: { year?: number; month?: number } = {};
  if (Number.isFinite(year) && year >= 2000 && year <= 2100) where.year = Math.floor(year);
  if (Number.isFinite(month) && month >= 1 && month <= 12) where.month = Math.floor(month);

  try {
    const rows = await prisma.additionalEarning.findMany({
      where,
      orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({ rows });
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ rows: [] });
    }
    return NextResponse.json(
      { rows: [], error: error instanceof Error ? error.message : "Laden fehlgeschlagen." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    year?: unknown;
    month?: unknown;
    name?: unknown;
    amountCHF?: unknown;
  };
  const parsed = parseAdditionalEarningInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const row = await prisma.additionalEarning.create({
      data: {
        year: parsed.year,
        month: parsed.month,
        name: parsed.name,
        amountCHF: parsed.amountCHF,
      },
    });
    return NextResponse.json(row);
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        {
          error:
            "Tabelle fehlt. Bitte im Projektordner: npx prisma migrate deploy (bzw. migrate dev).",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Speichern fehlgeschlagen." },
      { status: 500 }
    );
  }
}
