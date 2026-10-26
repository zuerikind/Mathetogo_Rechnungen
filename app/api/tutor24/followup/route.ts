import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { academigoJobState, followupJobState as state, tutor24JobState } from "@/lib/automation-state";
import { LEVEL_LABEL, MAX_SENDS_PER_DAY } from "@/lib/tutor24-followup";
import { readPreview, saveSettings, loadSettings, sendQueue, sentToday, setRowStatus } from "@/lib/tutor24-followup-store";
import { runFollowup } from "@/lib/tutor24-followup-runner";
import { readTutor24Lock } from "@/lib/tutor24-lock";

export const runtime = "nodejs";
// Long timeout — browser automation takes time
export const maxDuration = 300;

/** Wer tutor24 gerade blockiert, ausser unserem eigenen Lauf in diesem Server. */
function blocker(): string | null {
  if (tutor24JobState.running) return "Erst-Nachrichten-Automation";
  if (academigoJobState.running) return "Academigo-Automation";
  const lock = readTutor24Lock();
  if (lock && !state.running) return `${lock.owner} (seit ${new Date(lock.startedAt).toLocaleTimeString("de-CH")})`;
  return null;
}

/** GET — Laufstatus, Sperre, Einstellungen, Vorschau, Sende-Kontingent */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = loadSettings();
  const { pending, queue, budget } = sendQueue(settings);
  return NextResponse.json({
    state: { ...state, log: state.log.slice(-40) },
    blockedBy: blocker(),
    settings,
    // Ohne Nachrichtentext: den rendert der Tab live aus den Einstellungen.
    rows: readPreview().map(({ nachricht: _omit, ...r }) => r),
    send: {
      limit: MAX_SENDS_PER_DAY,
      sentToday: sentToday(),
      budget,
      pending: pending.length,
      queue: queue.length,
      levels: Array.from(new Set(queue.map((r) => LEVEL_LABEL[r.kategorie as keyof typeof LEVEL_LABEL]))),
    },
  });
}

type PostBody =
  | { action: "preview"; max?: number }
  | { action: "send" }
  | { action: "settings"; settings: unknown }
  | { action: "status"; id: string; status: "send" | "skip" };

/** POST — Lauf starten, Einstellungen speichern oder eine Zeile umschalten */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as PostBody;
  // Waehrend eines Laufs schreibt dieser die CSV — keine parallelen Aenderungen.
  if (state.running) return NextResponse.json({ error: "Ein Nachfass-Lauf ist aktiv." }, { status: 409 });

  try {
    if (body.action === "settings") {
      return NextResponse.json({ settings: saveSettings(body.settings) });
    }
    if (body.action === "status") {
      if (body.status !== "send" && body.status !== "skip") throw new Error("Status muss send oder skip sein.");
      setRowStatus(String(body.id), body.status);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "preview" || body.action === "send") {
      const blocked = blocker();
      if (blocked) return NextResponse.json({ error: `tutor24 ist belegt: ${blocked}` }, { status: 409 });
      const max = body.action === "preview" ? Math.floor(Number(body.max ?? 150)) : undefined;
      if (max !== undefined && !(max >= 1)) throw new Error("max. Konversationen muss ≥ 1 sein.");
      if (body.action === "send" && sendQueue().queue.length === 0)
        throw new Error("Nichts zu senden: keine Zeile mit status=send in einer angehakten Stufe, oder Tageslimit erreicht.");

      // Fire-and-forget wie die Erst-Nachrichten-Automation — Status landet in followupJobState.
      runFollowup({ mode: body.action, maxChecks: max }).catch((err) => {
        console.error("[tutor24-followup]", err instanceof Error ? err.message : err);
      });
      return NextResponse.json({ started: true });
    }
    return NextResponse.json({ error: "Unbekannte Aktion." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

/** DELETE — laufenden Nachfass-Lauf stoppen (nach dem aktuellen Schritt) */
export async function DELETE() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  state.shouldStop = true;
  return NextResponse.json({ stopping: true });
}
