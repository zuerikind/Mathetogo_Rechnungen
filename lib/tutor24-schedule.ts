/**
 * Uhrzeiten der Durchgaenge (einstellbar auf /kurse → Einstellungen, settings.json "durchgaenge"),
 * Pruefzeiten des Waechters daraus, und die Windows-Aufgabe dazu. Alle Zeiten Europe/Zurich —
 * auch auf Vercel (UTC), darum nie die Ortszeit des Rechners verwenden. Ohne Node-Abhaengigkeiten (laeuft auch im Browser).
 */
const TZ = "Europe/Zurich";
export const DEFAULT_TIMES = ["09:00", "17:00"];
/** Mindestabstand zwischen zwei Durchgaengen (wie lib/tutor24-lock.ts MIN_GAP_MS) */
export const MIN_GAP_MIN = 120;
export const TASK_NAME = "Mathetogo tutor24 Automatik";

/** Datum (YYYY-MM-DD) und Uhrzeit in Zuerich */
export function zurichParts(d: Date): { day: string; h: number; m: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return { day: `${p.year}-${p.month}-${p.day}`, h: Number(p.hour), m: Number(p.minute) };
}

/** Zuercher Ortszeit (Tag + Stunde:Minute) als Zeitpunkt */
export function zurichTime(day: string, h: number, m = 0): Date {
  const guess = new Date(`${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  const z = zurichParts(guess);
  const shown = Date.UTC(Number(z.day.slice(0, 4)), Number(z.day.slice(5, 7)) - 1, Number(z.day.slice(8, 10)), z.h, z.m);
  return new Date(guess.getTime() - (shown - guess.getTime()));
}

const pad = (n: number) => String(n).padStart(2, "0");
export const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fromMin = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** "9:00" → "09:00", sortiert; null = keine Liste oder eine Zeit nicht HH:MM */
export function normTimes(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(x).trim());
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
    out.push(`${pad(Number(m[1]))}:${m[2]}`);
  }
  return out.sort();
}

/** Fehler fuer /kurse, null = in Ordnung: 1–4 Zeiten, HH:MM, je mindestens 2 Stunden auseinander (auch ueber Mitternacht). */
export function timesProblem(v: unknown): string | null {
  const t = normTimes(v);
  if (!t) return "Uhrzeiten im Format HH:MM, z. B. 09:00, 17:00.";
  if (t.length < 1 || t.length > 4) return "1 bis 4 Durchgänge pro Tag.";
  for (let i = 0; i < t.length; i++) {
    const next = i + 1 < t.length ? toMin(t[i + 1]) : toMin(t[0]) + 24 * 60;
    if (t.length > 1 && next - toMin(t[i]) < MIN_GAP_MIN)
      return `${t[i]} und ${t[(i + 1) % t.length]} liegen weniger als 2 Stunden auseinander (Mindestabstand zwischen zwei Durchgängen).`;
  }
  return null;
}

/** Naechster geplanter Durchgang ab `from` (inklusive), in Zuercher Zeit. */
export function nextScheduled(from: Date, times: string[] = DEFAULT_TIMES): Date {
  for (let d = 0; d < 3; d++) {
    const day = zurichParts(new Date(from.getTime() + d * 86_400_000)).day;
    for (const t of times) {
      const at = zurichTime(day, Number(t.slice(0, 2)), Number(t.slice(3, 5)));
      if (at >= from) return at;
    }
  }
  throw new Error("unreachable");
}

/** Keine Erinnerung mehr ab dieser Stunde */
export const LAST_REMINDER_MIN = 21 * 60;

/**
 * Pruefzeiten des Waechters: je Durchgang 45 min, 3 h und 6 h danach — solange vor der Pruefung des
 * naechsten Durchgangs und vor 21:00. Bei 09:00/17:00: 9:45, 12:00, 15:00 (fuer 9) und 17:45, 20:00 (fuer 17).
 */
export function watchChecks(times: string[] = DEFAULT_TIMES): { min: number; due: string }[] {
  const t = normTimes(times) ?? DEFAULT_TIMES;
  const out: { min: number; due: string }[] = [];
  t.forEach((due, i) => {
    const limit = Math.min(i + 1 < t.length ? toMin(t[i + 1]) + 45 : Infinity, LAST_REMINDER_MIN);
    for (const after of [45, 180, 360]) {
      const min = toMin(due) + after;
      if (min < limit) out.push({ min, due });
    }
  });
  return out.sort((a, b) => a.min - b.min);
}
