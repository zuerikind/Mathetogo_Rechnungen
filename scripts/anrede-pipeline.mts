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
const { detectAddressee, findDuForm } = await import("../lib/tutor24-followup");
const { followupForm } = await import("../lib/tutor24-course-offer");
const { prisma } = await import("../lib/prisma");

const SAVE = process.argv.includes("--speichern");
const cachePath = `${FOLLOWUP_DIR}/course_offer_listings.json`;
const cache: Record<string, { info?: { description?: string } | null }> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
const leads = await loadLeadInfo();
const rows = readPreview();
const firstDu = new Date("2026-11-07T00:00:00Z");
/**
 * Regel (Omid, 9.11.): Es gilt die Anrede der letzten Nachricht, die die Person von mir bekommen hat.
 * Wer schon ein Nachfassen (seit 28.10.) oder eine neue Erst-Nachricht bekam, bleibt dabei. Nur wer bisher
 * ausschliesslich die alte du-Erst-Nachricht bekam (vor dem 7.11., nicht in Tutor24Message) und selbst schreibt
 * (Inserat in der Ich-Form), wechselt auf du.
 */
const msgs = await prisma.tutor24Message.findMany({
  select: { art: true, variante: true, text: true, sentAt: true, lead: { select: { conversationId: true } } },
  orderBy: { sentAt: "asc" },
});
const lastMsg = new Map<string, (typeof msgs)[number]>();
for (const m of msgs) if (m.lead.conversationId) lastMsg.set(m.lead.conversationId, m);
const anredeOf = (m: (typeof msgs)[number]) =>
  /\/du(\/|$)/.test(m.variante) ? "du" : /\/Sie(\/|$)/.test(m.variante) ? "Sie" : findDuForm(m.text) ? "du" : "Sie";
const fmt = (d: Date) => d.toLocaleDateString("de-CH");
const changes: { id: string; name: string; jetzt: string; grund: string }[] = [];
const bleibt: { id: string; name: string; letzte: string }[] = [];
for (const r of rows) {
  const lead = leads[r.conversation_id];
  const f = followupForm(lead, r.anrede);
  if (f.typ === "du" || f.typ === "en" || f.typ === "fr") continue;
  const text = cache[r.conversation_id]?.info?.description ?? "";
  const selbst = lead?.wer === "schueler" || (!!text && detectAddressee(text).wer === "schueler");
  const m = lastMsg.get(r.conversation_id);
  const jetzt = f.typ === "eltern" ? "Eltern (Sie)" : "unklar (Sie)";
  if (m) {
    const letzte = `${m.art === "erst" ? "Erst-Nachricht" : "Nachfassen"} am ${fmt(m.sentAt)}, ${anredeOf(m)}-Form`;
    // letzte Nachricht war du, geplant waere jetzt Sie: zurueck auf du (unabhaengig von der Ich-Form)
    if (anredeOf(m) === "du") changes.push({ id: r.conversation_id, name: r.name, jetzt, grund: `letzte Nachricht: ${letzte}` });
    else if (selbst) bleibt.push({ id: r.conversation_id, name: r.name, letzte });
    continue;
  }
  if (selbst) changes.push({ id: r.conversation_id, name: r.name, jetzt, grund: "letzte Nachricht: nur die alte Erst-Nachricht (vor 7.11., du-Form); Inserat in der Ich-Form" });
}
const link = (id: string) => `https://www.tutor24.ch/de/conversations/${id}?tab=sent`;
const md =
  `# Nachfassen: Anrede nach der letzten Nachricht (${new Date().toLocaleString("de-CH")})

` +
  `## Wechsel auf du (${changes.length})

| Name | Chat | Nachfassen heute | Grund |
|---|---|---|---|
` +
  changes.map((c) => `| ${c.name} | ${link(c.id)} | ${c.jetzt} | ${c.grund} |`).join("\n") +
  `

## Bleibt bei Sie (${bleibt.length}) (letzte Nachricht in der Sie-Form)

| Name | Chat | letzte Nachricht |
|---|---|---|
` +
  bleibt.map((c) => `| ${c.name} | ${link(c.id)} | ${c.letzte} |`).join("\n") + "\n";
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
