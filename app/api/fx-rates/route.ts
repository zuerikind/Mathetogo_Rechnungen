import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchLatestFxRates, FX_DEFAULTS } from "@/lib/fx-rates";
import { prisma } from "@/lib/prisma";

function isMissingTableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2021"
  );
}

async function getStoredRates() {
  const row = await prisma.fxRateSnapshot
    .findUnique({ where: { id: "default" } })
    .catch((err) => {
      if (isMissingTableError(err)) return null;
      throw err;
    });
  if (!row) return null;
  return {
    chfPerEur: row.chfPerEur,
    chfPerMxn: row.chfPerMxn,
    source: row.source ?? "database",
    fetchedAt: row.fetchedAt,
  };
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const stored = await getStoredRates();
  if (stored) return NextResponse.json(stored);
  return NextResponse.json(FX_DEFAULTS);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { force?: boolean };
  const stored = await getStoredRates();
  const freshEnough =
    stored && Date.now() - new Date(stored.fetchedAt).getTime() < 1000 * 60 * 60 * 12;
  if (!body.force && freshEnough) return NextResponse.json({ ...stored, refreshed: false });

  try {
    const latest = await fetchLatestFxRates();
    const saved = await prisma.fxRateSnapshot.upsert({
      where: { id: "default" },
      update: {
        chfPerEur: latest.chfPerEur,
        chfPerMxn: latest.chfPerMxn,
        source: latest.source,
        fetchedAt: latest.fetchedAt,
      },
      create: {
        id: "default",
        chfPerEur: latest.chfPerEur,
        chfPerMxn: latest.chfPerMxn,
        source: latest.source,
        fetchedAt: latest.fetchedAt,
      },
    });
    return NextResponse.json({
      chfPerEur: saved.chfPerEur,
      chfPerMxn: saved.chfPerMxn,
      source: saved.source ?? latest.source,
      fetchedAt: saved.fetchedAt,
      refreshed: true,
    });
  } catch {
    if (stored) return NextResponse.json({ ...stored, refreshed: false, fallback: true });
    return NextResponse.json(FX_DEFAULTS);
  }
}
