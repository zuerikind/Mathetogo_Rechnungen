import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getEffectiveManualBaseline, mergeManualBaselineSessions } from "@/lib/manual-revenue";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get("studentId");
  const year = searchParams.get("year");
  const month = searchParams.get("month");

  const sessions = await prisma.session.findMany({
    where: {
      ...(studentId ? { studentId } : {}),
      ...(year ? { year: Number(year) } : {}),
      ...(month ? { month: Number(month) } : {}),
    },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          subject: true,
        },
      },
    },
    orderBy: { date: "desc" },
  });

  let tutorRow: {
    manualQ1Year: number | null;
    manualQ1M1Chf: number | null;
    manualQ1M2Chf: number | null;
    manualQ1M3Chf: number | null;
  } | null = null;
  try {
    const rows = await prisma.$queryRaw<
      {
        manualQ1Year: number | null;
        manualQ1M1Chf: number | null;
        manualQ1M2Chf: number | null;
        manualQ1M3Chf: number | null;
      }[]
    >`SELECT "manualQ1Year", "manualQ1M1Chf", "manualQ1M2Chf", "manualQ1M3Chf" FROM "TutorProfile" WHERE id = 'default' LIMIT 1`;
    tutorRow = rows[0] ?? null;
  } catch {
    // DB not migrated yet (missing manual Q1 columns) — use file defaults in getEffectiveManualBaseline
    tutorRow = null;
  }

  const baseline = getEffectiveManualBaseline(tutorRow);
  const merged = mergeManualBaselineSessions(
    sessions,
    { studentId, year, month },
    { year: baseline.year, entries: baseline.entries }
  );

  return NextResponse.json(merged);
}
