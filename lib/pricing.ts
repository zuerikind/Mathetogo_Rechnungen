/** Flat price per tutoring session (CHF). */
export const CLASS_PRICE_CHF = 60;

/** Default session length for ratePerMin (most students). */
export const STANDARD_CLASS_MINUTES = 50;

/** Students with 60-minute calendar blocks use this for ratePerMin. */
export const LONG_CLASS_MINUTES = 60;

/** Previous standard class price — used to scale platform subscription packages. */
const OLD_REFERENCE_CLASS_PRICE_CHF = 55;

export function ratePerMinForClassPrice(
  classPriceCHF: number = CLASS_PRICE_CHF,
  durationMin: number = STANDARD_CLASS_MINUTES
): number {
  return Math.round((classPriceCHF / durationMin) * 100) / 100;
}

export const STANDARD_RATE_PER_MIN = ratePerMinForClassPrice(
  CLASS_PRICE_CHF,
  STANDARD_CLASS_MINUTES
);

export const LONG_SESSION_RATE_PER_MIN = ratePerMinForClassPrice(
  CLASS_PRICE_CHF,
  LONG_CLASS_MINUTES
);

/** Mathetogo platform add-on — monthly CHF by contract length. */
export const PLATFORM_SUBSCRIPTION_MONTHLY: Record<1 | 6, number> = {
  1: scalePackageMonthly(50),
  6: scalePackageMonthly(40),
};

function scalePackageMonthly(oldMonthlyCHF: number): number {
  return Math.round(oldMonthlyCHF * (CLASS_PRICE_CHF / OLD_REFERENCE_CLASS_PRICE_CHF));
}

export function platformSubscriptionMonthlyForDuration(durationMonths: 1 | 6): number {
  return PLATFORM_SUBSCRIPTION_MONTHLY[durationMonths];
}

export function classPriceFromRate(ratePerMin: number, durationMin: number): number {
  return Math.round(ratePerMin * durationMin * 100) / 100;
}

/**
 * Die typische Lektionsdauer eines Schuelers — aus seinen Lektionen, nicht geraten.
 *
 * "CHF pro Lektion" ist nur dann eine Aussage, wenn feststeht, wie lang eine
 * Lektion ist. Die Schuelertabelle hat das frueher aus dem NAMEN erschlossen
 * (60 Minuten fuer eine handgepflegte Liste, sonst 50) — damit stand in
 * derselben Spalte mal der Stundenpreis und mal der Preis einer 50-Minuten-
 * Lektion, ohne dass man es der Zahl ansehen konnte. Die Dauer steht in jeder
 * Lektion, also wird sie von dort genommen.
 *
 * Haeufigster Wert, bei Gleichstand der zuletzt unterrichtete: wer von 50 auf 60
 * Minuten wechselt, soll nicht jahrelang den alten Stand sehen. Ohne Lektionen
 * gibt es keine Antwort — dann null, und die Tabelle zeigt einen Strich statt
 * einer erfundenen Zahl.
 */
export function typicalLessonMinutes(
  sessions: readonly { durationMin: number; date: string }[]
): number | null {
  const byDuration = new Map<number, { count: number; latest: string }>();
  for (const s of sessions) {
    if (!Number.isFinite(s.durationMin) || s.durationMin <= 0) continue;
    const seen = byDuration.get(s.durationMin);
    if (seen) {
      seen.count += 1;
      if (s.date > seen.latest) seen.latest = s.date;
    } else {
      byDuration.set(s.durationMin, { count: 1, latest: s.date });
    }
  }

  let best: { durationMin: number; count: number; latest: string } | null = null;
  byDuration.forEach((v, durationMin) => {
    if (
      !best ||
      v.count > best.count ||
      (v.count === best.count && v.latest > best.latest)
    ) {
      best = { durationMin, count: v.count, latest: v.latest };
    }
  });
  return best === null ? null : (best as { durationMin: number }).durationMin;
}

/** Students billed on 60-minute calendar blocks (not 50). */
export const LONG_SESSION_STUDENT_NAMES = new Set(["Thilo"]);

export function defaultRatePerMinForStudent(name: string): number {
  return LONG_SESSION_STUDENT_NAMES.has(name)
    ? LONG_SESSION_RATE_PER_MIN
    : STANDARD_RATE_PER_MIN;
}
