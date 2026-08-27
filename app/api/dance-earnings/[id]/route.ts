import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  applyChfRate,
  FX_DEFAULTS,
  isSupportedCurrency,
  rateForEdit,
  type FxRates,
  type SupportedCurrency,
} from "@/lib/fx-rates";
import { prisma } from "@/lib/prisma";

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

/** Manuell gepflegte Kurse; ohne gespeicherte Zeile gelten die Startwerte (lib/fx-rates). */
async function getRates(): Promise<FxRates> {
  const stored = await prisma.fxRateSnapshot.findUnique({ where: { id: "default" } });
  if (!stored) return FX_DEFAULTS;
  return {
    chfPerEur: stored.chfPerEur,
    chfPerMxn: stored.chfPerMxn,
    source: stored.source ?? "manual",
    fetchedAt: stored.fetchedAt,
  };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = params.id;
  const existing = await prisma.danceEarning.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json()) as {
    date?: string;
    payerName?: string;
    amount?: number;
    currency?: SupportedCurrency;
    notes?: string;
  };

  const date = body.date ? parseDate(body.date) : existing.date;
  if (!date) return NextResponse.json({ error: "Ungueltiges Datum." }, { status: 400 });
  const payerName = body.payerName !== undefined ? body.payerName.trim() : existing.payerName;
  const amountOriginal = body.amount !== undefined ? Number(body.amount) : existing.amountOriginal;
  const currency = (body.currency ?? existing.currency) as SupportedCurrency;
  if (!isSupportedCurrency(currency) || !payerName || !Number.isFinite(amountOriginal) || amountOriginal < 0) {
    return NextResponse.json({ error: "Ungueltige Eingabedaten." }, { status: 400 });
  }
  // Der historische Kurs bleibt stehen: ein manuell geaenderter Kurs wirkt ab
  // jetzt, nie rueckwirkend. Nur ein Waehrungswechsel holt den heutigen Kurs,
  // weil es fuer die neue Waehrung keinen historischen gibt (siehe rateForEdit).
  const rates = await getRates();
  const { chfRate } = rateForEdit(
    { currency: existing.currency as SupportedCurrency, chfRate: existing.chfRate },
    currency,
    rates
  );
  const amountCHF = applyChfRate(amountOriginal, chfRate);
  const updated = await prisma.danceEarning.update({
    where: { id },
    data: {
      date,
      payerName,
      amountOriginal: Math.round(amountOriginal * 100) / 100,
      currency,
      chfRate,
      amountCHF,
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      notes: body.notes !== undefined ? body.notes.trim() || null : existing.notes,
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prisma.danceEarning.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
