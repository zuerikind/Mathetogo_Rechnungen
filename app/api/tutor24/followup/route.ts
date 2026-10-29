import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { academigoJobState, tutor24JobState } from "@/lib/automation-state";
import { MAX_SENDS_PER_DAY, needsReplyCheck, validateCourses } from "@/lib/tutor24-followup";
import {
  FOLLOWUP_DIR,
  RUN_LOG_PATH,
  loadCourses,
  loadSettings,
  readLog,
  readPreview,
  readStatus,
  requestStop,
  saveConfig,
  sendQueue,
  sentToday,
  setMark,
  assignToCourse,
  setRowStatus,
  setRowAnrede,
  writeStatus,
  type RunStatus,
} from "@/lib/tutor24-followup-store";
import { pidAlive, readTutor24Lock } from "@/lib/tutor24-lock";

export const runtime = "nodejs";

const IDLE: RunStatus = {
  running: false, pid: 0, mode: null, startedAt: null, finishedAt: null, progress: "", done: 0, total: 0, log: [], error: null,
};

/**
 * Laufstatus aus der Statusdatei. Laeufe sind eigene Prozesse (aus der App oder der
 * Kommandozeile gestartet) — sie ueberleben das Neuladen und Neustarten des Dev-Servers.
 */
function runStatus(): RunStatus {
  const s = readStatus() ?? IDLE;
  if (s.running && !pidAlive(s.pid))
    return { ...s, running: false, error: s.error ?? `Lauf-Prozess unerwartet beendet — Stand: ${s.progress || "Start"}. Startfehler ggf. in ${RUN_LOG_PATH}` };
  return s;
}

/** Wer tutor24 gerade blockiert, ausser einem Nachfass-Lauf (der wird als Lauf angezeigt). */
function blocker(status: RunStatus): string | null {
  if (tutor24JobState.running) return "Erst-Nachrichten-Automation";
  if (academigoJobState.running) return "Academigo-Automation";
  const lock = readTutor24Lock();
  if (lock && !(status.running && lock.pid === status.pid))
    return `${lock.owner} (seit ${new Date(lock.startedAt).toLocaleTimeString("de-CH")})`;
  return null;
}

/** Startet scripts/followup_group_offer.mts als eigenen, abgekoppelten Prozess. */
function startRun(mode: "preview" | "send" | "replies", max?: number): void {
  const flag = mode === "send" ? "--send" : mode === "replies" ? "--replies" : `--max ${Math.floor(Number(max))}`;
  mkdirSync(FOLLOWUP_DIR, { recursive: true });
  // Faengt Startfehler von npx ab; die Lauf-Meldungen selbst stehen in status.json.
  const out = openSync(RUN_LOG_PATH, "w");
  // Shell fuer npx.cmd unter Windows; der Befehl besteht nur aus festen Teilen und einer geprueften Zahl.
  const child = spawn(`npx tsx scripts/followup_group_offer.mts ${flag}`, {
    cwd: process.cwd(),
    detached: true,
    windowsHide: true,
    stdio: ["ignore", out, out],
    shell: true,
  });
  child.unref();
  closeSync(out);
  // Bis der Prozess selbst schreibt: als laufend anzeigen (pid der Shell, lebt so lange wie der Lauf).
  writeStatus({ ...IDLE, running: true, pid: child.pid ?? 0, mode, startedAt: new Date().toISOString(), progress: "Prozess startet …" });
}

/** GET — Laufstatus, Sperre, Faecher, Kurse, Vorschau, Protokoll, Sende-Kontingent */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = loadSettings();
  const courses = loadCourses();
  const { pending, queue, budget } = sendQueue(courses, settings);
  const status = runStatus();
  return NextResponse.json({
    state: { ...status, log: status.log.slice(-40) },
    blockedBy: blocker(status),
    settings,
    courses,
    // Ohne Nachrichtentext: den rendert der Tab live aus den Kursen.
    rows: readPreview().map(({ nachricht: _omit, ...r }) => r),
    log: readLog(),
    send: {
      limit: MAX_SENDS_PER_DAY,
      sentToday: sentToday(),
      budget,
      pending: pending.length,
      queue: queue.length,
      recipients: queue.map((r) => ({ id: r.conversation_id, name: r.name, kurs: r.course.name, anrede: r.anrede, problem: r.problem, text: r.text })),
    },
  });
}

type PostBody =
  | { action: "preview"; max?: number }
  | { action: "send" }
  | { action: "replies" }
  | { action: "config"; settings: unknown; courses: unknown }
  | { action: "status"; id: string; status: "send" | "skip" }
  | { action: "mark"; id: string; markierung: string }
  | { action: "assign"; id: string; kurs: string }
  | { action: "anrede"; id: string; anrede: "du" | "Sie" };

/** POST — Lauf starten, Faecher/Kurse speichern, Zeile umschalten oder Antwort markieren */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as PostBody;
  // Waehrend eines Laufs schreibt dieser CSV und Protokoll — keine parallelen Aenderungen.
  const status = runStatus();
  if (status.running) return NextResponse.json({ error: "Ein Nachfass-Lauf ist aktiv." }, { status: 409 });

  try {
    if (body.action === "config") {
      return NextResponse.json(saveConfig({ settings: body.settings, courses: body.courses }));
    }
    if (body.action === "status") {
      if (body.status !== "send" && body.status !== "skip") throw new Error("Status muss send oder skip sein.");
      setRowStatus(String(body.id), body.status);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "anrede") {
      if (body.anrede !== "du" && body.anrede !== "Sie") throw new Error("Anrede muss du oder Sie sein.");
      setRowAnrede(String(body.id), body.anrede);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "assign") {
      assignToCourse(String(body.id), String(body.kurs));
      return NextResponse.json({ ok: true });
    }
    if (body.action === "mark") {
      setMark(String(body.id), String(body.markierung));
      return NextResponse.json({ ok: true });
    }
    if (body.action === "preview" || body.action === "send" || body.action === "replies") {
      const blocked = blocker(status);
      if (blocked) return NextResponse.json({ error: `tutor24 ist belegt: ${blocked}` }, { status: 409 });
      const max = body.action === "preview" ? Math.floor(Number(body.max ?? 150)) : undefined;
      if (max !== undefined && !(max >= 1)) throw new Error("max. Konversationen muss ≥ 1 sein.");
      const invalid = body.action === "send" ? validateCourses(loadCourses()) : [];
      if (invalid.length) throw new Error(`Bitte zuerst die Kurse korrigieren: ${invalid.join(" ")}`);
      if (body.action === "send") {
        const { queue } = sendQueue();
        if (queue.length === 0) throw new Error("Nichts zu senden: keine Zeile mit aktivem passendem Kurs und status=send, oder Tageslimit erreicht.");
        const bad = queue.filter((r) => r.problem);
        if (bad.length) throw new Error(`Nichts gesendet — fehlerhafte Nachrichten: ${bad.map((r) => `${r.name}: ${r.problem}`).join("; ")}`);
      }
      if (body.action === "replies" && !readLog().some(needsReplyCheck))
        throw new Error("Nichts zu prüfen: alle Angeschriebenen haben geantwortet oder sind schon eingeordnet.");

      startRun(body.action, max);
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
  // Der Lauf ist ein anderer Prozess: er prueft die Stopp-Datei bei jedem Schritt.
  if (runStatus().running) requestStop();
  return NextResponse.json({ stopping: true });
}
