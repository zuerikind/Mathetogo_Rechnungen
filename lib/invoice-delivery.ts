/**
 * Eine Rechnung gilt als ausgeliefert, sobald sie das Haus verlassen hat:
 * gesendet, bezahlt ODER heruntergeladen. Ab dann ist sie unveraenderlich —
 * Korrekturen laufen ueber eine Revision, nie ueber stilles Ueberschreiben.
 *
 * Bewusst EIN Praedikat fuer alle Guards. Die Varianten (nur `sentAt`,
 * `sentAt || paidAt`, `NOT: { sentAt: null, paidAt: null }`) sind route-fuer-route
 * auseinandergelaufen und haben genau die Faelle durchgelassen, die sie fangen
 * sollten — u. a. die Tarifaenderung, die im Juli 2026 die Lektionen zweier
 * bereits ausgelieferter Rechnungen ohne Warnung neu bepreist hat.
 */
export type InvoiceDeliveryState = {
  sentAt: Date | null;
  paidAt: Date | null;
  firstDownloadedAt: Date | null;
  /** Storniert. Optional, damit Aufrufer ohne diese Spalte weiter kompilieren. */
  voidedAt?: Date | null;
};

/**
 * Storniert zaehlt als ausgeliefert.
 *
 * Ein Storno setzt `paidAt` zurueck (invoice-revision). War eine Rechnung nur
 * ueber `paidAt` ausgeliefert, fiel sie danach auf "Entwurf" zurueck — und ein
 * Entwurf darf ueberschrieben und geloescht werden. Die Nummer war vergeben, das
 * Dokument war beim Kunden, und das Aufraeumen haette beides entfernt. Eine
 * stornierte Rechnung ist das Gegenteil eines Entwurfs: sie bleibt als Nachweis.
 */
export function isDelivered(invoice: InvoiceDeliveryState): boolean {
  return Boolean(
    invoice.sentAt || invoice.paidAt || invoice.firstDownloadedAt || invoice.voidedAt
  );
}

/**
 * Prisma-Filter fuer "ausgeliefert": NOT(alle drei null) = mindestens eines gesetzt.
 * Spiegelt isDelivered — die beiden gehoeren zusammen geaendert.
 */
export const DELIVERED_INVOICE_WHERE = {
  NOT: { sentAt: null, paidAt: null, firstDownloadedAt: null, voidedAt: null },
} as const;

/**
 * "Dieser Monat ist anderswo bereits fakturiert" — fuer AUSSCHLUSS-Abfragen.
 *
 * Bewusst NICHT dasselbe wie DELIVERED_INVOICE_WHERE, obwohl es fast gleich
 * aussieht. Die beiden beantworten verschiedene Fragen:
 *
 *   DELIVERED_INVOICE_WHERE — "darf ich das anfassen?" Storniert: nein.
 *   BILLED_ELSEWHERE_WHERE  — "ist das schon abgerechnet?" Storniert: nein,
 *                             ein Storno rechnet nichts ab.
 *
 * Ohne die Trennung blieben die Lektionen eines Kindes, dessen Einzelrechnung
 * storniert wurde, aus der Familienrechnung ausgeschlossen — und landeten damit
 * auf gar keiner Rechnung.
 */
export const BILLED_ELSEWHERE_WHERE = {
  ...DELIVERED_INVOICE_WHERE,
  voidedAt: null,
} as const;

/** Spiegelt BILLED_ELSEWHERE_WHERE. */
export function isBilledElsewhere(invoice: InvoiceDeliveryState): boolean {
  if (invoice.voidedAt) return false;
  return Boolean(invoice.sentAt || invoice.paidAt || invoice.firstDownloadedAt);
}

/**
 * Darf diese Rechnungszeile beim Aufraeumen entfernt werden?
 *
 * Bezahlt und heruntergeladen sind absolut geschuetzt: das Dokument ist raus, der
 * Snapshot verweist darauf, Korrekturen laufen ueber Revision oder Storno.
 * Gesendet ist geschuetzt bis auf den ausdruecklichen Fall `includeSent` — ein
 * Fehlversand, den der Aufrufer bewusst zuruecknimmt.
 *
 * Bewusst hier bei isDelivered und nicht in invoice-stale: es ist dieselbe Frage
 * aus der Gegenrichtung, und beide muessen zusammen geaendert werden.
 */
export function isPrunableDraft(
  invoice: InvoiceDeliveryState,
  opts?: { includeSent?: boolean }
): boolean {
  // Storniert wird nie entfernt: Nummer und PDF bleiben der Nachweis dafuer,
  // dass die Rechnung existiert hat.
  if (invoice.voidedAt) return false;
  if (invoice.paidAt) return false;
  if (invoice.firstDownloadedAt) return false;
  if (invoice.sentAt && !opts?.includeSent) return false;
  return true;
}
