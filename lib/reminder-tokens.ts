/**
 * Platzhalter-Ersetzung für die Mahnwesen-Vorlagen.
 * Reine Funktion, keine DB/React-Abhängigkeit — im Client wie im Test nutzbar.
 * Alle Datumsberechnungen in Europe/Zurich (nicht UTC).
 */

import { getInvoiceDueDate } from "@/lib/invoice-format";

export type ReminderTokenInput = {
  /** Anzeigename des Schülers (Familienrechnung: Hauptschüler). */
  name: string;
  /** Rechnungsbetrag in CHF. */
  totalCHF: number;
  /** Rechnungsnummer, z. B. "2026-0042". */
  invoiceNumber: string;
  /** Rechnungsperiode (1–12). */
  month: number;
  /** Jahr der Rechnungsperiode. */
  year: number;
};

const ZURICH_TZ = "Europe/Zurich";

const monthNameFmt = new Intl.DateTimeFormat("de-CH", { month: "long", timeZone: ZURICH_TZ });
const zurichPartsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZURICH_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** {betrag}: Schweizer Format, Apostroph-Tausender, zwei Dezimalstellen, ohne Währungssymbol. */
export function formatBetrag(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const [intPart, decPart] = Math.abs(safe).toFixed(2).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `${safe < 0 ? "-" : ""}${grouped}.${decPart}`;
}

/** Mid-day UTC hält den Zürcher Kalendertag stabil (kein Mitternachts-Überlauf). */
function zurichDateParts(utcDate: Date): { d: string; m: string; y: string } {
  const parts = Object.fromEntries(
    zurichPartsFmt.formatToParts(utcDate).map((p) => [p.type, p.value])
  );
  return { d: parts.day, m: parts.month, y: parts.year };
}

/** {periode}: deutscher Monatsname allein, z. B. "Juni" — ohne Jahr. */
export function formatPeriode(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month - 1, 15, 12, 0, 0));
  const name = monthNameFmt.format(d);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * {faelligkeit}: DD.MM.YYYY. Einzige Fälligkeitsquelle ist getInvoiceDueDate — dieselbe,
 * die die Rechnungs-PDF nutzt. So können Mahnung und PDF nie auseinanderlaufen, auch wenn
 * die Regel (15. des Folgemonats) je konfigurierbar wird.
 */
export function formatFaelligkeit(year: number, month: number): string {
  const { d: dd, m: mm, y: yyyy } = zurichDateParts(getInvoiceDueDate(year, month));
  return `${dd}.${mm}.${yyyy}`;
}

/**
 * Welche Erinnerungsstufe ist fällig — anhand der Tage seit Fälligkeit.
 * Schwellen decken sich mit den Vorlagentexten (10 bzw. 20 Tage nach Zahlungsdatum).
 * Nur ein Hinweis; die Stufe wird NICHT automatisch gewählt oder versendet.
 */
export type DueReminder = { stage: 1 | 2 | 3; label: string } | null;

export function dueReminderStage(daysOverdue: number): DueReminder {
  if (daysOverdue >= 20) return { stage: 3, label: "Mahnung fällig" };
  if (daysOverdue >= 10) return { stage: 2, label: "2. Erinnerung fällig" };
  if (daysOverdue >= 0) return { stage: 1, label: "1. Erinnerung fällig" };
  return null;
}

/**
 * Ersetzt alle {token}-Vorkommen (global) anhand der Rechnungsdaten.
 * Unbekannte Tokens bleiben als Literal stehen — werden nicht geleert.
 */
export function renderReminder(template: string, input: ReminderTokenInput): string {
  const map: Record<string, string> = {
    name: input.name,
    betrag: formatBetrag(input.totalCHF),
    rechnungsnummer: input.invoiceNumber,
    faelligkeit: formatFaelligkeit(input.year, input.month),
    periode: formatPeriode(input.year, input.month),
  };
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(map, key) ? map[key] : whole
  );
}
