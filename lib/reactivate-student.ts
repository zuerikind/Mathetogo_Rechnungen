import { earliestTariffDate } from "@/lib/delivered-freeze";
import { zurichYearMonth } from "@/lib/month-math";

/** Faellt der Termin in einen gesperrten Monat (vor dem Vormonat), holt der Sync ihn nicht mehr nach. */
export function isLockedMonth(startIso: string, now = new Date()): boolean {
  const { year, month } = zurichYearMonth(new Date(startIso));
  return `${year}-${String(month).padStart(2, "0")}-01` < earliestTariffDate(now);
}

/** Text fuer die Rueckfrage vor dem Reaktivieren. */
export function reactivateQuestion(names: string[], startIso: string): string {
  return (
    `${names.join(", ")} reaktivieren?\n\n` +
    (isLockedMonth(startIso)
      ? "Dieser Termin liegt in einem abgeschlossenen Monat und wird NICHT mehr übernommen. Neue Termine werden ab jetzt wieder importiert."
      : "Danach wird der Monat gleich synchronisiert, damit die Lektionen übernommen werden.")
  );
}

/**
 * Reaktiviert die Schueler per Name und synct den Monat des Termins,
 * damit die liegengebliebenen Lektionen sofort uebernommen werden.
 * Gibt eine Fehlermeldung zurueck, oder null bei Erfolg.
 */
export async function reactivateAndSync(names: string[], startIso: string): Promise<string | null> {
  const res = await fetch("/api/students?inactive=1");
  if (!res.ok) return "Schüler konnten nicht geladen werden.";
  const all = (await res.json()) as Array<{ id: string; name: string; active: boolean }>;
  const targets = all.filter((s) => !s.active && names.includes(s.name));
  if (targets.length === 0) return "Schüler nicht gefunden — vielleicht schon reaktiviert?";

  for (const s of targets) {
    const put = await fetch(`/api/students/${s.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: true }),
    });
    if (!put.ok) return `${s.name} konnte nicht reaktiviert werden.`;
  }

  if (isLockedMonth(startIso)) return null;
  const { year, month } = zurichYearMonth(new Date(startIso));
  const sync = await fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Wie SyncButton: Waisen-Bereinigung bewusst aus.
    body: JSON.stringify({ year, month, pruneOrphans: false }),
  });
  return sync.ok ? null : "Reaktiviert, aber der Sync ist fehlgeschlagen — bitte den Monat von Hand syncen.";
}
