import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const STATUSES = ["offen", "kurs_angelegt", "ignoriert"] as const;
type Status = (typeof STATUSES)[number];
const WEEKS = 8;

/** Montag 00:00 der Woche von d. */
function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/**
 * GET ?status=offen|kurs_angelegt|ignoriert|alle (Standard offen)
 * Nachfrage ohne Kurs, gruppiert nach Kursgruppe × Fach, mit Anzahl pro Woche (letzte 8 Wochen).
 */
export async function GET(req: NextRequest) {
  if (!(await auth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const status = req.nextUrl.searchParams.get("status") ?? "offen";
  const rows = await prisma.courseDemand.findMany({
    where: status === "alle" ? {} : { status },
    select: { kursgruppe: true, fach: true, sicherheit: true, grund: true, createdAt: true, auszug: true, url: true, status: true },
    orderBy: { createdAt: "desc" },
  });
  const thisWeek = weekStart(new Date());
  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const d = new Date(thisWeek);
    d.setDate(d.getDate() - 7 * (WEEKS - 1 - i));
    return d;
  });
  const groups = new Map<string, {
    kursgruppe: string; fach: string; hoch: number; mittel: number; perWeek: number[];
    gruende: Record<string, number>; beispiele: Array<{ auszug: string; url: string; sicherheit: string }>;
  }>();
  for (const r of rows) {
    const key = `${r.kursgruppe}|${r.fach}`;
    const g = groups.get(key) ?? { kursgruppe: r.kursgruppe, fach: r.fach, hoch: 0, mittel: 0, perWeek: weeks.map(() => 0), gruende: {}, beispiele: [] };
    if (r.sicherheit === "hoch") g.hoch++;
    else g.mittel++;
    const w = weeks.findIndex((start, i) => r.createdAt >= start && (i === WEEKS - 1 || r.createdAt < weeks[i + 1]));
    if (w > -1) g.perWeek[w]++;
    g.gruende[r.grund] = (g.gruende[r.grund] ?? 0) + 1;
    if (g.beispiele.length < 5) g.beispiele.push({ auszug: r.auszug, url: r.url, sicherheit: r.sicherheit });
    groups.set(key, g);
  }
  return NextResponse.json({
    weeks: weeks.map((d) => d.toISOString()),
    groups: Array.from(groups.values()).sort((a, b) => b.hoch + b.mittel - (a.hoch + a.mittel)),
  });
}

/** PATCH { kursgruppe, fach, status } — alle offenen Eintraege dieser Zeile auf einmal (status "offen": alle wieder oeffnen). */
export async function PATCH(req: NextRequest) {
  if (!(await auth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { kursgruppe?: unknown; fach?: unknown; status?: unknown };
  const status = String(body.status) as Status;
  if (!STATUSES.includes(status) || typeof body.kursgruppe !== "string" || typeof body.fach !== "string")
    return NextResponse.json({ error: "kursgruppe, fach und status (offen | kurs_angelegt | ignoriert) nötig." }, { status: 400 });
  const { count } = await prisma.courseDemand.updateMany({
    where: { kursgruppe: body.kursgruppe, fach: body.fach, ...(status === "offen" ? {} : { status: "offen" }) },
    data: { status },
  });
  return NextResponse.json({ updated: count });
}
