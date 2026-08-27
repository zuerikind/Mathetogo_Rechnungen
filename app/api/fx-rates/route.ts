import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { FX_DEFAULTS, validateFxRates, type FxRates } from "@/lib/fx-rates";
import { prisma } from "@/lib/prisma";

/**
 * Wechselkurse lesen und von Hand setzen. Kein externer Dienst — siehe lib/fx-rates.
 * Gespeichert wird in FxRateSnapshot (Singleton-Zeile "default"), Decimal(12,6);
 * der erweiterte Client in lib/prisma liefert daraus number.
 */

function isMissingTableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2021"
  );
}

type FxResponse = FxRates & { configured: boolean; updatedAt: Date | null };

async function getStoredRates(): Promise<FxResponse> {
  const row = await prisma.fxRateSnapshot
    .findUnique({ where: { id: "default" } })
    .catch((err) => {
      if (isMissingTableError(err)) return null;
      throw err;
    });
  if (!row) return { ...FX_DEFAULTS, configured: false, updatedAt: null };
  return {
    chfPerEur: row.chfPerEur,
    chfPerMxn: row.chfPerMxn,
    source: row.source ?? "manual",
    fetchedAt: row.fetchedAt,
    configured: true,
    updatedAt: row.updatedAt,
  };
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getStoredRates());
}

/** Manuell gesetzte Kurse speichern. Ungueltige Werte werden abgelehnt, nie stillschweigend gerundet weg. */
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { chfPerEur?: unknown; chfPerMxn?: unknown };
  const parsed = validateFxRates({ chfPerEur: body.chfPerEur, chfPerMxn: body.chfPerMxn });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const now = new Date();
  try {
    const saved = await prisma.fxRateSnapshot.upsert({
      where: { id: "default" },
      update: {
        chfPerEur: parsed.chfPerEur,
        chfPerMxn: parsed.chfPerMxn,
        source: "manual",
        fetchedAt: now,
      },
      create: {
        id: "default",
        chfPerEur: parsed.chfPerEur,
        chfPerMxn: parsed.chfPerMxn,
        source: "manual",
        fetchedAt: now,
      },
    });
    return NextResponse.json({
      chfPerEur: saved.chfPerEur,
      chfPerMxn: saved.chfPerMxn,
      source: saved.source ?? "manual",
      fetchedAt: saved.fetchedAt,
      configured: true,
      updatedAt: saved.updatedAt,
    } satisfies FxResponse);
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        { error: "FX-Tabelle fehlt. Bitte Prisma Migration/DB Push ausfuehren." },
        { status: 503 }
      );
    }
    // Geldrelevante Mutation: Fehler wird gemeldet, nicht geschluckt.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kurse konnten nicht gespeichert werden." },
      { status: 500 }
    );
  }
}
