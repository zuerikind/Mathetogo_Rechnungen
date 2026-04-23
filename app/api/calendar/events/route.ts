import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { auth } from "@/auth";

function pickCalendarId(items: { id?: string | null; summary?: string | null }[] | undefined): string {
  const match = items?.find((c) => c.summary?.toLowerCase().includes("nachhilfe"));
  return match?.id ?? "primary";
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accessToken = session.accessToken;
  if (!accessToken) {
    return NextResponse.json(
      { error: "Kein Google Access Token vorhanden. Bitte erneut anmelden." },
      { status: 401 }
    );
  }

  const year = Number(req.nextUrl.searchParams.get("year"));
  const month = Number(req.nextUrl.searchParams.get("month"));
  if (!year || !month || month < 1 || month > 12) {
    return NextResponse.json({ error: "year und month (1-12) sind erforderlich." }, { status: 400 });
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const timeMin = new Date(year, month - 1, 1).toISOString();
  const timeMax = new Date(year, month, 0, 23, 59, 59).toISOString();

  let calendarId = "primary";
  try {
    const calList = await calendar.calendarList.list();
    calendarId = pickCalendarId(calList.data.items);
  } catch {
    calendarId = "primary";
  }

  try {
    const eventsRes = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 500,
    });

    const events = (eventsRes.data.items ?? []).map((e) => ({
      id: e.id ?? "",
      title: e.summary ?? "(Ohne Titel)",
      start: e.start?.dateTime ?? e.start?.date ?? null,
      end: e.end?.dateTime ?? e.end?.date ?? null,
      description: e.description ?? null,
      location: e.location ?? null,
      allDay: Boolean(e.start?.date && !e.start?.dateTime),
    }));

    return NextResponse.json({
      year,
      month,
      calendarId,
      totalEvents: events.length,
      events,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Kalender konnte nicht geladen werden: ${msg}` }, { status: 500 });
  }
}
