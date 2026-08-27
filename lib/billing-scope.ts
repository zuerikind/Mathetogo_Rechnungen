/**
 * Wer traegt die Rechnung fuer eine Lektion? — eine Definition, mehrere Aufrufer.
 *
 * Familienrechnung: die Lektionen eines Kindes stehen auf der Rechnung des
 * verlinkten Hauptschuelers (`billedToId`). Ausnahme, die getInvoicePayload und
 * invoice-stale schon kennen: hat das Kind fuer den Monat eine EIGENE bereits
 * ausgelieferte Rechnung (z. B. von vor der Verknuepfung), bleiben seine Betraege
 * dort.
 *
 * Genau diese zweite Moeglichkeit fehlte im Tarif-Guard: er suchte ausgelieferte
 * Rechnungen nur unter `studentId = <Kind>` und fand deshalb nie die
 * Familienrechnung, auf der die Lektion tatsaechlich stand — die Betraege wurden
 * ohne Warnung neu bepreist. Deshalb liegt die Definition jetzt hier, rein und
 * ohne DB, und wird von beiden Seiten benutzt.
 */

import { zurichYearMonth } from "@/lib/month-math";

/** Auf welche Rechnung laeuft der Monat dieses Schuelers? (Familienrechnung beachtet) */
export function billingTargetIdOf(studentId: string, billedToId: string | null | undefined): string {
  return billedToId ?? studentId;
}

/**
 * Alle Rechnungs-IDs, auf denen eine Lektion dieses Schuelers landen kann.
 *
 * Beides, nicht nur das Ziel: das Kind selbst (eigene, frueher ausgelieferte
 * Rechnung) UND der Hauptschueler (Familienrechnung). Ist eine der beiden fuer
 * den Monat ausgeliefert, ist die Lektion fakturiert.
 */
export function billingScopeStudentIds(
  studentId: string,
  billedToId: string | null | undefined
): string[] {
  const target = billingTargetIdOf(studentId, billedToId);
  return target === studentId ? [studentId] : [studentId, target];
}

export type InvoiceMonth = { year: number; month: number };

const monthKey = (m: InvoiceMonth) => `${m.year}-${m.month}`;

/** Kalendermonate (Zuerich) der betroffenen Lektionen, ohne Doppel. */
export function affectedInvoiceMonths(sessions: { date: Date }[]): InvoiceMonth[] {
  const seen = new Map<string, InvoiceMonth>();
  for (const s of sessions) {
    const ym = zurichYearMonth(s.date);
    seen.set(monthKey(ym), ym);
  }
  return Array.from(seen.values()).sort((a, b) => a.year - b.year || a.month - b.month);
}

/**
 * Welche der betroffenen Monate liegen auf einer bereits ausgelieferten Rechnung?
 *
 * `deliveredInvoices` muss bereits auf die Rechnungs-Gruppe (billingScopeStudentIds)
 * und auf "ausgeliefert" (DELIVERED_INVOICE_WHERE) gefiltert sein — welche Rechnung
 * ausgeliefert ist, entscheidet weiterhin allein lib/invoice-delivery.
 */
export function blockedDeliveredMonths(
  affected: InvoiceMonth[],
  deliveredInvoices: InvoiceMonth[]
): InvoiceMonth[] {
  const delivered = new Set(deliveredInvoices.map(monthKey));
  return affected
    .filter((m) => delivered.has(monthKey(m)))
    .sort((a, b) => a.year - b.year || a.month - b.month);
}

/**
 * Session-IDs, die laut vorhandenen Belegen bereits fakturiert sind.
 *
 * `sessionIds` steht als JSON-Zeichenkette in der Rechnung. Unlesbare Eintraege
 * werden uebersprungen statt zu werfen: ein defekter Altbeleg darf die
 * Rechnungsstellung nicht blockieren — er verliert nur seinen Schutzbeitrag.
 */
export function collectBilledSessionIds(
  invoices: { sessionIds: string }[]
): Set<string> {
  const out = new Set<string>();
  for (const inv of invoices) {
    try {
      const ids: unknown = JSON.parse(inv.sessionIds || "[]");
      if (Array.isArray(ids)) for (const id of ids) out.add(String(id));
    } catch {
      // bewusst still, siehe oben
    }
  }
  return out;
}

/**
 * Lektionen aussortieren, die ein anderer ausgelieferter Beleg bereits abrechnet.
 *
 * Der Schutz gegen Doppelfakturierung. Ohne ihn entscheidet allein die AKTUELLE
 * Gruppenzugehoerigkeit, was auf die Rechnung kommt — und `billedToId` ist eine
 * bewegliche Spalte ohne Historie. Wird ein Kind von Eltern A zu Eltern B
 * umgehaengt, wandern auch die Monate mit, die auf A's ausgelieferter Rechnung
 * stehen, und werden ein zweites Mal in Rechnung gestellt.
 */
export function excludeAlreadyBilledSessions<T extends { id: string }>(
  sessions: T[],
  alreadyBilled: ReadonlySet<string>
): T[] {
  if (alreadyBilled.size === 0) return sessions;
  return sessions.filter((s) => !alreadyBilled.has(s.id));
}

export type RepricingGuardResult =
  | { allowed: true }
  | { allowed: false; billedMonths: InvoiceMonth[] };

/**
 * Darf eine Tarifaenderung die Betraege dieser Lektionen ueberschreiben?
 *
 * `allowed: false` heisst: KEINE Session anfassen, 409 zurueck. Ausgelieferte
 * Rechnungen bleiben unveraenderlich; korrigiert wird ueber eine Revision.
 * `confirmed` ist die ausdrueckliche Bestaetigung des Nutzers (confirmBilledMonths)
 * und die einzige Art, den Guard zu ueberstimmen — unveraendert zum bisherigen
 * Verhalten, nur dass jetzt auch Familienrechnungen im Umfang liegen.
 */
export function evaluateRepricingGuard(args: {
  affected: InvoiceMonth[];
  /** Ausgelieferte Rechnungen der ganzen Rechnungsgruppe (billingScopeStudentIds). */
  deliveredInScope: InvoiceMonth[];
  confirmed: boolean;
}): RepricingGuardResult {
  if (args.confirmed) return { allowed: true };
  const billedMonths = blockedDeliveredMonths(args.affected, args.deliveredInScope);
  return billedMonths.length > 0 ? { allowed: false, billedMonths } : { allowed: true };
}
