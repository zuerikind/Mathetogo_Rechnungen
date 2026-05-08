const monthFormatter = new Intl.DateTimeFormat("de-CH", { month: "long" });
const dateFormatter = new Intl.DateTimeFormat("de-CH");

const chfFormatter = new Intl.NumberFormat("de-CH", {
  style: "currency",
  currency: "CHF",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatDate(date: Date): string {
  return dateFormatter.format(date);
}

export function formatAmount(amount: number): string {
  return chfFormatter.format(amount);
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

export function getStudentInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}
