import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { ANREDE_WAHL, BATCH_MAX, addresseeFor, loadBatch, saveBatch, sendBlock, type AnredeWahl } from "@/lib/tutor24-batch";
import { FOLLOWUP_DIR } from "@/lib/tutor24-followup-store";
import { earliestNext, lastRunEnd, pidAlive, readTutor24Lock, tooSoonText, AUTOPILOT_LOCK_PATH } from "@/lib/tutor24-lock";
import { RATE_LIMIT_TEXT, activePause, fmtZurich, readPassLog } from "@/lib/tutor24-autopilot";

export const runtime = "nodejs";

/**
 * Batch von Hand (Reiter "Batch" auf /kurse, nur auf dem Laptop): vorbereiten → Vorschau → ausgewählte senden.
 * Laeufe sind eigene Prozesse (scripts/batch.mts); hier nur Start, Stand und Auswahl.
 */
function state() {
  const b = loadBatch();
  const laeuft = !!b && (b.zustand === "vorbereiten" || b.zustand === "sendet") && pidAlive(b.pid);
  const now = new Date();
  const pause = activePause(readPassLog(50), now);
  const earliest = earliestNext(now);
  return {
    batch: b && !laeuft && (b.zustand === "vorbereiten" || b.zustand === "sendet") ? { ...b, zustand: "fehler" as const, fehler: b.fehler ?? "Lauf unerwartet beendet (siehe Protokoll unten)." } : b,
    laeuft,
    pause: pause ? `${RATE_LIMIT_TEXT} Pause bis ${fmtZurich(pause)}.` : null,
    vorbereitenGesperrt: pause ? "429-Pause" : earliest ? tooSoonText(earliest) : readTutor24Lock() || readTutor24Lock(AUTOPILOT_LOCK_PATH) ? "Es läuft gerade ein anderer tutor24-Lauf." : null,
    sendenGesperrt: pause ? "429-Pause" : sendBlock(b, now, lastRunEnd(), earliest),
  };
}

function startScript(flag: string, pid: (p: number) => void) {
  const out = openSync(join(FOLLOWUP_DIR, "batch-run.log"), "w");
  // Shell fuer npx.cmd unter Windows; der Befehl besteht nur aus festen Teilen und einer geprueften Zahl.
  const child = spawn(`npx tsx scripts/batch.mts ${flag}`, { cwd: process.cwd(), detached: true, windowsHide: true, stdio: ["ignore", out, out], shell: true });
  child.unref();
  closeSync(out);
  pid(child.pid ?? 0);
}

export async function GET() {
  if (!(await auth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.VERCEL) return NextResponse.json({ online: true });
  return NextResponse.json(state());
}

export async function POST(req: NextRequest) {
  if (!(await auth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.VERCEL) return NextResponse.json({ error: "Batch nur auf dem Laptop (localhost:3000/kurse)." }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; anzahl?: unknown; id?: string; ausgewaehlt?: boolean; anrede?: string };
  const s = state();
  if (s.laeuft) return NextResponse.json({ error: "Es läuft schon ein Batch." }, { status: 409 });

  if (body.action === "prepare") {
    const n = Number(body.anzahl);
    if (!(Number.isInteger(n) && n >= 1 && n <= BATCH_MAX)) return NextResponse.json({ error: `Anzahl 1 bis ${BATCH_MAX}.` }, { status: 400 });
    if (s.vorbereitenGesperrt) return NextResponse.json({ error: s.vorbereitenGesperrt }, { status: 409 });
    saveBatch({ zustand: "vorbereiten", pid: 0, gestartet: new Date().toISOString(), vorbereitetBis: null, fehler: null, items: [], log: ["Prozess startet …"] });
    startScript(`--prepare ${n}`, (pid) => {
      const b = loadBatch();
      if (b && b.pid === 0) saveBatch({ ...b, pid });
    });
    return NextResponse.json(state());
  }
  if (body.action === "send") {
    if (s.sendenGesperrt) return NextResponse.json({ error: s.sendenGesperrt }, { status: 409 });
    const b = loadBatch()!;
    saveBatch({ ...b, fehler: null, log: [...b.log, "Senden startet …"] });
    // Das Skript prueft selbst nochmals (Abstand, 429, Sperre) und setzt "sendet" mit seiner pid.
    startScript("--send", () => {});
    return NextResponse.json({ ...state(), gestartet: true });
  }

  const b = loadBatch();
  const item = b?.items.find((i) => i.id === body.id);
  if (!b || b.zustand !== "bereit" || !item || item.ergebnis) return NextResponse.json({ error: "Eintrag nicht (mehr) änderbar." }, { status: 400 });
  if (body.action === "select") item.ausgewaehlt = !!body.ausgewaehlt && !item.problem;
  else if (body.action === "remove") b.items = b.items.filter((i) => i !== item);
  else if (body.action === "anrede" && item.art === "nachfassen") {
    // Nachfassen: Anrede der Person in der Datenbank (Tutor24Lead), dann Text neu wie beim Senden (sendQueue)
    if (body.anrede !== "du" && body.anrede !== "unklar") return NextResponse.json({ error: "Nachfassen: du oder Sie." }, { status: 400 });
    const { prisma } = await import("@/lib/prisma");
    const { sendQueue } = await import("@/lib/tutor24-followup-store");
    const lead = await prisma.tutor24Lead.findFirst({ where: { conversationId: item.id } });
    if (!lead) return NextResponse.json({ error: "Person nicht in der Datenbank." }, { status: 400 });
    await prisma.tutor24Lead.update({ where: { id: lead.id }, data: body.anrede === "du" ? { anrede: "du", wer: "schueler" } : { anrede: "Sie", wer: lead.wer === "schueler" ? "unklar" : lead.wer } });
    const row = (await sendQueue()).pending.find((r) => r.conversation_id === item.id);
    if (!row) return NextResponse.json({ error: "Nachfassen nicht mehr fällig." }, { status: 400 });
    Object.assign(item, { anrede: body.anrede, text: row.text, problem: row.problem, ausgewaehlt: !row.problem });
  } else if (body.action === "anrede") {
    if (item.art !== "erst" || item.sprache !== "de" || !item.info || !ANREDE_WAHL.includes(body.anrede as AnredeWahl))
      return NextResponse.json({ error: "Anrede nur bei deutschen Erst-Nachrichten umstellbar." }, { status: 400 });
    // Neu zusammensetzen samt KI-Satz in der neuen Anrede (gleiche Pruefung wie beim Vorbereiten).
    const { composeFirstMessage } = await import("@/lib/tutor24");
    const m = await composeFirstMessage(item.info, () => {}, new Date(), "de", addresseeFor(body.anrede as AnredeWahl));
    Object.assign(item, {
      anrede: body.anrede, text: m.text, problem: m.problem, satz: m.satz, kursId: m.course?.id ?? null, hint: m.hint,
      block: m.course ? `Kursblock: ${m.course.name}` : m.hint ? "Kurs-Hinweis" : "ohne", ausgewaehlt: !m.problem,
    });
  } else return NextResponse.json({ error: "unbekannte Aktion" }, { status: 400 });
  saveBatch(b);
  return NextResponse.json(state());
}
