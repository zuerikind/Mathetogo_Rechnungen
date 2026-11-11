/**
 * Pruef-Agent auf gespeicherten Daten testen (nie tutor24, sendet nichts an Interessenten, schreibt nichts in die DB):
 *   A  Omids Batches 9./10.11. (gesendet, alle fuer gut befunden) — Ziel: hoechstens 2 auffaellig
 *   B  neu erstellte Erst-Nachrichten zu gespeicherten Inseraten (course_offer_listings.json)
 *   C  bisher gesendete Nachfassen
 *   npx tsx scripts/pruefagent-test.mts [--neu 60] [--telegram]   → tutor24-followup/pruefagent_test.json/.md
 */
import { config } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
config({ path: ".env.local" });

const { pruefAgent } = await import("../lib/tutor24-pruefagent");
const { composeFirstMessage } = await import("../lib/tutor24");
const { agenturVerdacht, matheNebenfach } = await import("../lib/tutor24-course-offer");
const { resolveTargetLanguage, TUTOR24_BASE_URL } = await import("../lib/tutor24-messaging");
const { notify } = await import("../lib/tutor24-autopilot");
const { prisma } = await import("../lib/prisma");
type ListingInfo = import("../lib/tutor24-followup").ListingInfo;
type AgentInput = import("../lib/tutor24-pruefagent").AgentInput;

const arg = (n: string) => process.argv[process.argv.indexOf(n) + 1];
const NEU = process.argv.includes("--neu") ? Number(arg("--neu")) : 60;

type Fall = { gruppe: "A" | "B" | "C" | "K"; id: string; titel: string; input: AgentInput; urteil?: string; grund?: string };
const faelle: Fall[] = [];

// A + C: aus der Datenbank; Inserat aus batch.json (10.11., volles Inserat) bzw. aus dem Lead (Auszug, 300 Zeichen)
const batch = JSON.parse(readFileSync("tutor24-followup/batch.json", "utf8")) as { items: { id: string; info?: ListingInfo }[] };
const batchInfo = new Map(batch.items.filter((i) => i.info).map((i) => [i.id, i.info!]));
const msgs = await prisma.tutor24Message.findMany({ where: { status: "gesendet" }, include: { lead: true }, orderBy: { sentAt: "asc" } });
for (const m of msgs) {
  const tag = m.sentAt.toISOString().slice(0, 10);
  if (m.art === "erst" && !["2026-11-09", "2026-11-10"].includes(tag)) continue;
  const info = m.lead.inseratId ? batchInfo.get(m.lead.inseratId) : undefined;
  faelle.push({
    gruppe: m.art === "erst" ? "A" : "C",
    id: m.lead.inseratId ?? m.lead.conversationId ?? m.id,
    titel: info?.title ?? m.lead.name,
    input: {
      art: m.art === "erst" ? "erst" : "nachfassen",
      titel: info?.title ?? m.lead.name,
      fach: info?.fach ?? m.lead.faecher,
      stufe: info?.schulstufe ?? m.lead.stufe,
      beschreibung: info?.description ?? m.lead.auszug,
      text: m.text,
    },
  });
}
await prisma.$disconnect();

// B: neu erstellt wie im Durchgang (ohne Agentur/Nebenfach/Pruefung nicht bestanden — die kaemen nie zum Agenten)
const cache: Record<string, { info: ListingInfo | null }> = JSON.parse(readFileSync("tutor24-followup/course_offer_listings.json", "utf8"));
const kandidaten = Object.entries(cache).filter(([, c]) => c.info?.description && !agenturVerdacht(c.info) && !matheNebenfach(c.info));
const sprache = (i: ListingInfo) => resolveTargetLanguage(`${TUTOR24_BASE_URL}/de/jobs/0`, "de", i.title, i.description).language;
// alle englischen/franzoesischen, der Rest gleichmaessig verteilt
const fremd = kandidaten.filter(([, c]) => sprache(c.info!) !== "de");
const de = kandidaten.filter(([, c]) => sprache(c.info!) === "de");
const step = de.length / Math.max(1, NEU - fremd.length);
const auswahl = [...fremd.slice(0, NEU), ...Array.from({ length: Math.max(0, NEU - fremd.length) }, (_, k) => de[Math.floor(k * step)]).filter(Boolean)].slice(0, NEU);
let pruefungNicht = 0;
for (const [id, c] of auswahl) {
  const info = c.info!;
  const composed = await composeFirstMessage(info, () => {}, new Date(), sprache(info));
  if (composed.problem) {
    pruefungNicht++;
    continue;
  }
  faelle.push({ gruppe: "B", id, titel: info.title, input: { art: "erst", titel: info.title, fach: info.fach, stufe: info.schulstufe, beschreibung: info.description, text: composed.text } });
}

// K: Kontrolle — absichtlich fehlerhafte Fassungen von Batch-Nachrichten; der Agent soll sie (fast) alle finden
const basis = faelle.filter((f) => f.gruppe === "A" && /Ihr Kind/.test(f.input.text));
const en = faelle.find((f) => f.gruppe === "A" && /^Hello/.test(f.input.text));
const kaputt: [string, (t: string) => string, Partial<AgentInput>?][] = [
  ["erfundene Prüfung mit Notenversprechen", (t) => t.replace(/(Freundliche Grüsse)/, "Für die Matura im Juni garantiere ich Ihrem Kind mindestens eine 5.5.\n\n$1")],
  ["Platzhalter statt Name", (t) => t.replace(/Omid\s*$/, "[Ihr Name]")],
  ["abgeschnitten", (t) => t.slice(0, Math.floor(t.length * 0.45))],
  ["du an Eltern", (t) => t.replace(/Ihr Kind/g, "du").replace(/Ihrem Kind/g, "dir").replace(/Sie /g, "du ").replace(/Guten Tag/, "Hallo")],
  ["falsches Geschlecht", (t) => t.replace(/Ihr Kind/g, "Ihre Tochter").replace(/Ihrem Kind/g, "Ihrer Tochter"), { beschreibung: "Unser Sohn (12) braucht Unterstützung in Mathematik, 6. Klasse Primarschule. Einzelunterricht bei uns zuhause." }],
];
for (const [i, [was, f, extra]] of kaputt.entries()) {
  const b = basis[i % Math.max(1, basis.length)];
  if (b) faelle.push({ gruppe: "K", id: `kontrolle-${i + 1}`, titel: `Kontrolle: ${was}`, input: { ...b.input, ...extra, text: f(b.input.text) } });
}
if (en) {
  const de = basis[0];
  if (de) faelle.push({ gruppe: "K", id: "kontrolle-sprache", titel: "Kontrolle: deutsche Nachricht auf englisches Inserat", input: { ...en.input, text: de.input.text } });
}

for (const [k, f] of faelle.entries()) {
  const u = await pruefAgent(f.input);
  f.urteil = u.urteil;
  f.grund = u.grund;
  console.log(`${k + 1}/${faelle.length} ${f.gruppe} ${f.id} ${u.urteil} ${u.grund}`);
}

const name = { A: "Deine Batches 9./10.11.", B: "Neu erstellte Erst-Nachrichten", C: "Gesendete Nachfassen", K: "Kontrolle (absichtlich fehlerhaft, soll auffallen)" } as const;
const zeile = (g: "A" | "B" | "C" | "K") => {
  const x = faelle.filter((f) => f.gruppe === g);
  const a = x.filter((f) => f.urteil === "auffaellig");
  const e = x.filter((f) => f.urteil === "fehler");
  return `${name[g]}: ${a.length} auffällig von ${x.length}${e.length ? `, ${e.length} Agent-Fehler` : ""}` + a.map((f) => `\n  • ${f.titel.slice(0, 50)}: ${f.grund}`).join("");
};
// 5 Beispiele: zuerst echte auffaellige, aufgefuellt mit erkannten Kontrollfaellen
const auff = faelle.filter((f) => f.urteil === "auffaellig" && f.gruppe !== "K");
const beispiele = [...auff, ...faelle.filter((f) => f.urteil === "auffaellig" && f.gruppe === "K")].slice(0, 5);
const verpasst = faelle.filter((f) => f.gruppe === "K" && f.urteil !== "auffaellig").map((f) => `\n  ✗ nicht erkannt: ${f.titel}`).join("");
const bericht =
  `🤖 Test Prüf-Agent (nichts gesendet)\n\n${zeile("A")}\n\n${zeile("B")}${pruefungNicht ? `\n  (${pruefungNicht} weitere bestanden schon die feste Prüfung nicht — kämen nie zum Agenten)` : ""}\n\n${zeile("C")}\n\n${zeile("K")}${verpasst}`;
const md = [bericht, "", "Beispiele (vollständig):", ...beispiele.map((f, i) => `\n--- Beispiel ${i + 1} (${name[f.gruppe]}) · ${f.titel}\nGrund: ${f.grund}\nInserat: ${f.input.beschreibung.replace(/\s+/g, " ").slice(0, 400)}\n\n${f.input.text}`)].join("\n");
writeFileSync("tutor24-followup/pruefagent_test.json", JSON.stringify(faelle, null, 1));
writeFileSync("tutor24-followup/pruefagent_test.md", md);
console.log(md);
if (process.argv.includes("--telegram")) {
  await notify(bericht.slice(0, 4000));
  for (const [i, f] of beispiele.entries())
    await notify(`🤖 Beispiel ${i + 1}/${beispiele.length} (${name[f.gruppe]})\nGrund: ${f.grund}\n\nInserat: ${f.titel}\n${f.input.beschreibung.replace(/\s+/g, " ").slice(0, 500)}\n\nNachricht:\n${f.input.text}`.slice(0, 4000));
}
process.exit(0);
