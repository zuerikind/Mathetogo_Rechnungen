import { NextRequest, NextResponse } from "next/server";
import { notify } from "@/lib/tutor24-autopilot";
import { secretOk } from "@/lib/open-routes";
import { START_BUTTON, currentCheck, watchDecision, zurichTime } from "@/lib/tutor24-watch";
import { markReminder, readLaptop, readReminders, runsSince } from "@/lib/tutor24-watch-db";

export const runtime = "nodejs";

/**
 * Waechter: GitHub Actions (.github/workflows/tutor24-watch.yml) ruft das zu den Pruefzeiten auf.
 * Ohne Anmeldung erreichbar (middleware.ts), geschuetzt mit "Authorization: Bearer <WATCH_SECRET>".
 * Schickt hoechstens eine Erinnerung pro Pruefzeit; Entscheidung: lib/tutor24-watch.ts
 */
async function watch(req: NextRequest) {
  const secret = process.env.WATCH_SECRET;
  if (!secret || !secretOk(req.headers.get("authorization"), `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const check = currentCheck(now);
  if (!check) return NextResponse.json({ ok: true, check: null });
  const [laptop, runs, alreadySent] = await Promise.all([readLaptop(), runsSince(zurichTime(check.day, 0)), readReminders()]);
  const decision = watchDecision({ now, laptop, runs, alreadySent });
  if (decision) {
    // Erst merken, dann senden: ein zweiter Aufruf (Sommer-/Winterzeit-Doppel) schickt nicht nochmals.
    await markReminder(decision.key);
    await notify(decision.text, undefined, false, START_BUTTON);
  }
  return NextResponse.json({ ok: true, check: check.key, reminder: decision?.text ?? null });
}

export const GET = watch;
export const POST = watch;
