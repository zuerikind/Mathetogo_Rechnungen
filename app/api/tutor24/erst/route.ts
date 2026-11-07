import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { ERST_MAX } from "@/lib/tutor24-bot";
import { tooSoonText } from "@/lib/tutor24-lock";
import { laptopOnline, offlineText } from "@/lib/tutor24-watch";
import { commandStatus, queueCommand, readLaptop } from "@/lib/tutor24-watch-db";

export const runtime = "nodejs";

/**
 * Knopf "Erst-Nachrichten jetzt senden" auf /kurse — lokal und online (rechnungen.mathetogo.xyz) gleich:
 * der Befehl kommt in tutor24_command, der Laptop-Bot holt ihn ab und prueft dort Modus, Tageslimit,
 * 8–20 Uhr, 429-Pause und laufende Laeufe (lib/tutor24-bot.ts, /erst). Braucht eine Sitzung (middleware.ts),
 * steht bewusst NICHT in lib/open-routes.ts.
 *
 * POST { anzahl?: 1–20 }  → { ok, id } oder { ok: false, text }
 * GET ?id=…               → { abgeholt, ergebnis }
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { anzahl?: unknown };
  const raw = body.anzahl;
  const n = raw === undefined || raw === null || raw === "" ? null : Number(raw);
  if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= ERST_MAX))
    return NextResponse.json({ ok: false, text: `Anzahl muss eine ganze Zahl von 1 bis ${ERST_MAX} sein (leer = bis zum Tageslimit).` }, { status: 400 });

  const laptop = await readLaptop();
  if (!laptopOnline(laptop, new Date())) return NextResponse.json({ ok: false, text: offlineText(laptop) });
  if (laptop?.abstandBis && new Date(laptop.abstandBis) > new Date())
    return NextResponse.json({ ok: false, text: `Nicht gestartet. ${tooSoonText(new Date(laptop.abstandBis))}` });
  const id = `web:${randomUUID()}`;
  await queueCommand(id, n ? `/erst ${n}` : "/erst");
  return NextResponse.json({ ok: true, id, text: "An den Laptop übergeben …" });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id.startsWith("web:")) return NextResponse.json({ error: "unbekannt" }, { status: 404 });
  const c = await commandStatus(id);
  if (!c) return NextResponse.json({ error: "unbekannt" }, { status: 404 });
  return NextResponse.json({ abgeholt: !!c.takenAt, ergebnis: c.result });
}
