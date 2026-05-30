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

/** Students billed on 60-minute calendar blocks (not 50). */
export const LONG_SESSION_STUDENT_NAMES = new Set(["Thilo"]);

export function defaultRatePerMinForStudent(name: string): number {
  return LONG_SESSION_STUDENT_NAMES.has(name)
    ? LONG_SESSION_RATE_PER_MIN
    : STANDARD_RATE_PER_MIN;
}
