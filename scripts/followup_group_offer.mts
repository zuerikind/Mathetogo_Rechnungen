/**
 * Nachfassen mit dem Gruppenkurs-Angebot auf tutor24.ch — Kommandozeile.
 * Dieselbe Logik steuert der Tab "Nachfassen Gruppenkurs" in der App (/tutor24).
 *
 * Schritt 1 (Standard, sendet NICHTS):
 *   npx tsx scripts/followup_group_offer.mts [--max 150]
 *   → tutor24-followup/followup_preview.csv. Klassifiziert ALLE Konversationen,
 *     speichert nach jeder; ein neuer Lauf setzt dort fort.
 *
 * Schritt 2 (nach Pruefung der CSV und mit aktiven Kursen im Tab):
 *   npx tsx scripts/followup_group_offer.mts --send
 *   → nur status=send MIT passendem aktivem Kurs (tutor24-followup/courses.json),
 *     hoechstens 25 pro Tag, 60–180 s Pause, Protokoll in followup_log.csv
 *
 * Antworten pruefen (nur lesend, nur Konversationen aus followup_log.csv):
 *   npx tsx scripts/followup_group_offer.mts --replies
 *
 * Vergleich fuer "Inserat nur bei Bedarf" (nur lesend, aendert die Vorschau nicht):
 *   npx tsx scripts/followup_group_offer.mts --compare 20
 *   → tutor24-followup/compare.csv: Unterschiede nur Konversation vs. Konversation + Inserat
 *
 * Jeder Lauf schreibt seine Zeitmessung nach tutor24-followup/timing.csv.
 * Option --headed zeigt den Browser. Logik: lib/tutor24-followup-runner.ts.
 */
import { config } from "dotenv";
import { followupJobState } from "../lib/automation-state";
import { runFollowup } from "../lib/tutor24-followup-runner";

config({ path: ".env.local" });

const SEND = process.argv.includes("--send");
const compareArg = process.argv.indexOf("--compare");
const maxArg = compareArg > -1 ? compareArg : process.argv.indexOf("--max");
const maxChecks = maxArg > -1 ? Number(process.argv[maxArg + 1]) : 150;
if (!Number.isInteger(maxChecks) || maxChecks < 1) {
  console.error("--max/--compare brauchen eine ganze Zahl ≥ 1, z.B. --max 150 oder --compare 20");
  process.exit(1);
}

try {
  await runFollowup({
    mode: SEND ? "send" : process.argv.includes("--replies") ? "replies" : compareArg > -1 ? "compare" : "preview",
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
