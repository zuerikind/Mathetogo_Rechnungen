import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { currentSchoolYear, levelsReviewNeeded } from "@/lib/school-levels";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await prisma.tutorProfile.findUnique({
    where: { id: "default" },
    select: { levelsReviewedYear: true },
  });
  const now = new Date();
  return NextResponse.json({
    schoolYear: currentSchoolYear(now),
    reviewNeeded: levelsReviewNeeded(profile?.levelsReviewedYear, now),
  });
}

/** Setzt Stufen ({ updates: [{ id, level }] }) und bestaetigt optional das Schuljahr (markReviewed). */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    updates?: Array<{ id: string; level: string | null }>;
    markReviewed?: boolean;
  };
  const updates = (body.updates ?? []).map((u) => ({
    id: String(u.id),
    level: typeof u.level === "string" && u.level.trim() ? u.level.trim().slice(0, 80) : null,
  }));

  await prisma.$transaction([
    ...updates.map((u) => prisma.student.update({ where: { id: u.id }, data: { level: u.level } })),
    ...(body.markReviewed
      ? [
          prisma.tutorProfile.upsert({
            where: { id: "default" },
            update: { levelsReviewedYear: currentSchoolYear(new Date()) },
            create: { id: "default", levelsReviewedYear: currentSchoolYear(new Date()) },
          }),
        ]
      : []),
  ]);
  return NextResponse.json({ ok: true });
}
