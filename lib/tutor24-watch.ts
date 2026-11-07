/**
 * Waechter fuer die tutor24-Automatik — laeuft auf Vercel, unabhaengig vom Laptop.
 * GitHub Actions ruft /api/tutor24/watch zu den Pruefzeiten auf; hier steht nur die Entscheidung
 * (rein, testbar): Ist der faellige Durchgang gelaufen? Wenn nicht: welche Erinnerung?
 * Zeiten immer in Europe/Zurich (Vercel und GitHub rechnen in UTC).
 */
import { RATE_LIMIT_TEXT, fmtZurich, type AutoMode } from "./tutor24-autopilot";
import { DEFAULT_TIMES, LAST_REMINDER_MIN, fromMin, normTimes, toMin, watchChecks, zurichParts, zurichTime } from "./tutor24-schedule";

const TZ = "Europe/Zurich";
export { zurichParts, zurichTime };

const hhmm = (d: Date) => d.toLocaleTimeString("de-CH", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

/** Pruefzeiten: aus den eingestellten Durchgaengen (lib/tutor24-schedule.ts watchChecks), Standard 09:00/17:00 */
export const CHECKS = watchChecks(DEFAULT_TIMES);
/** Ab hier keine Erinnerung mehr (auch eine verspaetete Pruefung von GitHub nicht) */
export const LAST_REMINDER_HOUR = LAST_REMINDER_MIN / 60;
/** Laptop gilt als offline, wenn sein Lebenszeichen aelter ist */
export const OFFLINE_AFTER_MS = 6 * 60_000;

/** Lebenszeichen des Laptop-Bots (Tutor24Signal "laptop") */
export type LaptopSignal = {
  at: string;
  modus: AutoMode;
  gestoppt: { grund: string; am: string } | null;
  /** Ende der 429-Pause, falls aktiv */
  pauseBis: string | null;
  /** Mindestabstand 2 h: frühester naechster Lauf, falls noch nicht erreicht */
  abstandBis?: string | null;
  /** eingestellte Uhrzeiten der Durchgaenge ("09:00"), Standard 09:00/17:00 */
  zeiten?: string[];
};
/** Stand des laufenden Durchgangs (scripts/autopilot.mts, alle 5 min erneuert) */
export type Progress = { start: string; modus: AutoMode; schritt: string; zaehler?: string; at: string };
export type RunRow ={ startedAt: Date; endedAt: Date | null; ergebnis: string; stopp: string | null; is429: boolean };

export const laptopOnline = (l: LaptopSignal | null, now: Date) => !!l && now.getTime() - new Date(l.at).getTime() < OFFLINE_AFTER_MS;
export const offlineText = (l: LaptopSignal | null) =>
  l ? `Laptop ist seit ${fmtZurich(new Date(l.at))} offline.` : "Vom Laptop kam noch kein Lebenszeichen.";

/** Aktuelle Pruefzeit (die letzte, die schon erreicht ist), als Schluessel "YYYY-MM-DD 09:45" */
export function currentCheck(now: Date, times: string[] = DEFAULT_TIMES): { key: string; due: string; day: string } | null {
  const z = zurichParts(now);
  const mins = z.h * 60 + z.m;
  if (mins >= LAST_REMINDER_MIN) return null;
  const hit = [...watchChecks(times)].reverse().find((c) => c.min <= mins);
  return hit ? { key: `${z.day} ${fromMin(hit.min)}`, due: hit.due, day: z.day } : null;
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
  const check = currentCheck(p.now, normTimes(p.laptop?.zeiten) ?? DEFAULT_TIMES);
  if (!check || p.alreadySent.includes(check.key)) return null;
  const dueAt = zurichTime(check.day, Math.floor(toMin(check.due) / 60), toMin(check.due) % 60);
  const runs = p.runs.filter((r) => r.startedAt >= new Date(dueAt.getTime() - 30 * 60_000));
  const last = runs[runs.length - 1];
  const online = laptopOnline(p.laptop, p.now);
  const dueLabel = check.due.replace(/^0/, "");
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
  if (!online) return say(`Heute noch kein Durchgang (fällig ${dueLabel}). ${offlineText(l)} Er ist aus, schläft oder hat kein Internet (Hotspot/WLAN prüfen). Danach „Jetzt starten“.`);
  if (l?.abstandBis && new Date(l.abstandBis) > p.now)
    return say(`Durchgang von ${dueLabel} verschoben: Nächster Lauf frühestens um ${hhmm(new Date(l.abstandBis))} (2 Stunden Abstand zum letzten Lauf).`);
  return say(`Laptop ist an, aber der Durchgang von ${dueLabel} fehlt (z. B. war die Automatik da noch aus oder der Laptop schlief). „Jetzt starten“ holt ihn nach.`);
}

/** Telegram-Knopf unter Erinnerungen und der Tageszusammenfassung */
export const START_BUTTON = { inline_keyboard: [[{ text: "Jetzt starten", callback_data: "start" }]] };
