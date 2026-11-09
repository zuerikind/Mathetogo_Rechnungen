/**
 * Anrede im Nachfassen pruefen (9.11.): Alle Erst-Nachrichten vor dem 7.11. waren in der du-Form.
 * Wer damals geduzt wurde und Schueler/in ist, soll im Nachfassen auch du bekommen.
 *   npx tsx scripts/anrede-pipeline.mts             nur Liste → tutor24-followup/anrede_liste.md (aendert nichts)
 *   npx tsx scripts/anrede-pipeline.mts --speichern  setzt diese Personen in Tutor24Lead auf du (nur nach Omids OK)
 * Schueler/in: laut gespeicherter Analyse (wer) oder laut Inserattext (detectAddressee); unklar bleibt unklar.
 */
import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
config({ path: ".env.local" });
const { readPreview, loadLeadInfo, FOLLOWUP_DIR } = await import("../lib/tutor24-followup-store");
const { detectAddressee } = await import("../lib/tutor24-followup");
const { followupForm } = await import("../lib/tutor24-course-offer");
const { prisma } = await import("../lib/prisma");

const SAVE = process.argv.includes("--speichern");
const cachePath = `${FOLLOWUP_DIR}/course_offer_listings.json`;
const cache: Record<string, { info?: { description?: string } | null }> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
const leads = await loadLeadInfo();
const rows = readPreview();
const firstDu = new Date("2026-11-07T00:00:00Z");
const changes: { id: string; name: string; jetzt: string; grund: string }[] = [];
for (const r of rows) {
  const lead = leads[r.conversation_id];
  if (lead?.quelle === "erstnachricht" && lead.erstAm && new Date(lead.erstAm) >= firstDu) continue; // neue Erst-Nachricht: Anrede steht schon richtig
  const f = followupForm(lead, r.anrede);
  if (f.typ === "du" || f.typ === "en" || f.typ === "fr") continue;
  const text = cache[r.conversation_id]?.info?.description ?? "";
  const ausText = text ? detectAddressee(text).wer : null;
  const grund = lead?.wer === "schueler" ? "gespeichert: Schüler/in" : ausText === "schueler" ? "Inserat in der Ich-Form (Schüler/in)" : null;
  if (grund) changes.push({ id: r.conversation_id, name: r.name, jetzt: f.typ === "eltern" ? "Eltern (Sie)" : "unklar (Sie)", grund });
}
const md = `# Nachfassen: du statt Sie (Vorschlag ${new Date().toLocaleString("de-CH")})\n\n${changes.length} von ${rows.length} Personen in der Pipeline.\n\n| Name | Chat | heute | Grund |\n|---|---|---|---|\n` +
  changes.map((c) => `| ${c.name} | https://www.tutor24.ch/de/conversations/${c.id}?tab=sent | ${c.jetzt} | ${c.grund} |`).join("\n") + "\n";
writeFileSync(`${FOLLOWUP_DIR}/anrede_liste.md`, md);
console.log(md);
if (SAVE) {
  for (const c of changes) {
    const lead = await prisma.tutor24Lead.findFirst({ where: { conversationId: c.id } });
    if (lead) await prisma.tutor24Lead.update({ where: { id: lead.id }, data: { anrede: "du", wer: "schueler" } });
    else await prisma.tutor24Lead.create({ data: { conversationId: c.id, name: c.name, quelle: "nachfassen", anrede: "du", wer: "schueler" } });
  }
  console.log(`${changes.length} gespeichert.`);
}
await prisma.$disconnect();
