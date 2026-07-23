import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const STAGE_KEYS = ["stage1", "stage2", "stage3"] as const;
const MAX_LEN = 2000;

// GET: reines Lesen der Singleton-Zeile (id = "default"), die per Migration geseedet ist.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const row = await prisma.reminderTemplate.findUnique({
    where: { id: "default" },
    select: { stage1: true, stage2: true, stage3: true, updatedAt: true },
  });

  if (!row) {
    return NextResponse.json(
      { error: "Vorlagen nicht gefunden — Seed-Migration fehlt." },
      { status: 404 }
    );
  }

  return NextResponse.json(row);
}

// PUT: aktualisiert alle drei Felder. Inline-Validierung (kein zod).
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as unknown;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Body muss ein Objekt sein." }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const data: Record<string, string> = {};
  for (const key of STAGE_KEYS) {
    const value = record[key];
    if (typeof value !== "string") {
      return NextResponse.json(
        { error: `Feld "${key}" fehlt oder ist kein Text.` },
        { status: 400 }
      );
    }
    const trimmed = value.trim();
    if (trimmed.length > MAX_LEN) {
      return NextResponse.json(
        { error: `Feld "${key}" ist zu lang (max. ${MAX_LEN} Zeichen).` },
        { status: 400 }
      );
    }
    data[key] = trimmed;
  }

  const updated = await prisma.reminderTemplate.update({
    where: { id: "default" },
    data,
    select: { stage1: true, stage2: true, stage3: true, updatedAt: true },
  });

  return NextResponse.json(updated);
}
