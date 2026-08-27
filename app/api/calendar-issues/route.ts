import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * Nicht zugeordnete Kalendereintraege — lesen und entscheiden.
 *
 * Zwei Entscheide mit unterschiedlicher Bedeutung (siehe lib/calendar-sync-issues):
 *   resolve — geprueft/behoben. Aendert sich der Termin spaeter materiell, meldet
 *             der Sync ihn wieder.
 *   ignore  — absichtlich kein Schuelertermin. Gilt fuer diese Event-ID dauerhaft.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.calendarSyncIssue.findMany({
    where: { status: "open" },
    orderBy: [{ startAt: "desc" }, { lastSeenAt: "desc" }],
    select: {
      id: true,
      externalEventId: true,
      reason: true,
      title: true,
      startAt: true,
      endAt: true,
      calendarId: true,
      detailsJson: true,
      firstSeenAt: true,
      lastSeenAt: true,
    },
  });

  return NextResponse.json({ rows, openCount: rows.length });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { action?: string; ids?: unknown };
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === "string")
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids sind erforderlich." }, { status: 400 });
  }
  if (body.action !== "resolve" && body.action !== "ignore") {
    return NextResponse.json(
      { error: 'action muss "resolve" oder "ignore" sein.' },
      { status: 400 }
    );
  }

  const now = new Date();
  try {
    const updated = await prisma.calendarSyncIssue.updateMany({
      where: { id: { in: ids } },
      data:
        body.action === "resolve"
          ? { status: "resolved", resolvedAt: now, ignoredAt: null }
          : { status: "ignored", ignoredAt: now },
    });
    return NextResponse.json({ updated: updated.count, action: body.action });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Entscheid fehlgeschlagen." },
      { status: 500 }
    );
  }
}
