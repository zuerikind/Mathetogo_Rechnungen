/**
 * Einmalig: followup_log.csv → Tutor24Lead + Tutor24Message, Vorschau → Interessenten.
 * Zeigt Plaetze und Pipeline pro Kurs vorher (CSV) und nachher (Datenbank) nebeneinander.
 * Mehrfach ausfuehrbar: schon uebernommene Konversationen werden uebersprungen.
 * Danach heisst die CSV followup_log.migriert.csv (Archiv, wird nicht mehr gelesen).
 *
 *   npx tsx scripts/migrate-followup-log.mts
 */
import { config } from "dotenv";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";

config({ path: ".env.local" });

const { LOG_COLS, courseStats, effectiveStatus, followedUpIds, parseCsv, pipelineStage } = await import("../lib/tutor24-followup");
const { FOLLOWUP_DIR, LOG_PATH, loadCourses, loadSettings, readPreview } = await import("../lib/tutor24-followup-store");
const { fromPreview, loadLog, recordSend, syncPreviewLeads, updateLead } = await import("../lib/tutor24-leads");
const { prisma } = await import("../lib/prisma");
type LogRow = import("../lib/tutor24-followup").LogRow;

const courses = loadCourses();
const settings = loadSettings();

function summary(log: Array<Partial<LogRow>>) {
  const out: Record<string, string> = {};
  const logged = followedUpIds(log);
  // "Bereit" wie auf /kurse: jeder Kurs als aktiv gedacht, damit auch pausierte verglichen werden.
  const asActive = courses.map((c) => ({ ...c, active: true }));
  const rows = readPreview();
  for (const c of courses) {
    const bereit = rows.filter((r) => {
      const e = effectiveStatus(r, asActive, settings, logged, log);
      return e.send && e.course?.id === c.id;
    }).length;
    const st = courseStats(c, log);
    const stages = log.filter((r) => r.kurs === c.id).map((r) => `${r.name}:${pipelineStage(r)}`).sort();
    out[c.name] = `bereit ${bereit}, angeschrieben ${st.angeschrieben}, geantwortet ${st.geantwortet}, Zusagen ${st.zusagen}, bezahlt ${st.bezahlt}, ampel ${st.ampel} | ${stages.join(" ")}`;
  }
  return out;
}

const csvRows: LogRow[] = existsSync(LOG_PATH)
  ? parseCsv(readFileSync(LOG_PATH, "utf8")).map((r) => Object.fromEntries(LOG_COLS.map((c) => [c, r[c] ?? ""])) as LogRow)
  : [];
const before = summary(csvRows);
console.log(`Protokoll-CSV: ${csvRows.length} Zeilen`);

const preview = new Map(readPreview().map((r) => [r.conversation_id, r]));
const done = new Set(
  (await prisma.tutor24Message.findMany({ where: { art: "nachfassen" }, select: { lead: { select: { conversationId: true } } } })).map(
    (m) => m.lead.conversationId
  )
);
let neu = 0;
for (const r of csvRows) {
  if (done.has(r.conversation_id)) continue;
  const p = preview.get(r.conversation_id);
  const anrede = r.variante.endsWith("/du") ? "du" : "Sie";
  await recordSend({
    conversationId: r.conversation_id,
    inseratId: p?.inserat_id || null,
    name: r.name,
    art: "nachfassen",
    kursId: r.kurs || null,
    variante: r.variante,
    // Der damalige Text steht nicht im Protokoll (bei der Uebernahme am 4.11.2026 aus der Vorlage erzeugt).
    text: "",
    status: r.status === "unbestaetigt" ? "unbestaetigt" : "gesendet",
    lead: p ? fromPreview(p) : { quelle: "nachfassen", anrede },
    sentAt: new Date(r.zeitstempel),
  });
  await updateLead(r.conversation_id, {
    geantwortet: r.geantwortet, antwort_datum: r.antwort_datum, antwort: r.antwort, markierung: r.markierung, kurs: r.kurs,
  });
  neu++;
}
console.log(`Übernommen: ${neu} (schon vorhanden: ${csvRows.length - neu})`);

const synced = await syncPreviewLeads(readPreview(), settings);
console.log(`Interessenten aus der Vorschau: ${synced.neu} neu, ${synced.geaendert} ergänzt`);

const after = summary(await loadLog());
let same = true;
for (const name of Object.keys(before)) {
  const ok = before[name] === after[name];
  same &&= ok;
  console.log(`\n${ok ? "✓ gleich" : "✗ ANDERS"} — ${name}\n  vorher:  ${before[name]}\n  nachher: ${after[name]}`);
}
if (same && existsSync(LOG_PATH)) {
  renameSync(LOG_PATH, join(FOLLOWUP_DIR, "followup_log.migriert.csv"));
  console.log("\nCSV umbenannt in followup_log.migriert.csv (Archiv).");
} else if (!same) console.log("\nUnterschiede — CSV bleibt, bitte prüfen.");
await prisma.$disconnect();
