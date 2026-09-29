/**
 * Alte Monate sind eingefroren — auch fuer den Kalender-Sync.
 *
 * Bisher schrieb der Sync jede Kalenderaenderung durch: wurde eine Serie im
 * September bearbeitet, bekam der laengst bezahlte Juli neue Lektionen, und
 * Einkommen, Stunden und Schuelerzahlen des Juli aenderten sich still.
 *
 * Regel: der vorletzte Monat und alles davor (Zuerich-Zeit) ist gesperrt. Im
 * September sind also Juli und frueher fest, August und September offen — der
 * Vormonat bleibt korrigierbar, bis seine Rechnungen raus sind. Dort legt der
 * Sync nichts an und aendert keine Finanzfelder (Schueler, Zeit, Dauer, Betrag),
 * sondern meldet die Abweichung als Befund "delivered_frozen".
 *
 * Rein, ohne Datenbank.
 */

import { zurichYearMonth } from "@/lib/month-math";

export const DELIVERED_FROZEN_REASON = "delivered_frozen" as const;

const roundCents = (n: number) => Math.round(n * 100) / 100;

const monthIndex = (ym: { year: number; month: number }) => ym.year * 12 + (ym.month - 1);

/** Gesperrt: der vorletzte Monat relativ zu `now` und alles davor. */
export function isFrozenMonth(ym: { year: number; month: number }, now: Date): boolean {
  return monthIndex(ym) <= monthIndex(zurichYearMonth(now)) - 2;
}

const zurichHourFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

/** 00:00 Zuerich-Zeit an diesem Kalendertag — unabhaengig von der Server-Zeitzone. */
export function zurichMidnight(year: number, month: number, day: number): Date {
  // Zuerich ist UTC+1 oder UTC+2: Mitternacht liegt um 22:00 oder 23:00 UTC am Vortag.
  for (const utcHour of [22, 23]) {
    const candidate = new Date(Date.UTC(year, month - 1, day - 1, utcHour));
    const p = Object.fromEntries(zurichHourFmt.formatToParts(candidate).map((x) => [x.type, x.value]));
    if (Number(p.year) === year && Number(p.month) === month && Number(p.day) === day && Number(p.hour) === 0) {
      return candidate;
    }
  }
  throw new Error(`Keine Zuercher Mitternacht fuer ${year}-${month}-${day}`);
}

/** Frühestes erlaubtes Gültig-ab einer Tarifänderung: der 1. des Vormonats, als YYYY-MM-DD. */
export function earliestTariffDate(now: Date): string {
  const cur = zurichYearMonth(now);
  const idx = cur.year * 12 + (cur.month - 1) - 1;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

export type TariffDateCheck =
  | { ok: true; effectiveFrom: Date }
  | { ok: false; error: string };

/**
 * Ein Tarif darf nur im laufenden und im Vormonat nachwirken — genau die Monate,
 * die der Sync noch veraendern darf. Aeltere Monate sind abgeschlossen.
 */
export function checkTariffEffectiveDate(value: unknown, now: Date): TariffDateCheck {
  const m = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim()) : null;
  if (!m) return { ok: false, error: "Bitte ein Gültig-ab-Datum (JJJJ-MM-TT) angeben." };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return { ok: false, error: "Ungültiges Datum." };
  }
  if (isFrozenMonth({ year: y, month: mo }, now)) {
    const [ey, em] = earliestTariffDate(now).split("-");
    return {
      ok: false,
      error: `Tarifänderungen gelten frühestens ab 01.${em}.${ey}. Ältere Monate sind abgeschlossen und bleiben unverändert.`,
    };
  }
  return { ok: true, effectiveFrom: zurichMidnight(y, mo, d) };
}

export type FrozenSide = {
  studentId: string;
  date: Date;
  durationMin: number;
  amountCHF: number;
};

export type FrozenWriteDecision =
  /** Offener Monat — normal schreiben. */
  | { kind: "write" }
  /**
   * Gesperrt: keine Finanzfelder schreiben, keine Lektion anlegen.
   * `changes` leer = der Termin passt zur Lektion, nichts zu melden.
   */
  | { kind: "freeze"; isNew: boolean; changes: string[] };

/**
 * Darf der Sync diese Lektion schreiben?
 *
 * Gesperrt ist, was entweder HEUTE in einem gesperrten Monat steht (bestehende
 * Lektion) oder DORTHIN geschrieben wuerde (Kalendertermin). Beides zaehlt: ein
 * Termin, der aus dem Juli in den offenen Oktober wandert, nimmt sonst eine
 * fakturierte Lektion aus dem Juli mit.
 */
export function decideFrozenWrite(args: {
  existing: FrozenSide | null;
  incoming: FrozenSide;
  now: Date;
}): FrozenWriteDecision {
  const { existing, incoming, now } = args;
  const isFrozen = (s: FrozenSide) => isFrozenMonth(zurichYearMonth(s.date), now);

  if (!isFrozen(incoming) && !(existing && isFrozen(existing))) return { kind: "write" };
  if (!existing) return { kind: "freeze", isNew: true, changes: ["neue Lektion"] };

  const changes: string[] = [];
  if (existing.studentId !== incoming.studentId) changes.push("anderer Schüler");
  if (existing.date.getTime() !== incoming.date.getTime()) {
    changes.push(`Zeit ${formatDateTime(incoming.date)} statt ${formatDateTime(existing.date)}`);
  }
  if (existing.durationMin !== incoming.durationMin) {
    changes.push(`Dauer ${incoming.durationMin} statt ${existing.durationMin} Min.`);
  } else if (roundCents(existing.amountCHF) !== roundCents(incoming.amountCHF)) {
    changes.push(
      `Betrag CHF ${roundCents(incoming.amountCHF).toFixed(2)} statt CHF ${roundCents(existing.amountCHF).toFixed(2)}`
    );
  }
  return { kind: "freeze", isNew: false, changes };
}

const dateTimeFmt = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const formatDateTime = (d: Date) => dateTimeFmt.format(d);

export function describeFrozenChange(
  studentName: string,
  start: Date,
  decision: Extract<FrozenWriteDecision, { kind: "freeze" }>
): string {
  return decision.isNew
    ? `${studentName} — Kalender zeigt am ${formatDateTime(start)} eine Lektion in einem abgeschlossenen Monat. Nicht übernommen.`
    : `${studentName} — Termin in einem abgeschlossenen Monat geändert (${decision.changes.join(", ")}). Lektion bleibt wie verbucht.`;
}
