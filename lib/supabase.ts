import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const INVOICE_BUCKET = "invoices";

export function invoiceStoragePath(year: number, month: number, studentId: string): string {
  return `${year}-${String(month).padStart(2, "0")}-${studentId}.pdf`;
}

/**
 * Speicherort der PDF als URL — seit der Bucket privat ist, NICHT mehr abrufbar.
 * Der Wert dient nur noch als Vermerk in Invoice.pdfPath ("PDF existiert, liegt hier").
 * Ausgeliefert wird ausschliesslich über app/api/invoices/[id]/download.
 */
export function invoicePublicUrl(year: number, month: number, studentId: string): string {
  const path = invoiceStoragePath(year, month, studentId);
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${INVOICE_BUCKET}/${path}`;
}
