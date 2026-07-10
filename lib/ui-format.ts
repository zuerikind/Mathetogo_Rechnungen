/** Primary brand — links, buttons, focus rings */
export const TEAL = "#4A7FC1";
export const LILAC = "#7B6CB5";
export const BLUE_BG = "#EBF4FF";
export const LILAC_BG = "#F3F0FF";

/**
 * Dashboard charts — lebendig, aber an Markenfarbe TEAL (#4A7FC1) gebunden.
 * Teaching = Blau, Dance = Rose, Zusatz = Amber, Ersparnis = Smaragd.
 */
export const CHART_TEACHING = "#3568A8";
export const CHART_TEACHING_DIM = TEAL;
export const CHART_DANCE = "#CB4B7A";
export const CHART_DANCE_DIM = "#E8659A";
export const CHART_ADDITIONAL = "#D4920A";
export const CHART_ADDITIONAL_DIM = "#F0A830";
export const CHART_EXPENSE = "#EA580C";
export const CHART_EXPENSE_DIM = "#FB923C";
export const CHART_SAVINGS = "#059669";
export const CHART_SAVINGS_DIM = "#10B981";
export const CHART_SAVINGS_NEG = "#EF4444";
/** Kumulierte Linie — Indigo, harmoniert mit Blau und Grün */
export const CHART_CUMULATIVE = "#6366F1";

/** @deprecated Use CHART_ADDITIONAL */
export const AMBER = CHART_ADDITIONAL;

export const monthOptions = [
  { value: 1, label: "Januar" },
  { value: 2, label: "Februar" },
  { value: 3, label: "Maerz" },
  { value: 4, label: "April" },
  { value: 5, label: "Mai" },
  { value: 6, label: "Juni" },
  { value: 7, label: "Juli" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "Oktober" },
  { value: 11, label: "November" },
  { value: 12, label: "Dezember" },
];

const ZURICH_TZ = "Europe/Zurich";

const dateFormatter = new Intl.DateTimeFormat("de-CH", { timeZone: ZURICH_TZ });

/**
 * Swiss CHF display — manual formatting so SSR (Node) and the browser match.
 * `Intl.NumberFormat("de-CH")` uses `'` (U+2019) on the server and `'` (ASCII) in Chrome.
 */
export function formatCHF(amount: number): string {
  if (!Number.isFinite(amount)) return "CHF 0.00";

  const sign = amount < 0 ? "−" : "";
  const abs = Math.abs(amount);
  const [intPart, decPart] = abs.toFixed(2).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `${sign}CHF ${grouped}.${decPart}`;
}

export function formatDate(dateInput: string | Date): string {
  return dateFormatter.format(new Date(dateInput));
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}min`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}min`;
}

export function getCurrentMonthYear() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

/** Trim + collapse spaces so Session- und Abo-Zuordnung zum gleichen Schüler zusammenpasst. */
export function normStudentDisplayName(name: string | null | undefined): string {
  const t = (name ?? "").trim().replace(/\s+/g, " ");
  return t.length > 0 ? t : "Unbekannt";
}
