import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first");
  process.exit(1);
}

const supabase = createClient(url, key);

// Der Bucket ist privat: Rechnungen enthalten IBAN, Beträge und Namen und werden
// ausschliesslich über den authentifizierten Download der App ausgeliefert
// (app/api/invoices/[id]/download). Ein öffentlicher Bucket würde dieses Tracking
// umgehbar machen und die Dokumente ohne Login lesbar lassen.
async function setup() {
  const { data: buckets } = await supabase.storage.listBuckets();
  const existing = buckets?.find((b) => b.name === "invoices");

  if (existing) {
    if (!existing.public) {
      console.log("✓ invoices bucket already exists and is private");
      return;
    }
    const { error } = await supabase.storage.updateBucket("invoices", { public: false });
    if (error) {
      console.error("✗ Failed to make bucket private:", error.message);
      process.exit(1);
    }
    console.log("✓ invoices bucket switched to private");
    return;
  }

  const { error } = await supabase.storage.createBucket("invoices", { public: false });
  if (error) {
    console.error("✗ Failed to create bucket:", error.message);
    process.exit(1);
  }
  console.log("✓ invoices bucket created (private)");
}

setup();
