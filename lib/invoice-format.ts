import { formatCHF } from "./ui-format";

const ZURICH_TZ = "Europe/Zurich";

const monthFormatter = new Intl.DateTimeFormat("de-CH", { month: "long", timeZone: ZURICH_TZ });
const dateFormatter = new Intl.DateTimeFormat("de-CH", { timeZone: ZURICH_TZ });

export function formatDate(date: Date): string {
  return dateFormatter.format(date);
}

export function formatAmount(amount: number): string {
  return formatCHF(amount);
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}min`;
}

export function getPeriodLabel(month: number, year: number): string {
  const monthName = monthFormatter.format(new Date(year, month - 1, 1));
  return `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} ${year}`;
}

export function getInvoiceDueDate(year: number, month: number): Date {
  // "Mid next month": always the 15th of the month after invoice period.
  return new Date(year, month, 15);
}

/**
 * Kopfzeile einer neu ausgestellten Rechnung. Die Rechnungsnummer bleibt
 * unveraendert — der Empfaenger haelt also zwei Dokumente mit derselben Nummer
 * in der Hand. Genau deshalb muss hier stehen, welches das juengere ist und
 * welche Fassung es ersetzt; sonst wirkt die Neuausstellung wie ein Duplikat.
 *
 * null fuer Revision 1: die Erstausstellung ersetzt nichts.
 */
export function getRevisionNotice(revision: number, replacedAt: Date | null): string | null {
  if (revision <= 1) return null;
  return replacedAt
    ? `Revision ${revision} — ersetzt die Fassung vom ${formatDate(replacedAt)}`
    : `Revision ${revision} — ersetzt die vorherige Fassung`;
}

export function getStudentInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}
