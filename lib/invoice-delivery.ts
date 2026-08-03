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
};

export function isDelivered(invoice: InvoiceDeliveryState): boolean {
  return Boolean(invoice.sentAt || invoice.paidAt || invoice.firstDownloadedAt);
}

/**
 * Prisma-Filter fuer "ausgeliefert": NOT(alle drei null) = mindestens eines gesetzt.
 * Spiegelt isDelivered — die beiden gehoeren zusammen geaendert.
 */
export const DELIVERED_INVOICE_WHERE = {
  NOT: { sentAt: null, paidAt: null, firstDownloadedAt: null },
} as const;
