/**
 * Waechter fuer die tutor24-Automatik — laeuft auf Vercel, unabhaengig vom Laptop.
 * GitHub Actions ruft /api/tutor24/watch zu den Pruefzeiten auf; hier steht nur die Entscheidung
 * (rein, testbar): Ist der faellige Durchgang gelaufen? Wenn nicht: welche Erinnerung?
 * Zeiten immer in Europe/Zurich (Vercel und GitHub rechnen in UTC).
 */
import { RATE_LIMIT_TEXT, fmtZurich, type AutoMode } from "./tutor24-autopilot";

const TZ = "Europe/Zurich";

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
  // Abweichung der Zuercher Uhr von UTC an diesem Zeitpunkt (1 h Winter, 2 h Sommer)
  const z = zurichParts(guess);
  const shown = Date.UTC(Number(z.day.slice(0, 4)), Number(z.day.slice(5, 7)) - 1, Number(z.day.slice(8, 10)), z.h, z.m);
  return new Date(guess.getTime() - (shown - guess.getTime()));
}

const hhmm = (d: Date) => d.toLocaleTimeString("de-CH", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

/** Pruefzeiten und welcher Durchgang dann faellig ist (muss zu RUN_HOURS 9/17 passen) */
export const CHECKS = [
  { h: 9, m: 45, due: 9 },
  { h: 12, m: 0, due: 9 },
  { h: 15, m: 0, due: 9 },
  { h: 17, m: 45, due: 17 },
  { h: 20, m: 0, due: 17 },
] as const;
/** Ab hier keine Erinnerung mehr (auch eine verspaetete 20:00-Pruefung von GitHub nicht) */
export const LAST_REMINDER_HOUR = 21;
/** Laptop gilt als offline, wenn sein Lebenszeichen aelter ist */
export const OFFLINE_AFTER_MS = 6 * 60_000;

/** Lebenszeichen des Laptop-Bots (Tutor24Signal "laptop") */
export type LaptopSignal = {
  at: string;
  modus: AutoMode;
  gestoppt: { grund: string; am: string } | null;
  /** Ende der 429-Pause, falls aktiv */
  pauseBis: string | null;
};
export type RunRow = { startedAt: Date; endedAt: Date | null; ergebnis: string; stopp: string | null; is429: boolean };

export const laptopOnline = (l: LaptopSignal | null, now: Date) => !!l && now.getTime() - new Date(l.at).getTime() < OFFLINE_AFTER_MS;
export const offlineText = (l: LaptopSignal | null) =>
  l ? `Laptop ist seit ${fmtZurich(new Date(l.at))} offline.` : "Vom Laptop kam noch kein Lebenszeichen.";

/** Aktuelle Pruefzeit (die letzte, die schon erreicht ist), als Schluessel "YYYY-MM-DD 09:45" */
export function currentCheck(now: Date): { key: string; due: number; day: string } | null {
  const z = zurichParts(now);
  if (z.h >= LAST_REMINDER_HOUR) return null;
  const mins = z.h * 60 + z.m;
  const hit = [...CHECKS].reverse().find((c) => c.h * 60 + c.m <= mins);
  return hit ? { key: `${z.day} ${String(hit.h).padStart(2, "0")}:${String(hit.m).padStart(2, "0")}`, due: hit.due, day: z.day } : null;
}

/** Durch die Automatik selbst (429, Login, Fehler) ausgeschaltet — nicht von mir */
const autoStopped = (g: LaptopSignal["gestoppt"]) => !!g && !/per Telegram \/stop|von Hand|auf \/kurse/i.test(g.grund);

/**
 * Erinnerung fuer die aktuelle Pruefzeit, oder null (alles in Ordnung / absichtlich aus / schon erinnert).
 * runs: Durchgaenge seit dem faelligen Zeitpunkt (neueste zuletzt).
 */
export function watchDecision(p: {
  now: Date;
  laptop: LaptopSignal | null;
  runs: RunRow[];
  alreadySent: string[];
}): { key: string; text: string } | null {
  const check = currentCheck(p.now);
  if (!check || p.alreadySent.includes(check.key)) return null;
  const dueAt = zurichTime(check.day, check.due);
  const runs = p.runs.filter((r) => r.startedAt >= new Date(dueAt.getTime() - 30 * 60_000));
  const last = runs[runs.length - 1];
  const online = laptopOnline(p.laptop, p.now);
  const dueLabel = `${check.due}:00`;
  const say = (text: string) => ({ key: check.key, text: `⏰ tutor24 · ${text}` });

  if (last?.endedAt) {
    if (last.is429) return say(`Durchgang um ${hhmm(last.startedAt)} gestoppt: ${RATE_LIMIT_TEXT}${p.laptop?.pauseBis ? ` Pause bis ${fmtZurich(new Date(p.laptop.pauseBis))}.` : ""}`);
    if (last.stopp) return say(`Durchgang um ${hhmm(last.startedAt)} hat die Automatik gestoppt: ${last.stopp.slice(0, 160)}`);
    if (last.ergebnis.startsWith("Abgebrochen")) return say(`Durchgang um ${hhmm(last.startedAt)} ${last.ergebnis.slice(0, 180)}`);
    return null;
  }
  if (last && !last.endedAt)
    return online ? null : say(`Der Durchgang von ${hhmm(last.startedAt)} hat nicht fertig gemeldet. ${offlineText(p.laptop)} Laptop öffnen, dann „Jetzt starten“.`);

  // kein Durchgang seit dem faelligen Zeitpunkt
  const l = p.laptop;
  if (l?.modus === "aus" && !autoStopped(l.gestoppt)) return null; // absichtlich aus: nicht erinnern
  if (l?.modus === "aus" && l.gestoppt)
    return say(`Automatik ist seit ${fmtZurich(new Date(l.gestoppt.am))} aus: ${l.gestoppt.grund.slice(0, 160)}`);
  if (l?.pauseBis && new Date(l.pauseBis) > p.now) return say(`${RATE_LIMIT_TEXT} Pause bis ${fmtZurich(new Date(l.pauseBis))}; bis dahin läuft kein Durchgang.`);
  if (!online) return say(`Heute noch kein Durchgang (fällig ${dueLabel}). ${offlineText(l)} Laptop öffnen, dann „Jetzt starten“.`);
  return say(`Laptop ist an, aber der Durchgang von ${dueLabel} fehlt (Aufgabenplanung prüfen). „Jetzt starten“ holt ihn nach.`);
}

/** Telegram-Knopf unter Erinnerungen und der Tageszusammenfassung */
export const START_BUTTON = { inline_keyboard: [[{ text: "Jetzt starten", callback_data: "start" }]] };
