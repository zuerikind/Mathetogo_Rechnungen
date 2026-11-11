import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { academigoJobState, tutor24JobState } from "@/lib/automation-state";
import { MAX_SENDS_PER_DAY, NO_COURSE, needsReplyCheck, summarizeRunError, validateCourses } from "@/lib/tutor24-followup";
import {
  FOLLOWUP_DIR,
  RUN_LOG_PATH,
  loadCourses,
  loadSettings,
  loadLog,
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
import { earliestNext, pidAlive, readTutor24Lock, tooSoonText } from "@/lib/tutor24-lock";
import { DEFAULT_TIMES, normTimes } from "@/lib/tutor24-schedule";
import { tagesStand, zurichDay } from "@/lib/tutor24-rueckfragen";
import { activePause, loadAutopilot, localDay, nextScheduled, passView, readPassLog, runTimes, updateAutopilot, type AutoMode, type PassLog } from "@/lib/tutor24-autopilot";
import { laptopOnline } from "@/lib/tutor24-watch";
import { lastPasses, queueCommand, readLaptop } from "@/lib/tutor24-watch-db";
import { randomUUID } from "node:crypto";

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
  // Aeltere Statusdateien (vor der Kurzmeldung): Playwright-Protokoll in einen Satz + Details aufteilen.
  if (s.error && s.details === undefined && (s.error.length > 300 || s.error.includes("[2m"))) {
    const raw = s.error.replace(/^Login\/Seitenfehler: /, "").replace(/ — Stand: [\s\S]*$/, "");
    const sum = summarizeRunError(raw, "other", s.progress, s.mode);
    return { ...s, error: sum.error, details: sum.details || null };
  }
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
function startRun(mode: "preview" | "send" | "replies", max?: number, courseId?: string): void {
  const flag =
    (mode === "send" ? "--send" : mode === "replies" ? "--replies" : `--max ${Math.floor(Number(max))}`) +
    (courseId ? ` --course ${courseId}` : "");
  mkdirSync(FOLLOWUP_DIR, { recursive: true });
  // Faengt Startfehler von npx ab; die Lauf-Meldungen selbst stehen in status.json.
  const out = openSync(RUN_LOG_PATH, "w");
  // Shell fuer npx.cmd unter Windows; der Befehl besteht nur aus festen Teilen, einer geprueften Zahl
  // und einer Kurs-ID, die in courses.json steht und nur [A-Za-z0-9_-] enthaelt (siehe POST).
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

/** Uebersicht auf /kurse: Laptop, heutige Zahlen mit Limit, naechster geplanter Durchgang, 429-Pause. */
async function overview(passes: PassLog[], settings: ReturnType<typeof loadSettings>) {
  const now = new Date();
  const today = localDay(now);
  const todays = passes.filter((p) => localDay(new Date(p.start)) === today);
  const sum = (f: (p: PassLog) => number) => todays.reduce((n, p) => n + f(p), 0);
  const laptop = await readLaptop().catch(() => null);
  const pause = activePause(passes, now);
  return {
    laptop: laptop ? { at: laptop.at, online: laptopOnline(laptop, now) } : null,
    heute: {
      erst: await sentToday(now, "erst"),
      erstLimit: settings.autoErstLimit,
      nachfassen: await sentToday(now),
      nachfassenLimit: settings.autoNachfassLimit,
      antworten: sum((p) => p.antworten),
      // Probe: was heute gesendet worden waere
      erstWuerde: sum((p) => p.erst.wuerde),
      nachfassenWuerde: sum((p) => p.nachfassen.wuerde),
    },
    // online (Vercel) kennt nur der Laptop die eingestellten Zeiten: aus seinem Lebenszeichen
    naechster: nextScheduled(pause ?? now, process.env.VERCEL ? (normTimes(laptop?.zeiten) ?? DEFAULT_TIMES) : runTimes()).toISOString(),
    pauseBis: pause?.toISOString() ?? null,
    // Mindestabstand 2 h: lokal aus der Datei, online aus dem Lebenszeichen des Laptops
    abstandBis: earliestNext(now)?.toISOString() ?? (laptop?.abstandBis && new Date(laptop.abstandBis) > now ? laptop.abstandBis : null),
  };
}

/** GET — Laufstatus, Sperre, Faecher, Kurse, Vorschau, Protokoll, Sende-Kontingent */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = loadSettings();
  const courses = loadCourses();
  const { pending, queue, budget, log, leads } = await sendQueue(courses, settings, new Date());
  const status = runStatus();
  // Laptop: Datei; online (Vercel, keine Datei): dieselben Protokolle aus der Datenbank (tutor24_run.daten)
  const filePasses = readPassLog(200);
  const passes = filePasses.length ? filePasses : await lastPasses(200).catch(() => []);
  return NextResponse.json({
    state: { ...status, log: status.log.slice(-40) },
    blockedBy: blocker(status),
    settings,
    courses,
    // Ohne Nachrichtentext: den rendert der Tab live aus den Kursen.
    rows: readPreview().map(({ nachricht: _omit, ...r }) => r),
    log,
    leads,
    autopilot: { ...loadAutopilot(), telegramOffset: undefined, durchgaenge: passes.slice(-60).reverse().map(passView) },
    // Rueckfragen per Telegram (lib/tutor24-rueckfragen.ts): Zaehler "in Folge freigegeben" fuer Omids Schalter-Entscheid
    rueckfragen: tagesStand(zurichDay(new Date())),
    uebersicht: await overview(passes, settings),
    send: {
      limit: MAX_SENDS_PER_DAY,
      sentToday: await sentToday(),
      budget,
      pending: pending.length,
      queue: queue.length,
      // Alle offenen, nicht nur das Tageskontingent: der Tab rechnet pro ausgewaehltem Kurs.
      recipients: pending.map((r) => ({ id: r.conversation_id, name: r.name, kurs: r.course?.name ?? "ohne Kurs", courseId: r.course?.id ?? NO_COURSE, anrede: r.anrede, problem: r.problem, text: r.text })),
    },
  });
}

type PostBody =
  | { action: "preview"; max?: number }
  | { action: "send"; courseId?: string }
  | { action: "replies"; courseId?: string }
  | { action: "config"; settings: unknown; courses: unknown }
  | { action: "status"; id: string; status: "send" | "skip" }
  | { action: "mark"; id: string; markierung: string }
  | { action: "assign"; id: string; kurs: string }
  | { action: "anrede"; id: string; anrede: "du" | "Sie" }
  | { action: "autopilot"; modus: AutoMode };

/** POST — Lauf starten, Faecher/Kurse speichern, Zeile umschalten oder Antwort markieren */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as PostBody;
  // Automatik-Schalter (Notbremse) auch waehrend eines Laufs: "aus" haelt den laufenden Durchgang vor der naechsten Nachricht an.
  if (body.action === "autopilot") {
    if (body.modus !== "aus" && body.modus !== "probe" && body.modus !== "an") return NextResponse.json({ error: "Modus muss aus, probe oder an sein." }, { status: 400 });
    // Online (Vercel) liegt der Schalter nicht hier, sondern auf dem Laptop: "aus" geht als /stop an ihn (gilt auch,
    // wenn er gerade aus ist — vor dem naechsten Durchgang); Probe/Ein nur lokal oder per Telegram /enable.
    if (process.env.VERCEL) {
      if (body.modus !== "aus") return NextResponse.json({ error: "Online nicht möglich: Probe/Ein auf dem Laptop (/kurse lokal) oder per Telegram /enable." }, { status: 409 });
      await queueCommand(`web:${randomUUID()}`, "/stop");
      return NextResponse.json({ ok: true, modus: "aus" });
    }
    const next = updateAutopilot({ modus: body.modus, ...(body.modus === "aus" ? {} : { gestoppt: null, letzterFehler: null }) });
    if (body.modus === "aus" && runStatus().running) requestStop();
    return NextResponse.json({ ok: true, modus: next.modus });
  }
  // Waehrend eines Laufs schreibt dieser CSV und Protokoll — keine parallelen Aenderungen.
  const status = runStatus();
  if (status.running) return NextResponse.json({ error: "Ein Nachfass-Lauf ist aktiv." }, { status: 409 });

  try {
    if (body.action === "config") {
      return NextResponse.json(await saveConfig({ settings: body.settings, courses: body.courses }));
    }
    if (body.action === "status") {
      if (body.status !== "send" && body.status !== "skip") throw new Error("Status muss send oder skip sein.");
      await setRowStatus(String(body.id), body.status);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "anrede") {
      if (body.anrede !== "du" && body.anrede !== "Sie") throw new Error("Anrede muss du oder Sie sein.");
      await setRowAnrede(String(body.id), body.anrede);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "assign") {
      await assignToCourse(String(body.id), String(body.kurs));
      return NextResponse.json({ ok: true });
    }
    if (body.action === "mark") {
      await setMark(String(body.id), String(body.markierung));
      return NextResponse.json({ ok: true });
    }
    if (body.action === "preview" || body.action === "send" || body.action === "replies") {
      const blocked = blocker(status);
      if (blocked) return NextResponse.json({ error: `tutor24 ist belegt: ${blocked}` }, { status: 409 });
      const soon = earliestNext();
      if (soon) return NextResponse.json({ error: `Nicht gestartet. ${tooSoonText(soon)}` }, { status: 409 });
      const max = body.action === "preview" ? Math.floor(Number(body.max ?? 150)) : undefined;
      if (max !== undefined && !(max >= 1)) throw new Error("max. Konversationen muss ≥ 1 sein.");
      const courseId = body.action === "preview" ? undefined : body.courseId ? String(body.courseId) : undefined;
      if (courseId && courseId !== NO_COURSE && (!/^[\w-]+$/.test(courseId) || !loadCourses().some((c) => c.id === courseId)))
        throw new Error("Unbekannter Kurs.");
      const invalid = body.action === "send" ? validateCourses(loadCourses()) : [];
      if (invalid.length) throw new Error(`Bitte zuerst die Kurse korrigieren: ${invalid.join(" ")}`);
      if (body.action === "send") {
        const { queue } = await sendQueue(undefined, undefined, undefined, courseId);
        if (queue.length === 0) throw new Error("Nichts zu senden: keine Zeile mit aktivem passendem Kurs und status=send, oder Tageslimit erreicht.");
        const bad = queue.filter((r) => r.problem);
        if (bad.length) throw new Error(`Nichts gesendet — fehlerhafte Nachrichten: ${bad.map((r) => `${r.name}: ${r.problem}`).join("; ")}`);
      }
      if (body.action === "replies" && !(await loadLog()).some((r) => needsReplyCheck(r) && (!courseId || r.kurs === courseId)))
        throw new Error("Nichts zu prüfen: alle Angeschriebenen haben geantwortet oder sind schon eingeordnet.");

      startRun(body.action, max, courseId);
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
