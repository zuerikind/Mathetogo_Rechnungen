/**
 * Nachfassen mit dem Gruppenkurs-Angebot auf tutor24.ch — Kommandozeile.
 * Dieselbe Logik steuert der Tab "Nachfassen Gruppenkurs" in der App (/tutor24).
 *
 * Schritt 1 (Standard, sendet NICHTS):
 *   npx tsx scripts/followup_group_offer.mts [--max 150]
 *   → tutor24-followup/followup_preview.csv. Klassifiziert ALLE Konversationen,
 *     speichert nach jeder; ein neuer Lauf setzt dort fort.
 *
 * Schritt 2 (nach Pruefung der CSV und Haken bei den Stufen im Tab):
 *   npx tsx scripts/followup_group_offer.mts --send
 *   → nur status=send UND Stufe angehakt (tutor24-followup/settings.json),
 *     hoechstens 25 pro Tag, 60–180 s Pause, Protokoll in followup_log.csv
 *
 * Option --headed zeigt den Browser. Logik: lib/tutor24-followup-runner.ts.
 */
import { config } from "dotenv";
import { followupJobState } from "../lib/automation-state";
import { runFollowup } from "../lib/tutor24-followup-runner";

config({ path: ".env.local" });

const SEND = process.argv.includes("--send");
const maxArg = process.argv.indexOf("--max");
const maxChecks = maxArg > -1 ? Number(process.argv[maxArg + 1]) : 150;
if (!Number.isInteger(maxChecks) || maxChecks < 1) {
  console.error("--max braucht eine ganze Zahl ≥ 1, z.B. --max 150");
  process.exit(1);
}

try {
  await runFollowup({
    mode: SEND ? "send" : "preview",
    maxChecks,
    headless: !process.argv.includes("--headed"),
    onLog: (line) => console.log(line),
  });
  process.exit(0);
} catch (err) {
  // Abbrueche im Lauf hat onLog schon gemeldet; hier nur, was davor scheiterte (Sperre, .env).
  if (!followupJobState.log.some((l) => l.startsWith("✖")))
    console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
