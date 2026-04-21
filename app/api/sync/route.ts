import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accessToken = session.accessToken;
  if (!accessToken) {
    return NextResponse.json(
      { error: "No access token in session. Please sign out and sign in again to grant Calendar access." },
      { status: 401 }
    );
  }

  console.log("[sync] access token present, length:", accessToken.length);

  const body = await req.json();
  const { year, month } = body as { year: number; month: number };

  if (!year || !month || month < 1 || month > 12) {
    return NextResponse.json({ error: "year and month (1-12) required" }, { status: 400 });
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const timeMin = new Date(year, month - 1, 1).toISOString();
  const timeMax = new Date(year, month, 0, 23, 59, 59).toISOString();

  // Find the "Nachhilfe Plannung" calendar (falls back to primary)
  let calendarId = "primary";
  try {
    const calList = await calendar.calendarList.list();
    const match = calList.data.items?.find((cal) =>
      cal.summary?.toLowerCase().includes("nachhilfe")
    );
    if (match?.id) {
      calendarId = match.id;
      console.log("[sync] using calendar:", match.summary, calendarId);
    } else {
      console.log("[sync] 'Nachhilfe' calendar not found, using primary. Available:", calList.data.items?.map((c) => c.summary));
    }
  } catch (err) {
    console.warn("[sync] Could not list calendars, falling back to primary:", err);
  }

  let eventsRes;
  try {
    eventsRes = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 500,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sync] Calendar API error:", msg);
    return NextResponse.json({ error: `Calendar API error: ${msg}` }, { status: 500 });
  }

  const events = eventsRes.data.items ?? [];
  console.log("[sync] total events found:", events.length);
  console.log("[sync] event titles:", events.map((e) => e.summary));

  const students = await prisma.student.findMany({ where: { active: true } });

  const unmatched: string[] = [];
  type UpsertTask = { calEventId: string; studentId: string; date: Date; durationMin: number; amountCHF: number; notes: string | null };
  const tasks: UpsertTask[] = [];

  for (const event of events) {
    const title = event.summary ?? "";
    const startStr = event.start?.dateTime;
    const endStr = event.end?.dateTime;
    const calEventId = event.id;

    if (!startStr || !endStr || !calEventId) continue;

    const titleLower = title.toLowerCase();
    const student = students.find((s) => {
      const nameLower = s.name.toLowerCase();
      const escaped = nameLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(?<![a-z])${escaped}(?![a-z])`, "i");
      return regex.test(titleLower);
    });

    if (!student) {
      unmatched.push(title);
      continue;
    }

    const start = new Date(startStr);
    const end = new Date(endStr);
    const durationMin = Math.round((end.getTime() - start.getTime()) / 60000);
    const amountCHF = durationMin * student.ratePerMin;

    tasks.push({ calEventId, studentId: student.id, date: start, durationMin, amountCHF, notes: event.description ?? null });
  }

  await prisma.$transaction(
    tasks.map((t) =>
      prisma.session.upsert({
        where: { calEventId: t.calEventId },
        update: { date: t.date, durationMin: t.durationMin, amountCHF: t.amountCHF, month, year, notes: t.notes },
        create: { studentId: t.studentId, date: t.date, durationMin: t.durationMin, amountCHF: t.amountCHF, calEventId: t.calEventId, month, year, notes: t.notes },
      })
    )
  );

  return NextResponse.json({ synced: tasks.length, skipped: events.length - tasks.length - unmatched.length, unmatched, totalEvents: events.length });
}
