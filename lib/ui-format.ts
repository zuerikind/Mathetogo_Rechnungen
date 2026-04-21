export const TEAL = "#4A7FC1";
export const LILAC = "#7B6CB5";
export const BLUE_BG = "#EBF4FF";
export const LILAC_BG = "#F3F0FF";

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

const amountFormatter = new Intl.NumberFormat("de-CH", {
  style: "currency",
  currency: "CHF",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat("de-CH");

export function formatCHF(amount: number): string {
  return amountFormatter.format(amount);
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
