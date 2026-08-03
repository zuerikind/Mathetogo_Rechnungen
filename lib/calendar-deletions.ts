/**
 * Klärt für einzelne Kalendereinträge, ob sie wirklich gelöscht wurden.
 *
 * "Nicht in events.list enthalten" reicht dafür nicht: die Liste deckt nur das
 * Sync-Fenster (Monat ± 1 Tag) ab, ein weit verschobener Termin fehlt darin
 * genauso wie ein gelöschter. Deshalb wird jeder Kandidat einzeln geholt —
 * nur "cancelled" oder 404/410 gilt als Löschung. Jede andere Antwort und jeder
 * Fehler zählt bewusst als "nicht gelöscht": eine fälschlich als entfernt
 * gemeldete Lektion wäre schlimmer als eine übersehene.
 *
 * Bewusst nur gegen diese schmale Schnittstelle statt gegen den Google-Client —
 * so ist die Klassifizierung ohne Netzwerk prüfbar.
 */
export type CalendarEventReader = {
  events: {
    get(params: { calendarId: string; eventId: string }): Promise<{ data: { status?: string | null } }>;
  };
};

export type DeletionCandidate = { sessionId: string; calEventId: string };

export async function resolveDeletedCalendarEvents(
  calendar: CalendarEventReader,
  calendarId: string,
  candidates: DeletionCandidate[]
): Promise<Set<string>> {
  const deleted = new Set<string>();
  for (const candidate of candidates) {
    try {
      const res = await calendar.events.get({ calendarId, eventId: candidate.calEventId });
      if (res.data.status === "cancelled") deleted.add(candidate.sessionId);
    } catch (err: unknown) {
      const status =
        (err as { code?: number; status?: number })?.code ?? (err as { status?: number })?.status;
      if (status === 404 || status === 410) {
        deleted.add(candidate.sessionId);
      } else {
        console.warn("[sync] Kalenderstatus unklar, gilt als NICHT geloescht:", candidate.calEventId, err);
      }
    }
  }
  return deleted;
}
