"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { useGlobalIncomeSummary } from "@/hooks/useGlobalIncomeSummary";
import { getCurrentMonthYear, monthOptions } from "@/lib/ui-format";

type CalendarEventRow = {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  description: string | null;
  location: string | null;
  allDay: boolean;
};

type CalendarApiResponse = {
  events: CalendarEventRow[];
  totalEvents: number;
  error?: string;
};

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseEventStart(event: CalendarEventRow): Date | null {
  if (!event.start) return null;
  const parsed = new Date(event.start);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseEventEnd(event: CalendarEventRow): Date | null {
  if (!event.end) return null;
  const parsed = new Date(event.end);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatEventDuration(event: CalendarEventRow): string {
  if (event.allDay) return "Ganztagig";
  const start = parseEventStart(event);
  const end = parseEventEnd(event);
  if (!start || !end) return "";
  const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

export default function CalendarPage() {
  const { monthIncome, ytdIncome, loading: incomeLoading } = useGlobalIncomeSummary();
  const now = getCurrentMonthYear();
  const [month, setMonth] = useState(now.month);
  const [year, setYear] = useState(now.year);
  const [events, setEvents] = useState<CalendarEventRow[]>([]);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const loadEvents = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch(`/api/calendar/events?year=${year}&month=${month}`);
      const data = (await res.json()) as CalendarApiResponse;
      if (!res.ok) throw new Error(data.error ?? "Kalender konnte nicht geladen werden.");
      setEvents(data.events ?? []);
      setLastUpdatedAt(new Date());
    } catch (e) {
      setEvents([]);
      setError(e instanceof Error ? e.message : "Kalender konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const totalHours = useMemo(() => {
    const ms = events.reduce((acc, e) => {
      if (!e.start || !e.end || e.allDay) return acc;
      return acc + Math.max(0, new Date(e.end).getTime() - new Date(e.start).getTime());
    }, 0);
    return ms / (1000 * 60 * 60);
  }, [events]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEventRow[]>();
    for (const event of events) {
      const start = parseEventStart(event);
      if (!start) continue;
      const key = toDayKey(start);
      const arr = map.get(key) ?? [];
      arr.push(event);
      map.set(key, arr);
    }
    Array.from(map.values()).forEach((arr) => {
      arr.sort((a: CalendarEventRow, b: CalendarEventRow) => {
        const da = parseEventStart(a);
        const db = parseEventStart(b);
        if (!da || !db) return 0;
        return da.getTime() - db.getTime();
      });
    });
    return map;
  }, [events]);

  const monthGrid = useMemo(() => {
    const firstOfMonth = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstWeekdayMon0 = (firstOfMonth.getDay() + 6) % 7; // Monday=0 ... Sunday=6
    const cells: Array<{ date: Date | null; inMonth: boolean }> = [];

    for (let i = 0; i < firstWeekdayMon0; i += 1) {
      cells.push({ date: null, inMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push({ date: new Date(year, month - 1, day), inMonth: true });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ date: null, inMonth: false });
    }
    return cells;
  }, [year, month]);

  const selectedDayEvents = useMemo(() => {
    if (!selectedDayKey) return [];
    return eventsByDay.get(selectedDayKey) ?? [];
  }, [selectedDayKey, eventsByDay]);

  const selectedDayLabel = useMemo(() => {
    if (!selectedDayKey) return "";
    const [y, m, d] = selectedDayKey.split("-").map(Number);
    const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
    return dt.toLocaleDateString("de-CH", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  }, [selectedDayKey]);

  return (
    <DashboardShell monthIncome={monthIncome} ytdIncome={ytdIncome} incomeLoading={incomeLoading}>
      <div className="min-w-0 space-y-4">
        <section className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="text-base font-semibold text-gray-900">Google Kalender</h2>
          <p className="mt-0.5 text-sm text-gray-500">Sieh deine Kalender-Eintraege direkt im ausgewaehlten Monat.</p>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Monat</label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-800 shadow-sm outline-none transition focus:border-[#4A7FC1] focus:ring-2 focus:ring-[#4A7FC1]/20"
              >
                {monthOptions.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Jahr</label>
              <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 px-2 py-1.5 shadow-sm">
                <button
                  type="button"
                  onClick={() => setYear((y) => y - 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition hover:bg-white hover:text-[#4A7FC1]"
                >
                  &lsaquo;
                </button>
                <span className="min-w-[3.5rem] text-center text-sm font-semibold text-gray-800">{year}</span>
                <button
                  type="button"
                  onClick={() => setYear((y) => y + 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition hover:bg-white hover:text-[#4A7FC1]"
                >
                  &rsaquo;
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void loadEvents()}
              className="rounded-xl bg-[#4A7FC1] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
            >
              Kalender laden
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-600">
              Nur manuell: Kalender laden / Sync-Button
            </span>
            {lastUpdatedAt ? (
              <span className="text-gray-500">
                Letztes Update: {lastUpdatedAt.toLocaleTimeString("de-CH")}
              </span>
            ) : null}
          </div>
        </section>

        <section className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-full bg-[#EBF4FF] px-3 py-1 font-semibold text-[#4A7FC1]">
              {events.length} Eintraege
            </span>
            <span className="rounded-full bg-gray-100 px-3 py-1 font-semibold text-gray-700">
              {totalHours.toFixed(1)}h geplant
            </span>
          </div>

          {loading && <p className="text-sm text-gray-500">Lade Kalender...</p>}
          {!loading && error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && !error && events.length === 0 && (
            <p className="text-sm text-gray-500">Keine Eintraege in diesem Monat gefunden.</p>
          )}

          {!loading && !error && events.length > 0 && (
            <div className="overflow-x-auto">
              <div className="grid min-w-[860px] grid-cols-7 gap-2">
                {WEEKDAYS.map((w) => (
                  <div
                    key={w}
                    className="rounded-lg border border-gray-100 bg-gray-50 px-2 py-1 text-center text-xs font-semibold text-gray-500"
                  >
                    {w}
                  </div>
                ))}

                {monthGrid.map((cell, idx) => {
                  if (!cell.date || !cell.inMonth) {
                    return (
                      <div
                        key={`empty-${idx}`}
                        className="min-h-[120px] rounded-lg border border-dashed border-gray-100 bg-gray-50/40"
                      />
                    );
                  }

                  const key = toDayKey(cell.date);
                  const dayEvents = eventsByDay.get(key) ?? [];
                  const isToday = toDayKey(cell.date) === toDayKey(new Date());

                  return (
                    <div
                      key={key}
                      className={`min-h-[120px] rounded-lg border p-2 ${
                        isToday
                          ? "border-[#4A7FC1]/40 bg-[#EBF4FF]/30"
                          : "border-gray-100 bg-white"
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <span
                          className={`text-xs font-semibold ${
                            isToday ? "text-[#2B5FA0]" : "text-gray-700"
                          }`}
                        >
                          {cell.date.getDate()}
                        </span>
                        <span className="text-[10px] text-gray-400">{dayEvents.length}</span>
                      </div>

                      <div className="space-y-1">
                        {dayEvents.slice(0, 4).map((e) => (
                          <div
                            key={e.id}
                            className="rounded-md bg-[#EBF4FF] px-1.5 py-1 text-[11px] text-[#2B5FA0]"
                            title={`${e.title}${e.location ? ` - ${e.location}` : ""}${e.description ? ` - ${e.description}` : ""}`}
                          >
                            <div className="truncate font-medium">{e.title}</div>
                            <div className="truncate text-[10px] text-[#4A7FC1]">
                              {e.allDay
                                ? "Ganztagig"
                                : e.start
                                  ? new Date(e.start).toLocaleTimeString("de-CH", {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })
                                  : ""}
                              {formatEventDuration(e) ? ` - ${formatEventDuration(e)}` : ""}
                              {e.location ? ` - ${e.location}` : ""}
                            </div>
                          </div>
                        ))}
                        {dayEvents.length > 4 && (
                          <button
                            type="button"
                            onClick={() => setSelectedDayKey(key)}
                            className="text-[10px] text-[#4A7FC1] hover:underline"
                          >
                            +{dayEvents.length - 4} weitere
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {selectedDayKey && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
            <div className="w-full max-w-lg rounded-2xl border border-blue-100 bg-white p-4 shadow-xl sm:p-5">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">Alle Eintraege</h3>
                  <p className="text-sm text-gray-500">{selectedDayLabel}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedDayKey(null)}
                  className="rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700"
                >
                  Schliessen
                </button>
              </div>

              <div className="max-h-[60vh] space-y-2 overflow-auto pr-1">
                {selectedDayEvents.map((e) => (
                  <div key={`modal-${e.id}`} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                    <p className="font-medium text-gray-900">{e.title}</p>
                    <p className="text-xs text-gray-500">
                      {e.allDay
                        ? "Ganztagig"
                        : e.start
                          ? new Date(e.start).toLocaleTimeString("de-CH", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      {formatEventDuration(e) ? ` - ${formatEventDuration(e)}` : ""}
                      {e.end && !e.allDay
                        ? ` - ${new Date(e.end).toLocaleTimeString("de-CH", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}`
                        : ""}
                    </p>
                    {e.location ? <p className="text-xs text-gray-500">Ort: {e.location}</p> : null}
                    {e.description ? <p className="mt-1 text-xs text-gray-600">{e.description}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
