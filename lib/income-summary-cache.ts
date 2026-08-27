import "server-only";

/**
 * Kurzlebiger Zwischenspeicher der Einkommensantwort.
 *
 * Lag vorher als Modulvariable in app/api/income-summary. Er bleibt genau so, wie
 * er war — nur von aussen leerbar: nach einem Sync oder einem Entscheid ueber
 * Loeschvormerkungen stimmen die Zahlen nicht mehr, und ohne Invalidierung zeigt
 * das Dashboard bis zu 20 Sekunden lang die alte Summe neben den frisch geladenen
 * Zahlen der Seite. Kein Umbau der Zwischenspeicherung, nur ein Schalter.
 */
export type IncomeSummaryPayload = {
  year: number;
  month: number;
  monthIncome: number;
  ytdIncome: number;
  fromCache?: boolean;
};

export const INCOME_SUMMARY_TTL_MS = 20_000;

const cache = new Map<string, { at: number; value: IncomeSummaryPayload }>();

const key = (year: number, month: number) => `${year}-${month}`;

/** Frischer Eintrag oder undefined (abgelaufene bleiben als Notnagel liegen, siehe getStale). */
export function getFreshIncomeSummary(year: number, month: number): IncomeSummaryPayload | undefined {
  const hit = cache.get(key(year, month));
  if (!hit) return undefined;
  return Date.now() - hit.at < INCOME_SUMMARY_TTL_MS ? hit.value : undefined;
}

/** Auch abgelaufen — nur fuer den Fehlerfall, damit die Seite statt 500 alte Zahlen zeigt. */
export function getStaleIncomeSummary(year: number, month: number): IncomeSummaryPayload | undefined {
  return cache.get(key(year, month))?.value;
}

export function setIncomeSummary(year: number, month: number, value: IncomeSummaryPayload): void {
  cache.set(key(year, month), { at: Date.now(), value });
}

/** Nach jeder Mutation, die Einkommen veraendert (Sync, Loeschentscheid). */
export function clearIncomeSummaryCache(): void {
  cache.clear();
}
