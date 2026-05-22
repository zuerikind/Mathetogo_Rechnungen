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

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.additionalEarning.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json()) as {
    year?: unknown;
    month?: unknown;
    name?: unknown;
    amountCHF?: unknown;
  };
  const parsed = parseAdditionalEarningInput({
    year: body.year ?? existing.year,
    month: body.month ?? existing.month,
    name: body.name ?? existing.name,
    amountCHF: body.amountCHF ?? existing.amountCHF,
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const row = await prisma.additionalEarning.update({
      where: { id: params.id },
      data: {
        year: parsed.year,
        month: parsed.month,
        name: parsed.name,
        amountCHF: parsed.amountCHF,
      },
    });
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update fehlgeschlagen." },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await prisma.additionalEarning.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Loeschen fehlgeschlagen." },
      { status: 500 }
    );
  }
}
