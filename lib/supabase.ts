import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Pfadlogik liegt in lib/invoice-storage-path.ts (client-frei, testbar) und wird
// hier weitergereicht, damit die bestehenden Importe unveraendert bleiben.
export { INVOICE_BUCKET, invoiceStoragePath, invoicePublicUrl } from "@/lib/invoice-storage-path";
