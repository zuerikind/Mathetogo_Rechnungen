/**
 * Persoenlicher KI-Satz: heute (v1) gegen neu (v2) auf den gespeicherten Inseraten (wie scripts/step7-test.mts).
 * Ruft nur die KI auf, nie tutor24; sendet nichts, schreibt nichts in die Datenbank.
 *   npx tsx scripts/ki-satz-vergleich.mts
 * Vorher-Saetze: tutor24-followup/schritt7_ki_v3.json (Schritt-7-Test, gleicher Prompt wie heute live).
 * Nachher-Saetze: tutor24-followup/ki_satz_v2.json (Zwischenspeicher). Bericht: tutor24-followup/ki_satz_vergleich.md
 */
import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

config({ path: ".env.local" });

const O = await import("../lib/tutor24-course-offer");
const { FOLLOWUP_DIR, loadCourses, loadSettings, loadLog, readPreview } = await import("../lib/tutor24-followup-store");
const { personalSentenceChecked, stilProblemV2 } = await import("../lib/tutor24-message-prompt");
const { resolveTargetLanguage, TUTOR24_BASE_URL } = await import("../lib/tutor24-messaging");
const { prisma } = await import("../lib/prisma");
type ListingInfo = import("../lib/tutor24-followup").ListingInfo;
type Ki = { satz: string | null; versuche: number; gruende: string[] };

const NOW = new Date();
const settings = loadSettings();
const courses = loadCourses().map((c) => ({ ...c, active: true }));
const log = await loadLog();
await prisma.$disconnect();
const cache: Record<string, { info: ListingInfo | null }> = JSON.parse(readFileSync(join(FOLLOWUP_DIR, "course_offer_listings.json"), "utf8"));
const load = (f: string): Record<string, Ki> => (existsSync(join(FOLLOWUP_DIR, f)) ? JSON.parse(readFileSync(join(FOLLOWUP_DIR, f), "utf8")) : {});
const before = load("schritt7_ki_v3.json");
const AFTER = join(FOLLOWUP_DIR, "ki_satz_v2.json");
const after = load("ki_satz_v2.json");
const BEFORE_EXTRA = join(FOLLOWUP_DIR, "ki_satz_v1_nachgeholt.json");
const beforeExtra = load("ki_satz_v1_nachgeholt.json");

const rows = readPreview().filter((r) => r.stufe || r.fach).slice(50, 368);
type Out = { id: string; typ: string; stufe: string; sprache: string; vorher: Ki; nachher: Ki; text: string };
const out: Out[] = [];
let i = 0;
for (const r of rows) {
  i++;
  const info = cache[r.conversation_id]?.info;
  if (!info) continue;
  const sprache = resolveTargetLanguage(`${TUTOR24_BASE_URL}/de/jobs/0`, "de", info.title, info.description).language;
  if (sprache === "fr") continue; // Franzoesisch: eigene KI-Nachricht, kein Satz
  const f = O.planFirstMessage(info, courses, settings, log, NOW, sprache).form;
  const key = `${r.conversation_id}|${f.typ}`;
  let v1 = before[key] ?? beforeExtra[key];
  if (!v1) {
    v1 = beforeExtra[key] = await personalSentenceChecked(info, f, () => {}, "v1");
    writeFileSync(BEFORE_EXTRA, JSON.stringify(beforeExtra, null, 1));
  }
  let v2 = after[key];
  if (!v2) {
    v2 = await personalSentenceChecked(info, f, (s) => console.log(s), "v2");
    if (!v2.gruende.includes("KI lieferte nichts")) {
      after[key] = v2;
      writeFileSync(AFTER, JSON.stringify(after, null, 1));
    }
    await new Promise((res) => setTimeout(res, 300));
  }
  out.push({ id: r.conversation_id, typ: f.typ, stufe: `${info.schulstufe}`.slice(0, 40), sprache, vorher: v1, nachher: v2, text: `${info.title} ${info.schulstufe} ${info.description}` });
  if (i % 50 === 0) console.log(`${i}/${rows.length}`);
}

const da = (s: string | null) => !!s && /^(Da (Ihr|du|deine?|Ihre|[A-ZÄÖÜ]\w+ (Sohn|Tochter|Kind))|Since you)\b/.test(s.trim());
const passiv = (s: string | null) => !!s && stilProblemV2(s)?.startsWith("Passiv") === true;
const stat = (k: "vorher" | "nachher") => ({
  ersatz: out.filter((o) => !o[k].satz).length,
  da: out.filter((o) => da(o[k].satz)).length,
  passiv: out.filter((o) => passiv(o[k].satz)).length,
  zweiter: out.filter((o) => o[k].satz && o[k].versuche === 2).length,
  starts: new Set(out.map((o) => o[k].satz?.split(/\s+/).slice(0, 2).join(" ")).filter(Boolean)).size,
});
// Woerter aus den Stilbeispielen, die im Satz stehen, im Inserat aber nicht (= aus dem Beispiel uebernommen, erfunden)
const LEAK = ["Bruch", "ZAP", "März", "Gymiprüfung", "Vertrauen", "Lücken", "Oberstufe", "Kanti", "Berufsalltag", "fraction", "March", "Probezeit"];
const leaks = (k: "vorher" | "nachher") =>
  out.flatMap((o) => LEAK.filter((w) => o[k].satz?.toLowerCase().includes(w.toLowerCase()) && !o.text.toLowerCase().includes(w.toLowerCase())).map((w) => `${w}: ${o[k].satz}`));
const s1 = stat("vorher");
const s2 = stat("nachher");

// 12 Beispiele, gemischt nach Anrede und Stufe
const buckets: [string, (o: Out) => boolean][] = [
  ["Eltern · Primar", (o) => o.typ === "eltern" && /primar/i.test(o.stufe)],
  ["Eltern · Sek", (o) => o.typ === "eltern" && /sek/i.test(o.stufe)],
  ["Eltern · Gymi", (o) => o.typ === "eltern" && /gym/i.test(o.stufe)],
  ["unklar · Primar", (o) => o.typ === "neutral" && /primar/i.test(o.stufe)],
  ["unklar · Sek", (o) => o.typ === "neutral" && /sek/i.test(o.stufe)],
  ["unklar · Gymi", (o) => o.typ === "neutral" && /gym/i.test(o.stufe)],
  ["unklar · BM/Lehre", (o) => o.typ === "neutral" && /berufs|lehre|bm/i.test(o.stufe)],
  ["Schüler · Gymi", (o) => o.typ === "du" && /gym/i.test(o.stufe)],
  ["Schüler · BM/Lehre", (o) => o.typ === "du" && /berufs|lehre|bm/i.test(o.stufe)],
  ["Schüler · Sek", (o) => o.typ === "du" && /sek/i.test(o.stufe)],
  ["Englisch", (o) => o.typ === "en"],
  ["Englisch (2)", (o) => o.typ === "en"],
];
const used = new Set<string>();
const examples = buckets.flatMap(([label, ok]) => {
  const o = out.find((x) => ok(x) && !used.has(x.id) && x.vorher.satz !== undefined);
  if (!o) return [];
  used.add(o.id);
  return [`| ${label} | ${o.stufe || "–"} | ${o.vorher.satz ?? "(Ersatzsatz)"} | ${o.nachher.satz ?? "(Ersatzsatz)"} |`];
});
const pct = (n: number) => `${((100 * n) / out.length).toFixed(1)} %`;
const md = [
  `# KI-Satz heute (v1) gegen neu (v2) — ${NOW.toLocaleString("de-CH")}`,
  "",
  `${out.length} Inserate (de/en, ohne Französisch). Nur KI aufgerufen, nichts gesendet.`,
  "",
  "| | heute (v1) | neu (v2) |",
  "|---|---|---|",
  `| Ersatzsatz (beide Versuche abgelehnt) | ${s1.ersatz} (${pct(s1.ersatz)}) | ${s2.ersatz} (${pct(s2.ersatz)}) |`,
  `| beginnt mit „Da Ihr Kind/Da du/Since you…“ | ${s1.da} (${pct(s1.da)}) | ${s2.da} (${pct(s2.da)}) |`,
  `| Passiv („wird … angeboten“) | ${s1.passiv} | ${s2.passiv} |`,
  `| erst im 2. Versuch ok | ${s1.zweiter} | ${s2.zweiter} |`,
  `| verschiedene Anfänge (erste 2 Wörter) | ${s1.starts} | ${s2.starts} |`,
  `| Wort aus den Stilbeispielen, nicht im Inserat | ${leaks("vorher").length} | ${leaks("nachher").length} |`,
  ...leaks("nachher").map((l) => `  - ${l}`),
  "",
  "| Fall | Stufe laut Inserat | vorher | nachher |",
  "|---|---|---|---|",
  ...examples,
].join("\n");
writeFileSync(join(FOLLOWUP_DIR, "ki_satz_vergleich.md"), md);
console.log(md);
process.exit(0);
