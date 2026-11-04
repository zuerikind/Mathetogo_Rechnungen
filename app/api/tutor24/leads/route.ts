import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { loadCourses, loadLog, loadSettings } from "@/lib/tutor24-followup-store";
import { interestList, updateLeads } from "@/lib/tutor24-leads";

export const runtime = "nodejs";

/** GET ?ignorierte=1 — Interessentenliste pro Kursgruppe + Fach, Trichter pro Kurs */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const courses = loadCourses();
  const list = await interestList(courses, loadSettings(), await loadLog(), new Date(), req.nextUrl.searchParams.get("ignorierte") === "1");
  return NextResponse.json({ ...list, courses: courses.map((c) => ({ id: c.id, name: c.name, active: c.active, gruppe: c.gruppe, fach: c.fach })) });
}

/** PATCH { ids, status?: "offen" | "ignoriert", einzelunterricht?: boolean, freigabeKursId?: string | null } */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown; status?: unknown; einzelunterricht?: unknown; freigabeKursId?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  const freigabe = body.freigabeKursId === null ? null : typeof body.freigabeKursId === "string" ? body.freigabeKursId : undefined;
  if (freigabe && !loadCourses().some((c) => c.id === freigabe)) return NextResponse.json({ error: "Unbekannter Kurs." }, { status: 400 });
  const count = await updateLeads(ids, {
    status: body.status === "offen" || body.status === "ignoriert" ? body.status : undefined,
    einzelunterricht: typeof body.einzelunterricht === "boolean" ? body.einzelunterricht : undefined,
    freigabeKursId: freigabe,
  });
  return NextResponse.json({ count });
}
