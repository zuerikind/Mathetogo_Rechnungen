/**
 * Pure rate-history lookup (no DB). The sync prices new sessions with the
 * rate that was effective on the lesson date; `fallback` (the student's
 * current ratePerMin) applies when no history row covers the date.
 */
export type RateHistoryEntry = {
  ratePerMin: number;
  effectiveFrom: Date;
};

export function rateAtDate(
  history: RateHistoryEntry[],
  fallback: number,
  date: Date
): number {
  let best: RateHistoryEntry | null = null;
  for (const entry of history) {
    if (entry.effectiveFrom.getTime() > date.getTime()) continue;
    if (!best || entry.effectiveFrom.getTime() > best.effectiveFrom.getTime()) {
      best = entry;
    }
  }
  return best ? best.ratePerMin : fallback;
}
