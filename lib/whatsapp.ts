import { formatAmount, getPeriodLabel } from "@/lib/invoice";

export type WhatsAppTemplateValues = {
  studentName: string;
  parentName: string;
  monthLabel: string;
  amountCHF: string;
  dueDate: string;
  invoiceNumber: string;
  tutorName: string;
};

export const defaultWhatsAppTemplate = [
  "Hallo {parentName},",
  "",
  "anbei sende ich dir die Rechnung fuer {studentName} ({monthLabel}) ueber {amountCHF}.",
  "Bitte bis {dueDate} begleichen.",
  "",
  "Rechnungsnummer: {invoiceNumber}",
  "Vielen Dank und liebe Gruesse",
  "{tutorName}",
].join("\n");

export function buildWhatsAppValues(args: {
  studentName: string;
  parentName?: string;
  year: number;
  month: number;
  totalCHF: number;
  invoiceNumber?: string;
  tutorName?: string;
  dueDate?: Date;
}): WhatsAppTemplateValues {
  const dueDate = args.dueDate ?? new Date(args.year, args.month, 7);
  return {
    studentName: args.studentName,
    parentName: args.parentName?.trim() || "Familie",
    monthLabel: getPeriodLabel(args.month, args.year),
    amountCHF: formatAmount(args.totalCHF),
    dueDate: new Intl.DateTimeFormat("de-CH").format(dueDate),
    invoiceNumber: args.invoiceNumber?.trim() || `${args.year}-${String(args.month).padStart(2, "0")}`,
    tutorName: args.tutorName?.trim() || "Dein Nachhilfelehrer",
  };
}

export function renderWhatsAppTemplate(
  template: string,
  values: WhatsAppTemplateValues
): string {
  return template
    .replaceAll("{studentName}", values.studentName)
    .replaceAll("{parentName}", values.parentName)
    .replaceAll("{monthLabel}", values.monthLabel)
    .replaceAll("{amountCHF}", values.amountCHF)
    .replaceAll("{dueDate}", values.dueDate)
    .replaceAll("{invoiceNumber}", values.invoiceNumber)
    .replaceAll("{tutorName}", values.tutorName);
}

export function buildWhatsAppUrl(message: string, phone?: string): string {
  const cleaned = (phone ?? "").replace(/[^\d+]/g, "");
  const encoded = encodeURIComponent(message);
  if (cleaned) {
    return `https://wa.me/${cleaned}?text=${encoded}`;
  }
  return `https://wa.me/?text=${encoded}`;
}
