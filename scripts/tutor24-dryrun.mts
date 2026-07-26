/**
 * Dry-Run gegen tutor24.ch: läuft den Kontakt-Flow bis zum Nachrichtenformular
 * und stoppt dort. Es wird NIE getippt und NIE abgeschickt.
 *
 * Zweck: belegen, dass ein ElementHandle nach der /messages/new-Navigation auf der
 * echten Seite tot ist und dass das Neu-Suchen des Buttons danach funktioniert.
 *
 * Run: npx tsx scripts/tutor24-dryrun.ts [jobId ...]
 */
import { config } from "dotenv";
import { chromium } from "playwright";
import {
  TUTOR24_BASE_URL,
  acceptTutor24Cookies,
  findContactButton,
  gotoTutor24,
  loginToTutor24,
  sleep,
  waitForMessageTextarea,
} from "../lib/tutor24-messaging";

config({ path: ".env.local" });

const email = process.env.TUTOR24_EMAIL;
const password = process.env.TUTOR24_PASSWORD;
if (!email || !password) {
  console.error("TUTOR24_EMAIL / TUTOR24_PASSWORD fehlen in .env.local");
  process.exit(1);
}

const jobIds = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["5967929", "5966922", "5966561", "5965261"];

const log = (s: string) => console.log(s);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
});

type Row = {
  id: string;
  button: string;
  navigated: boolean;
  staleHandle: string;
  refound: string;
  probe1500: string;
  form: string;
};
const rows: Row[] = [];

try {
  await loginToTutor24(page, email, password, log);

  for (const id of jobIds) {
    const row: Row = {
      id,
      button: "—",
      navigated: false,
      staleHandle: "n/a",
      refound: "n/a",
      probe1500: "n/a",
      form: "—",
    };
    console.log(`\n=== Job ${id} ===`);

    try {
      await gotoTutor24(page, `${TUTOR24_BASE_URL}/de/jobs/${id}`, log);
      await acceptTutor24Cookies(page, log);
      await sleep(1500);
      console.log(`URL: ${page.url()}`);

      const btn = await findContactButton(page);
      if (!btn) {
        row.button = "kein Button";
        rows.push(row);
        continue;
      }

      const href = await btn.getAttribute("href");
      const text = (await btn.evaluate((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim())) || "";
      row.button = `«${text.slice(0, 30)}» ${href ?? "(js)"}`;
      console.log(`Button: ${row.button}`);

      if (href?.includes("/messages/new")) {
        const dest = href.startsWith("http") ? href : `${TUTOR24_BASE_URL}${href}`;
        await gotoTutor24(page, dest, log);
        await acceptTutor24Cookies(page, log);
        await sleep(1200);
        row.navigated = true;
        console.log(`Navigiert nach: ${page.url()}`);

        // Beweis: genau dieser Zugriff war der Absturz im Live-Log.
        try {
          await btn.getAttribute("href");
          row.staleHandle = "lebt noch (kein Kontextverlust)";
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          row.staleHandle = msg.includes("Execution context was destroyed")
            ? "TOT (Execution context destroyed) ← alter Crash"
            : `Fehler: ${msg.slice(0, 60)}`;
        }
        console.log(`Altes Handle: ${row.staleHandle}`);

        // Exakt die Probe aus sendMessageOnListing: nur wenn sie fehlschlägt, wurde
        // früher das tote Handle angefasst → genau hier entstand der Crash.
        const t0 = Date.now();
        const quick = await waitForMessageTextarea(page, 1500);
        row.probe1500 = quick
          ? `Formular in ${Date.now() - t0} ms → kein Crash-Pfad`
          : "kein Formular in 1500 ms → ALTER CRASH-PFAD";
        console.log(`1500-ms-Probe: ${row.probe1500}`);

        const fresh = await findContactButton(page);
        row.refound = fresh ? "Button neu gefunden" : "kein Button (openMessageForm übernimmt)";
        console.log(`Neu gesucht: ${row.refound}`);
      }

      const ta = await waitForMessageTextarea(page, 8000);
      row.form = ta ? "Formular offen ✓" : "kein Textfeld";
      console.log(`Formular: ${row.form}  (nichts getippt, nichts gesendet)`);
    } catch (e) {
      row.form = `EXCEPTION: ${e instanceof Error ? e.message : String(e)}`;
      console.log(`✗ ${row.form}`);
    }
    rows.push(row);
  }
} finally {
  await browser.close();
}

console.log("\n===== Zusammenfassung (kein Versand) =====");
console.table(rows);
