import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { jobState, runTutor24Messaging } from "@/lib/tutor24";

export const runtime = "nodejs";
// Long timeout — browser automation takes time
export const maxDuration = 300;

/** GET — returns job status + list of already-messaged contacts */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contacts = await prisma.tutor24Contact.findMany({
    orderBy: { messagedAt: "desc" },
    take: 200,
  });

  return NextResponse.json({
    running: jobState.running,
    startedAt: jobState.startedAt,
    result: jobState.result,
    contacts,
  });
}

/** POST — starts the automation in the background */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (jobState.running) {
    return NextResponse.json({ error: "Automation is already running" }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as { headless?: boolean; maxPages?: number; subjects?: string[] };
  const headless = body.headless ?? false;
  const maxPages = typeof body.maxPages === "number" ? body.maxPages : 10;
  const subjects = Array.isArray(body.subjects) && body.subjects.length > 0 ? body.subjects : ["Mathematik", "Physik"];

  // Fire-and-forget — result lands in jobState
  runTutor24Messaging(headless, maxPages, subjects).catch((err) => {
    console.error("[tutor24] automation error:", err);
    jobState.running = false;
    jobState.result = {
      messaged: 0,
      skipped: 0,
      errors: [err instanceof Error ? err.message : String(err)],
      log: ["Fatal error — see server console"],
      newContacts: [],
    };
  });

  return NextResponse.json({ started: true });
}

/** DELETE — stop the running automation */
export async function DELETE() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  jobState.shouldStop = true;
  return NextResponse.json({ stopping: true });
}
