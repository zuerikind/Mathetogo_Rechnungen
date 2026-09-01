import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import {
  autoResolvedIssueEventIds,
  parseExternalUpdatedAt,
  reconcileObservedIssue,
  type ObservedCalendarIssue,
} from "@/lib/calendar-sync-issues";
import {
  describeIntegrityFinding,
  findCalendarIntegrityIssues,
  INTEGRITY_REASONS,
  integrityIssuesToClose,
  integrityIssueStatus,
  isIntegrityReason,
  type IntegrityFinding,
} from "@/lib/calendar-integrity";
import { clearIncomeSummaryCache } from "@/lib/income-summary-cache";
import { detectInvoiceChangesInScope } from "@/lib/invoice-change-detection";
import {
  afterDeletionPending,
  CALENDAR_EVENT_SEEN_RESET,
  DELETION_CANDIDATE_WHERE,
} from "@/lib/pending-deletion-lifecycle";
import { DELIVERED_INVOICE_WHERE } from "@/lib/invoice-delivery";
import { pruneStaleInvoicesInScope } from "@/lib/invoice-stale";
import { zurichYearMonth } from "@/lib/month-math";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { rateAtDate, type RateHistoryEntry } from "@/lib/rate-history";
import { resolveDeletedCalendarEvents } from "@/lib/calendar-deletions";
import {
  nameMatchesTitle,
  preferMostSpecificMatch,
  suggestCloseStudentNames,
  type SyncUnmatchedEvent,
} from "@/lib/sync-unmatched";
import { auth } from "@/auth";

/** Kalenderabfragen pro Sync-Lauf fuer die Loeschpruefung — deckelt die Laufzeit. */
const PENDING_VERIFY_LIMIT = 50;

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
    const allStudents = await prisma.student.findMany({
      select: { id: true, name: true, active: true, ratePerMin: true },
    });
    const students = allStudents.filter((s) => s.active);
    const inactiveStudents = allStudents.filter((s) => !s.active);
    const activeNames = students.map((s) => s.name);

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

    const unmatched: SyncUnmatchedEvent[] = [];
    /**
     * Dieselben Befunde, aber mit allem, was zum Wiedererkennen noetig ist.
     * Der Sync-Response-Typ bleibt unveraendert; persistiert wird aus dieser Liste.
     */
    type IssueObservation = ObservedCalendarIssue & {
      title: string;
      startAt: Date | null;
      endAt: Date | null;
      calendarId: string;
      details: Record<string, unknown> | null;
    };
    const issueObservations: IssueObservation[] = [];

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
          select: { calEventId: true, studentId: true, durationMin: true, amountCHF: true },
        })
      )
        .filter(
          (s): s is { calEventId: string; studentId: string; durationMin: number; amountCHF: number } =>
            typeof s.calEventId === "string"
        )
        .map((s) => [s.calEventId, s] as const)
    );

    for (const event of events) {
      const title = event.summary ?? "";
      const startStr = event.start?.dateTime ?? null;
      const endStr = event.end?.dateTime ?? null;
      const calEventId = event.id;

      if (!startStr || !endStr || !calEventId) continue;

      const start = new Date(startStr);
      const end = new Date(endStr);
      // Bucket by Zurich calendar month — server TZ (UTC on Vercel) shifts midnight events.
      const eventYm = zurichYearMonth(start);
      // Buffer events outside the selected month: keep for prune IDs, skip match/unmatched UX.
      if (eventYm.month !== month || eventYm.year !== year) continue;

      const titleLower = title.toLowerCase();
      const matches = preferMostSpecificMatch(
        students.filter((s) => nameMatchesTitle(s.name, titleLower))
      );

      /** Einmal notieren, zweimal gebraucht: Sync-Antwort und Dashboard-Gedaechtnis. */
      const noteUnmatched = (
        item: Omit<SyncUnmatchedEvent, "title" | "start">,
        details: Record<string, unknown> | null
      ) => {
        unmatched.push({ title, start: startStr, ...item });
        issueObservations.push({
          externalEventId: calEventId,
          externalUpdatedAt: parseExternalUpdatedAt(event.updated),
          reason: item.reason,
          title,
          startAt: start,
          endAt: end,
          calendarId,
          details,
        });
      };

      if (matches.length === 0) {
        const inactiveMatches = preferMostSpecificMatch(
          inactiveStudents.filter((s) => nameMatchesTitle(s.name, titleLower))
        );
        if (inactiveMatches.length > 0) {
          const names = inactiveMatches.map((s) => s.name);
          noteUnmatched({ reason: "inactive_match", inactiveStudents: names }, { inactiveStudents: names });
          continue;
        }
        const suggestions = suggestCloseStudentNames(title, activeNames);
        noteUnmatched(
          { reason: "no_match", ...(suggestions.length > 0 ? { suggestions } : {}) },
          suggestions.length > 0 ? { suggestions } : null
        );
        continue;
      }
      if (matches.length > 1) {
        // Ambiguous: never guess which student (and thus which tariff) applies.
        const names = matches.map((s) => s.name);
        noteUnmatched({ reason: "ambiguous", ambiguousStudents: names }, { ambiguousStudents: names });
        continue;
      }
      const student = matches[0];

      const durationMin = Math.round((end.getTime() - start.getTime()) / 60000);
      const existingSession = existingByEventId.get(calEventId);
      // New sessions get the tariff effective on the lesson date, not today's.
      let amountCHF = durationMin * rateAtDate(rateHistoryByStudent.get(student.id) ?? [], student.ratePerMin, start);
      // Nur beim SELBEN Schueler. Wird ein Kalendertitel korrigiert, haengt der
      // Upsert die Lektion um (siehe studentId unten) — dann muss der Tarif des
      // neuen Schuelers gelten, nicht der aus dem Betrag des alten abgeleitete.
      if (existingSession && existingSession.studentId === student.id) {
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

    // Keep ANY Google event id still returned for this query — matched or not.
    // That way unmatched titles do not block orphan deletion: sessions whose
    // Google event was deleted are removed, while sessions for unmatched titles
    // (event still present) are preserved.
    const googleEventIds = Array.from(new Set(eventIds));
    const allowPruneOrphans = pruneOrphans === true;

    // Lektionen in Monaten mit bereits ausgelieferter Rechnung werden nie gelöscht:
    // der Snapshot verweist auf sie, und die Rechnung ist ab dem Download unveränderlich.
    // Eine im Kalender gelöschte Lektion soll hier als Abweichung auffallen, nicht
    // stillschweigend die Belegkette zerreissen.
    const deliveredInvoices = await prisma.invoice.findMany({
      // Gesendet und bezahlt zaehlen mit: auch ohne Download ist die Rechnung raus,
      // ihre Lektionen duerfen nicht weggeprunt werden.
      where: { year, month, ...DELIVERED_INVOICE_WHERE },
      select: { studentId: true },
    });
    const deliveredStudentIds = deliveredInvoices.map((i) => i.studentId);
    // Familienrechnung: die Lektionen der Kinder stehen auf der Rechnung des Hauptschülers.
    const billedChildren =
      deliveredStudentIds.length > 0
        ? await prisma.student.findMany({
            where: { billedToId: { in: deliveredStudentIds } },
            select: { id: true },
          })
        : [];
    const protectedStudentIds = Array.from(
      new Set([...deliveredStudentIds, ...billedChildren.map((c) => c.id)])
    );
    const notDelivered =
      protectedStudentIds.length > 0 ? { studentId: { notIn: protectedStudentIds } } : {};

    // Default interactive transaction timeout is too low for a full month of upserts
    // (leads to P2028 "Transaction not found" when Prisma closes the tx mid-loop).
    await prisma.$transaction(
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
              // Der Termin ist wieder da — eine offene Loeschvormerkung ist damit
              // gegenstandslos, und ebenso ein frueheres "Behalten": verschwindet
              // er spaeter erneut, ist das ein neuer Vorgang und darf wieder
              // gemeldet werden. Greift auch, wenn er in einem anderen Monat
              // auftaucht: derselbe calEventId, der Upsert zieht die Zeile um.
              ...CALENDAR_EVENT_SEEN_RESET,
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

      },
      { maxWait: 20_000, timeout: 180_000 }
    );

    // Waisen werden nicht mehr geloescht, sondern zur Loeschung vorgemerkt.
    //
    // Frueher lief hier ein deleteMany ueber alles, was nicht in events.list stand.
    // Das war zu grob: das Sync-Fenster deckt nur Monat +/- 1 Tag ab, ein weit
    // verschobener Termin fehlt darin genauso wie ein geloeschter — und wurde
    // stillschweigend entfernt. Jetzt wird jeder Kandidat einzeln geprueft
    // (dieselbe Logik, die ausgelieferte Monate schon immer benutzt haben), und
    // nur eine nachgewiesene Loeschung fuehrt zur Vormerkung. Die Lektion bleibt
    // bis zur Bestaetigung bestehen und zaehlt weiter zum Betrag.
    let pendingMarked = 0;
    let pendingUnverified = 0;
    let pendingTotal = 0;
    if (allowPruneOrphans) {
      const candidates = await prisma.session.findMany({
        where: {
          year,
          month,
          // Manuelle Lektionen (calEventId = null) werden nie angetastet.
          ...(googleEventIds.length === 0
            ? { calEventId: { not: null } }
            : { calEventId: { not: null, notIn: googleEventIds } }),
          // Lektionen deaktivierter Schueler koennen nicht mehr matchen und saehen
          // deshalb immer wie Waisen aus.
          student: { active: true },
          // Ausgelieferte Monate laufen unveraendert ueber den H3-Guard und P5.
          ...notDelivered,
          // Schon vorgemerkte nicht erneut pruefen — und abgelehnte nie wieder,
          // bis der Termin erneut im Kalender auftaucht (pending-deletion-lifecycle).
          ...DELETION_CANDIDATE_WHERE,
        },
        select: { id: true, calEventId: true },
        orderBy: { date: "asc" },
      });

      // Eine Kalenderabfrage pro Kandidat: bei einem grossen Aufraeumen wuerde das
      // sonst in die 60-Sekunden-Grenze der Function laufen. Der Rest kommt beim
      // naechsten Lauf dran.
      const toVerify = candidates.slice(0, PENDING_VERIFY_LIMIT);
      pendingUnverified = candidates.length - toVerify.length;

      const confirmedDeleted = await resolveDeletedCalendarEvents(
        calendar,
        calendarId,
        toVerify.map((s) => ({ sessionId: s.id, calEventId: s.calEventId as string }))
      );
      if (confirmedDeleted.size > 0) {
        const marked = await prisma.session.updateMany({
          where: { id: { in: Array.from(confirmedDeleted) } },
          data: afterDeletionPending(new Date()),
        });
        pendingMarked = marked.count;
      }
      pendingTotal = await prisma.session.count({
        where: { year, month, pendingDeletionAt: { not: null } },
      });
    }

    // Entwurfs-Rechnungen bleiben erhalten, solange die Lektionen nur vorgemerkt
    // sind — sie sind ja weiterhin abrechenbar. Geprunt wird erst, wenn eine
    // Vormerkung bestaetigt wurde.
    let staleInvoicesRemoved = 0;
    if (allowPruneOrphans) {
      staleInvoicesRemoved = await pruneStaleInvoicesInScope({ year, month });
    }

    // ── Integritaetspruefung: erkennen, nichts anfassen ──────────────────────
    //
    // Bewusst WEDER an allowPruneOrphans NOCH an notDelivered gehaengt. Genau
    // diese Kopplung hat Leo, Elenor und Luca durchrutschen lassen: in jedem
    // Monat mit ausgelieferter Rechnung — also in allen, um die es beim Geld
    // geht — fand gar keine Pruefung mehr statt. Ausgelieferte Monate bleiben
    // unantastbar; geprueft werden sie trotzdem. Ein Fehler hier darf den
    // bereits committeten Kalenderabgleich nicht als Fehlschlag erscheinen
    // lassen, deshalb dieselbe Behandlung wie bei der Abweichungserkennung.
    let integrityFindings: IntegrityFinding[] = [];
    let integrityError: string | null = null;
    try {
      const monthSessions = await prisma.session.findMany({
        where: { year, month },
        select: {
          id: true,
          studentId: true,
          date: true,
          durationMin: true,
          amountCHF: true,
          calEventId: true,
          student: { select: { name: true } },
        },
      });
      integrityFindings = findCalendarIntegrityIssues({
        sessions: monthSessions.map((s) => ({
          id: s.id,
          studentId: s.studentId,
          studentName: s.student.name,
          date: s.date,
          durationMin: s.durationMin,
          amountCHF: s.amountCHF,
          calEventId: s.calEventId,
        })),
        googleEventIds: new Set(googleEventIds),
        deliveredStudentIds: new Set(protectedStudentIds),
      });

      for (const finding of integrityFindings) {
        issueObservations.push({
          externalEventId: finding.key,
          // Integritaetsbefunde haben keine Google-Version — der Zustand selbst
          // ist die Aussage, nicht eine Terminaenderung.
          externalUpdatedAt: null,
          reason: finding.type,
          title: describeIntegrityFinding(finding),
          startAt: finding.startAt,
          endAt: null,
          calendarId,
          details: {
            studentName: finding.studentName,
            sessionIds: finding.sessionIds,
            amountCHF: finding.amountCHF,
            parts: finding.parts,
            monthDelivered: finding.monthDelivered,
            year,
            month,
            // Nur zur Fehlersuche; die Oberflaeche zeigt sie nicht offen an.
            ...(finding.staleCalEventId ? { staleCalEventId: finding.staleCalEventId } : {}),
          },
        });
      }
    } catch (err: unknown) {
      integrityError = err instanceof Error ? err.message : String(err);
      console.error("[sync] Integritaetspruefung fehlgeschlagen:", err);
    }

    // Nicht zugeordnete Termine festhalten, damit sie den Request ueberleben und
    // neben den Loeschvormerkungen auf dem Dashboard erscheinen. Wie die
    // Abweichungserkennung unten reine Zusatzarbeit: der Kalenderabgleich ist
    // committet, ein Fehler hier darf ihn nicht als Fehlschlag erscheinen lassen.
    let issuesOpen = 0;
    try {
      const observedIds = issueObservations.map((o) => o.externalEventId);
      const stored = await prisma.calendarSyncIssue.findMany({
        where: { externalEventId: { in: observedIds } },
        select: { externalEventId: true, externalUpdatedAt: true, status: true, reason: true },
      });
      const storedById = new Map(stored.map((s) => [s.externalEventId, s]));
      const now = new Date();

      for (const observed of issueObservations) {
        const prior = storedById.get(observed.externalEventId) ?? null;
        // Integritaetsbefunde folgen einem eigenen Lebenszyklus: sie beschreiben
        // einen Zustand, kein Ereignis. Solange der Zustand besteht, bleibt der
        // Befund offen — ein voreiliges "Erledigt" darf ihn nicht dauerhaft
        // verstecken. Nur "Ignorieren" haelt.
        const next = isIntegrityReason(observed.reason)
          ? {
              status: integrityIssueStatus(prior?.status ?? null),
              reopened: prior?.status === "resolved",
            }
          : reconcileObservedIssue(prior, observed);
        await prisma.calendarSyncIssue.upsert({
          where: { externalEventId: observed.externalEventId },
          update: {
            status: next.status,
            reason: observed.reason,
            title: observed.title,
            startAt: observed.startAt,
            endAt: observed.endAt,
            calendarId: observed.calendarId,
            // DbNull, nicht undefined: undefined hiesse fuer Prisma "nicht aendern"
            // und liesse alte Vorschlaege stehen, wenn es diesmal keine mehr gibt.
            detailsJson: observed.details ?? Prisma.DbNull,
            externalUpdatedAt: observed.externalUpdatedAt,
            lastSeenAt: now,
            // Wieder geoeffnet: die alte Erledigung gilt nicht mehr. "Ignoriert"
            // bleibt unangetastet — reconcileObservedIssue laesst es nie wechseln.
            ...(next.reopened ? { resolvedAt: null } : {}),
          },
          create: {
            externalEventId: observed.externalEventId,
            status: next.status,
            reason: observed.reason,
            title: observed.title,
            startAt: observed.startAt,
            endAt: observed.endAt,
            calendarId: observed.calendarId,
            detailsJson: observed.details ?? Prisma.DbNull,
            externalUpdatedAt: observed.externalUpdatedAt,
            firstSeenAt: now,
            lastSeenAt: now,
          },
        });
      }

      // Titel korrigiert und die Lektion ist angelegt → der Befund ist erledigt,
      // ohne dass jemand klicken muss.
      const matchedEventIds = new Set(tasks.map((t) => t.calEventId));
      const openIssues = await prisma.calendarSyncIssue.findMany({
        where: { status: "open" },
        select: { externalEventId: true },
      });
      const autoResolved = autoResolvedIssueEventIds(
        openIssues.map((i) => i.externalEventId),
        matchedEventIds
      );
      if (autoResolved.length > 0) {
        await prisma.calendarSyncIssue.updateMany({
          where: { externalEventId: { in: autoResolved } },
          data: { status: "resolved", resolvedAt: now, lastSeenAt: now },
        });
      }

      // Behobene Integritaetsbefunde schliessen sich selbst: die doppelte Zeile
      // ist weg, der Termin wieder da — dann soll keine Warnung stehen bleiben.
      // Nur fuer den gerade geprueften Monat: fuer andere Monate liegen in
      // diesem Lauf keine Kalenderdaten vor, "nicht gesehen" waere kein Beweis.
      if (integrityError === null) {
        const monthStart = new Date(year, month - 1, 1);
        const monthEnd = new Date(year, month, 1);
        const openIntegrity = await prisma.calendarSyncIssue.findMany({
          where: {
            status: "open",
            reason: { in: INTEGRITY_REASONS },
            startAt: { gte: monthStart, lt: monthEnd },
          },
          select: { externalEventId: true },
        });
        const behoben = integrityIssuesToClose(
          openIntegrity.map((i) => i.externalEventId),
          new Set(integrityFindings.map((f) => f.key))
        );
        if (behoben.length > 0) {
          await prisma.calendarSyncIssue.updateMany({
            where: { externalEventId: { in: behoben } },
            data: { status: "resolved", resolvedAt: now, lastSeenAt: now },
          });
        }
      }

      issuesOpen = await prisma.calendarSyncIssue.count({ where: { status: "open" } });
    } catch (err) {
      console.error("[sync] Kalender-Befunde konnten nicht gespeichert werden:", err);
    }

    // Der Sync hat Lektionen angelegt, umgehaengt oder vorgemerkt — die zwischen-
    // gespeicherte Einkommensantwort ist damit ueberholt. Ohne das zeigt das
    // Dashboard direkt nach dem Sync bis zu 20 Sekunden lang alte Summen neben
    // den neuen Zahlen der Seite.
    clearIncomeSummaryCache();

    // Ab hier kommt nur noch Zusatzarbeit: Der Kalenderabgleich ist committet, die
    // Sessions stehen. Ein Fehler in der Abweichungserkennung darf diese bereits
    // erledigte Arbeit nicht als Fehlschlag erscheinen lassen — er wird geloggt
    // und in der Antwort markiert, statt den Sync mit 500 zu beenden.
    let detectionChecked: number | null = null;
    let detectionFlagged: number | null = null;
    let detectionError: string | null = null;
    try {
      // Der H3-Guard bewahrt die DB-Zeilen ausgelieferter Monate — dadurch sieht ein
      // reiner DB-Vergleich eine im Kalender gelöschte Lektion nicht. Deshalb hier
      // die Kandidaten sammeln und ihren Kalenderstatus einzeln klären.
      let calendarDeletedSessionIds = new Set<string>();
      if (protectedStudentIds.length > 0) {
        const kept = await prisma.session.findMany({
          where: {
            year,
            month,
            studentId: { in: protectedStudentIds },
            calEventId: { not: null, notIn: googleEventIds },
          },
          select: { id: true, calEventId: true },
        });
        calendarDeletedSessionIds = await resolveDeletedCalendarEvents(
          calendar,
          calendarId,
          kept.map((s) => ({ sessionId: s.id, calEventId: s.calEventId as string }))
        );
      }

      // Nach dem Abgleich prüfen, ob ausgelieferte Rechnungen dieses Monats vom
      // heutigen Stand abweichen. Nur erkennen und protokollieren.
      const changes = await detectInvoiceChangesInScope({
        year,
        month,
        trigger: "Kalender-Sync",
        actor: session.user?.email ?? "system",
        calendarDeletedSessionIds,
      });
      detectionChecked = changes.checked;
      detectionFlagged = changes.flagged;
    } catch (err: unknown) {
      detectionError = err instanceof Error ? err.message : String(err);
      // Sichtbar loggen statt schlucken: sonst tauscht man einen falschen 500
      // gegen stille Blindheit — der Sync meldet Erfolg und niemand merkt, dass
      // ausgelieferte Rechnungen diesmal nicht geprüft wurden.
      console.error("[sync] Abweichungserkennung fehlgeschlagen:", err);
    }

    return NextResponse.json({
      synced: tasks.length,
      /** Zur Loeschung vorgemerkt in diesem Lauf (frueher: sofort geloescht). */
      pendingDeletions: pendingMarked,
      /** Offene Vormerkungen im Monat insgesamt — die warten auf eine Entscheidung. */
      pendingDeletionsTotal: pendingTotal,
      /** Kandidaten, die diesmal nicht mehr geprueft wurden (Limit). */
      pendingUnverified,
      staleInvoicesRemoved,
      invoicesChecked: detectionChecked,
      invoicesFlagged: detectionFlagged,
      /** null = Erkennung lief; Text = sie lief nicht, Sync selbst war erfolgreich. */
      detectionError,
      skipped: events.length - tasks.length - unmatched.length,
      unmatched,
      /** Offene, noch nicht entschiedene Kalender-Befunde insgesamt. */
      unmatchedOpenTotal: issuesOpen,
      /** Integritaetspruefung dieses Monats — reine Erkennung, nichts veraendert. */
      integrityOrphans: integrityFindings.filter((f) => f.type === "session_orphan").length,
      integrityDuplicates: integrityFindings.filter((f) => f.type === "duplicate_slot").length,
      /** null = Pruefung lief; Text = sie lief nicht, der Sync selbst war erfolgreich. */
      integrityError,
      totalEvents: events.length,
    });
  });
}
