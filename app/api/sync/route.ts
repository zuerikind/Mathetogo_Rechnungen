import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { pruneStaleInvoicesInScope } from "@/lib/invoice-stale";
import { zurichYearMonth } from "@/lib/month-math";
import { prisma } from "@/lib/prisma";
import { rateAtDate, type RateHistoryEntry } from "@/lib/rate-history";
import { auth } from "@/auth";

/** One pool slot + long tx: concurrent /api/sync causes P2024 on the second request. */
let syncDbChain = Promise.resolve();

function runSyncDbSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = syncDbChain.then(() => fn());
  syncDbChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

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
  const { year, month, pruneOrphans } = body as {
    year: number;
    month: number;
    /** Dangerous: delete DB sessions missing in Google result. Defaults OFF for safety. */
    pruneOrphans?: boolean;
  };

  if (!year || !month || month < 1 || month > 12) {
    return NextResponse.json({ error: "year and month (1-12) required" }, { status: 400 });
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  // Query a slightly wider range to avoid month-edge misses caused by timezone conversion.
  // We then strictly filter by local event date below.
  const rangeStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
  rangeStart.setDate(rangeStart.getDate() - 1);
  const rangeEnd = new Date(year, month, 1, 0, 0, 0, 0);
  rangeEnd.setDate(rangeEnd.getDate() + 1);
  const timeMin = rangeStart.toISOString();
  const timeMax = rangeEnd.toISOString();

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
      timeZone: "Europe/Zurich",
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

  return runSyncDbSerialized(async () => {
    const students = await prisma.student.findMany({ where: { active: true } });
    const rateHistoryRows = await prisma.studentRateHistory.findMany({
      where: { studentId: { in: students.map((s) => s.id) } },
      select: { studentId: true, ratePerMin: true, effectiveFrom: true },
    });
    const rateHistoryByStudent = new Map<string, RateHistoryEntry[]>();
    for (const row of rateHistoryRows) {
      const list = rateHistoryByStudent.get(row.studentId) ?? [];
      list.push({ ratePerMin: row.ratePerMin, effectiveFrom: row.effectiveFrom });
      rateHistoryByStudent.set(row.studentId, list);
    }

    const unmatched: string[] = [];
    type UpsertTask = {
      calEventId: string;
      studentId: string;
      date: Date;
      durationMin: number;
      amountCHF: number;
      notes: string | null;
      month: number;
      year: number;
    };
    const tasks: UpsertTask[] = [];
    const eventIds = events.map((event) => event.id).filter((id): id is string => typeof id === "string");
    const existingByEventId = new Map(
      (
        await prisma.session.findMany({
          where: { calEventId: { in: eventIds } },
          select: { calEventId: true, durationMin: true, amountCHF: true },
        })
      )
        .filter((s): s is { calEventId: string; durationMin: number; amountCHF: number } => typeof s.calEventId === "string")
        .map((s) => [s.calEventId, s] as const)
    );

    for (const event of events) {
      const title = event.summary ?? "";
      const startStr = event.start?.dateTime ?? null;
      const endStr = event.end?.dateTime ?? null;
      const calEventId = event.id;

      if (!startStr || !endStr || !calEventId) continue;

      const titleLower = title.toLowerCase();
      const matches = students.filter((s) => {
        const nameLower = s.name.toLowerCase();
        const escaped = nameLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`(?<![a-z])${escaped}(?![a-z])`, "i");
        return regex.test(titleLower);
      });

      if (matches.length === 0) {
        unmatched.push(title);
        continue;
      }
      if (matches.length > 1) {
        // Ambiguous: never guess which student (and thus which tariff) applies.
        unmatched.push(`${title} (mehrdeutig: ${matches.map((s) => s.name).join(", ")})`);
        continue;
      }
      const student = matches[0];

      const start = new Date(startStr);
      const end = new Date(endStr);
      // Bucket by Zurich calendar month — server TZ (UTC on Vercel) shifts midnight events.
      const eventYm = zurichYearMonth(start);
      if (eventYm.month !== month || eventYm.year !== year) continue;
      const durationMin = Math.round((end.getTime() - start.getTime()) / 60000);
      const existingSession = existingByEventId.get(calEventId);
      // New sessions get the tariff effective on the lesson date, not today's.
      let amountCHF = durationMin * rateAtDate(rateHistoryByStudent.get(student.id) ?? [], student.ratePerMin, start);
      if (existingSession) {
        if (existingSession.durationMin > 0) {
          // Keep historical session rate on re-syncs so tariff changes with effective dates are not overwritten.
          const historicalRate = existingSession.amountCHF / existingSession.durationMin;
          amountCHF = durationMin * historicalRate;
        } else {
          amountCHF = existingSession.amountCHF;
        }
      }
      amountCHF = Math.round(amountCHF * 100) / 100;

      tasks.push({
        calEventId,
        studentId: student.id,
        date: start,
        durationMin,
        amountCHF,
        notes: event.description ?? null,
        month: eventYm.month,
        year: eventYm.year,
      });
    }

    const keepIds = Array.from(new Set(tasks.map((t) => t.calEventId)));
    // Safety default: never delete automatically unless explicitly requested.
    // Also skip pruning while events are unmatched: a renamed/deactivated student
    // would otherwise lose real historical sessions.
    const allowPruneOrphans = pruneOrphans === true && unmatched.length === 0;
    const pruneSkippedUnmatched = pruneOrphans === true && unmatched.length > 0;

    // Default interactive transaction timeout is too low for a full month of upserts + deleteMany
    // (leads to P2028 "Transaction not found" when Prisma closes the tx mid-loop).
    const removed = await prisma.$transaction(
      async (tx) => {
        for (const t of tasks) {
          await tx.session.upsert({
            where: { calEventId: t.calEventId },
            update: {
              // studentId included so corrected event titles reassign the session.
              studentId: t.studentId,
              date: t.date,
              durationMin: t.durationMin,
              amountCHF: t.amountCHF,
              month: t.month,
              year: t.year,
              notes: t.notes,
            },
            create: {
              studentId: t.studentId,
              date: t.date,
              durationMin: t.durationMin,
              amountCHF: t.amountCHF,
              calEventId: t.calEventId,
              month: t.month,
              year: t.year,
              notes: t.notes,
            },
          });
        }

        if (!allowPruneOrphans) {
          return { count: 0 };
        }
        // Remove calendar-backed sessions for this month that no longer exist in Google.
        // Manual sessions (calEventId = null) are never touched.
        // Do not scope by affectedStudentIds — students with zero calendar events this
        // sync must still lose orphaned DB rows (e.g. cancelled lesson removed from Google).
        // Sessions of deactivated students are never pruned — their events can no
        // longer match, so they would always look like orphans.
        if (events.length === 0 || keepIds.length === 0) {
          return tx.session.deleteMany({
            where: { year, month, calEventId: { not: null }, student: { active: true } },
          });
        }
        return tx.session.deleteMany({
          where: {
            year,
            month,
            calEventId: { not: null, notIn: keepIds },
            student: { active: true },
          },
        });
      },
      { maxWait: 20_000, timeout: 180_000 }
    );

    let staleInvoicesRemoved = 0;
    if (allowPruneOrphans) {
      staleInvoicesRemoved = await pruneStaleInvoicesInScope({ year, month });
    }

    return NextResponse.json({
      synced: tasks.length,
      removed: removed.count,
      staleInvoicesRemoved,
      skipped: events.length - tasks.length - unmatched.length,
      unmatched,
      pruneSkippedUnmatched,
      totalEvents: events.length,
    });
  });
}
