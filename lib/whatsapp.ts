import { formatAmount, getInvoiceDueDate, getPeriodLabel } from "@/lib/invoice";

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
  "Hallo zusammen,",
  "",
  "{monthLabel} ist vorbei und ich schicke euch die Abrechnung der Lektionen für {studentName} ({amountCHF}) und die Informationen für die Überweisung:",
  "",
  "Anbei habt ihr die Abrechnung von den letzten Lektionen. Das Geld könnt ihr mir gerne auf mein Konto überweisen (z. B. per QR-Code oder Twint), die Informationen findet ihr direkt hier:",
  "",
  "Konto Inhaber: Omid Shams",
  "IBAN: CH68 8080 8006 1552 5435 4",
  "",
  "Wenn ihr es twinten wollt könnt ihr das direkt auf diese Nummer: 0772886085",
  "",
  "Das Geld könnt ihr auch weiterhin direkt über Revolut überweisen: https://revolut.me/omidr83to",
  "",
  "Fälligkeit: {dueDate}",
  "Rechnungsnummer: {invoiceNumber}",
  "",
  "Falls ihr Fragen habt, lasst es mich wissen.",
  "Liebe Grüsse",
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
  const dueDate = args.dueDate ?? getInvoiceDueDate(args.year, args.month);
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
