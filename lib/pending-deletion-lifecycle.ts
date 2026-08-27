/**
 * Lebenszyklus einer Loeschvormerkung — rein, ohne DB, damit pruefbar.
 *
 * Der Fehler, den das hier festhaelt: "Behalten" setzte nur `pendingDeletionAt`
 * auf null, und genau danach sucht der Sync seine Kandidaten. Die Ablehnung hielt
 * also bis zum naechsten Sync, dann stand derselbe Fall wieder da. Seitdem gibt es
 * `deletionRejectedAt` als zweite, dauerhafte Marke.
 *
 * Ablauf:
 *   1. Kalendereintrag verschwindet          → pendingDeletionAt gesetzt
 *   2. Nutzer waehlt "Behalten"               → pendingDeletionAt null, deletionRejectedAt gesetzt
 *   3. Folge-Syncs                            → kein Kandidat mehr (Entscheid gilt)
 *   4. Kalendereintrag taucht wieder auf      → beide Marken fallen weg (Upsert)
 *   5. Er verschwindet erneut                 → neuer Vorgang, darf wieder gemeldet werden
 *
 * Der Sync-Filter unten und `isDeletionCandidate` gehoeren zusammen geaendert —
 * dasselbe Paar-Muster wie isDelivered / DELIVERED_INVOICE_WHERE.
 */

export type SessionDeletionState = {
  pendingDeletionAt: Date | null;
  deletionRejectedAt: Date | null;
};

/**
 * Prisma-Filter fuer "darf als Loeschkandidat geprueft werden".
 *
 * Schon vorgemerkte werden nicht erneut geprueft, abgelehnte nie wieder —
 * bis der Termin wieder auftaucht und der Upsert beide Marken loescht.
 */
export const DELETION_CANDIDATE_WHERE = {
  pendingDeletionAt: null,
  deletionRejectedAt: null,
} as const;

/** Spiegelt DELETION_CANDIDATE_WHERE. */
export function isDeletionCandidate(session: SessionDeletionState): boolean {
  return session.pendingDeletionAt === null && session.deletionRejectedAt === null;
}

/**
 * Der Kalendereintrag wurde wieder gesehen: jede offene Vormerkung und jeder
 * frueherer Entscheid sind gegenstandslos. Verschwindet er spaeter erneut,
 * beginnt der Zyklus von vorne.
 */
export const CALENDAR_EVENT_SEEN_RESET = {
  pendingDeletionAt: null,
  deletionRejectedAt: null,
} as const;

export function afterCalendarEventSeen(): SessionDeletionState {
  return { pendingDeletionAt: null, deletionRejectedAt: null };
}

/** Nachgewiesene Loeschung: vormerken, aber nichts entfernen. */
export function afterDeletionPending(now: Date): SessionDeletionState {
  return { pendingDeletionAt: now, deletionRejectedAt: null };
}

/**
 * "Behalten" — oder der Monat war bereits ausgeliefert und die Lektion darf
 * ohnehin nicht weg. Beide Faelle enden gleich: die Lektion bleibt, und der Sync
 * schlaegt sie nicht erneut vor.
 */
export function afterDeletionRejected(now: Date): SessionDeletionState {
  return { pendingDeletionAt: null, deletionRejectedAt: now };
}
