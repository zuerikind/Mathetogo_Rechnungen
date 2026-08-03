/**
 * Speicherorte der Rechnungs-PDFs — reine Pfadlogik, ohne Storage-Client.
 * Bewusst getrennt von lib/supabase.ts: dort entsteht beim Import sofort ein
 * Client samt Env-Pflicht, und daran soll eine Pfadberechnung nicht haengen.
 */
export const INVOICE_BUCKET = "invoices";

/**
 * Ab Revision 2 versioniert. Revision 1 behaelt den unversionierten Pfad: der
 * Bestand liegt dort, und ein Umbenennen ausgelieferter Dokumente waere genau
 * das Anfassen, das die Versionierung verhindern soll. Jede Neuausstellung
 * schreibt daneben, nie darueber — InvoiceSnapshot.pdfPath haelt pro Revision
 * fest, welche Datei ausgeliefert wurde.
 */
export function invoiceStoragePath(
  year: number,
  month: number,
  studentId: string,
  revision = 1
): string {
  const base = `${year}-${String(month).padStart(2, "0")}-${studentId}`;
  return revision <= 1 ? `${base}.pdf` : `${base}-r${revision}.pdf`;
}

/**
 * Speicherort als URL — seit der Bucket privat ist, NICHT mehr abrufbar.
 * Der Wert dient nur noch als Vermerk in Invoice.pdfPath ("PDF existiert, liegt hier").
 * Ausgeliefert wird ausschliesslich ueber app/api/invoices/[id]/download.
 */
export function invoicePublicUrl(
  year: number,
  month: number,
  studentId: string,
  revision = 1
): string {
  const path = invoiceStoragePath(year, month, studentId, revision);
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${INVOICE_BUCKET}/${path}`;
}
