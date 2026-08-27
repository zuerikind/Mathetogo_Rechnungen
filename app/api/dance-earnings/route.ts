import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  convertToChf,
  FX_DEFAULTS,
  isSupportedCurrency,
  type FxRates,
  type SupportedCurrency,
} from "@/lib/fx-rates";
import { prisma } from "@/lib/prisma";

function isMissingTableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2021"
  );
}

/** Manuell gepflegte Kurse; ohne gespeicherte Zeile gelten die Startwerte (lib/fx-rates). */
async function getRates(): Promise<FxRates & { configured: boolean }> {
  const stored = await prisma.fxRateSnapshot
    .findUnique({ where: { id: "default" } })
    .catch((err) => {
      if (isMissingTableError(err)) return null;
      throw err;
    });
  if (stored) {
    return {
      chfPerEur: stored.chfPerEur,
      chfPerMxn: stored.chfPerMxn,
      source: stored.source ?? "manual",
      fetchedAt: stored.fetchedAt,
      configured: true,
    };
  }
  return { ...FX_DEFAULTS, configured: false };
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const year = Number(req.nextUrl.searchParams.get("year"));
  const month = Number(req.nextUrl.searchParams.get("month"));
  const where: { year?: number; month?: number } = {};
  if (Number.isFinite(year)) where.year = Math.floor(year);
  if (Number.isFinite(month) && month >= 1 && month <= 12) where.month = Math.floor(month);
  try {
    const [rows, rates] = await Promise.all([
      prisma.danceEarning
        .findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }] })
        .catch((err) => {
          if (isMissingTableError(err)) return [];
          throw err;
        }),
      getRates(),
    ]);
    return NextResponse.json({ rows, rates });
  } catch (error) {
    return NextResponse.json(
      {
        rows: [],
        rates: FX_DEFAULTS,
        error: error instanceof Error ? error.message : "Dance earnings konnten nicht geladen werden.",
      },
      { status: 200 }
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json()) as {
    date?: string;
    payerName?: string;
    amount?: number;
    currency?: SupportedCurrency;
    notes?: string;
  };
  const date = parseDate(body.date);
  const payerName = (body.payerName ?? "").trim();
  const amountOriginal = Number(body.amount);
  const currency = body.currency;
  if (!date || !payerName || !Number.isFinite(amountOriginal) || amountOriginal < 0 || !currency) {
    return NextResponse.json({ error: "Ungueltige Eingabedaten." }, { status: 400 });
  }
  if (!isSupportedCurrency(currency)) {
    return NextResponse.json({ error: "Ungueltige Waehrung." }, { status: 400 });
  }

  // Kein Netzaufruf mehr: der gespeicherte, von Hand gepflegte Kurs ist die
  // einzige Quelle. `chfRate` und `amountCHF` werden wie bisher eingefroren, ein
  // spaeter geaenderter Kurs beruehrt bestehende Eintraege also nicht.
  const rates = await getRates();
  const { chfRate, amountCHF } = convertToChf(amountOriginal, currency, rates);
  try {
    const row = await prisma.danceEarning.create({
      data: {
        date,
        payerName,
        amountOriginal: Math.round(amountOriginal * 100) / 100,
        currency,
        chfRate,
        amountCHF,
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        notes: (body.notes ?? "").trim() || null,
      },
    });
    return NextResponse.json(row);
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        { error: "Dance Tabelle fehlt. Bitte Prisma Migration/DB Push ausfuehren." },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Speichern fehlgeschlagen." },
      { status: 500 }
    );
  }
}
