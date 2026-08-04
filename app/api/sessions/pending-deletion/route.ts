import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  confirmPendingDeletions,
  listPendingDeletions,
  rejectPendingDeletions,
} from "@/lib/pending-deletion";

export const dynamic = "force-dynamic";

/** Offene Löschvormerkungen — optional auf Jahr/Monat eingegrenzt. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const y = Number(req.nextUrl.searchParams.get("year"));
  const m = Number(req.nextUrl.searchParams.get("month"));
  const rows = await listPendingDeletions({
    year: Number.isFinite(y) && y > 0 ? y : undefined,
    month: Number.isFinite(m) && m >= 1 && m <= 12 ? m : undefined,
  });

  return NextResponse.json({
    rows,
    totalCHF: Math.round(rows.reduce((a, r) => a + r.amountCHF, 0) * 100) / 100,
  });
}

/** Entscheid: bestätigen (löscht) oder ablehnen (behält). */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    sessionIds?: unknown;
  };
  const ids = Array.isArray(body.sessionIds)
    ? body.sessionIds.filter((v): v is string => typeof v === "string")
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "sessionIds sind erforderlich." }, { status: 400 });
  }

  const actor = session.user?.email ?? "unbekannt";
  try {
    if (body.action === "confirm") {
      return NextResponse.json(await confirmPendingDeletions(ids, actor));
    }
    if (body.action === "reject") {
      return NextResponse.json(await rejectPendingDeletions(ids, actor));
    }
    return NextResponse.json(
      { error: 'action muss "confirm" oder "reject" sein.' },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Entscheid fehlgeschlagen." },
      { status: 500 }
    );
  }
}
