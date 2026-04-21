import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first");
  process.exit(1);
}

const supabase = createClient(url, key);

async function setup() {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === "invoices");

  if (exists) {
    console.log("✓ invoices bucket already exists");
    return;
  }

  const { error } = await supabase.storage.createBucket("invoices", { public: true });
  if (error) {
    console.error("✗ Failed to create bucket:", error.message);
    process.exit(1);
  }
  console.log("✓ invoices bucket created");
}

setup();
