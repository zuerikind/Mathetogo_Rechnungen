import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getEffectiveManualBaseline, MANUAL_Q1_SELECT } from "@/lib/manual-revenue";
import { prisma } from "@/lib/prisma";

/** Manual Q1 totals (DB or file defaults), for display / debugging. */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let row: {
    manualQ1Year: number | null;
    manualQ1M1Chf: number | null;
    manualQ1M2Chf: number | null;
    manualQ1M3Chf: number | null;
  } | null = null;
  try {
    row = await prisma.tutorProfile.findUnique({
      where: { id: "default" },
      select: MANUAL_Q1_SELECT,
    });
  } catch {
    row = null;
  }

  const manual = getEffectiveManualBaseline(
    row
      ? {
          manualQ1Year: row.manualQ1Year,
          manualQ1M1Chf: row.manualQ1M1Chf,
          manualQ1M2Chf: row.manualQ1M2Chf,
          manualQ1M3Chf: row.manualQ1M3Chf,
        }
      : null
  );

  return NextResponse.json({
    year: manual.year,
    months: manual.entries.map((e) => ({
      month: e.month,
      amountCHF: e.amountCHF,
    })),
    fromDatabase: manual.fromDatabase,
  });
}
