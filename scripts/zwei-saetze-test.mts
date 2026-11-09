/**
 * Zwei Saetze v4 auf den gespeicherten Inseraten: 15 Beispiele, gemischt nach Stufe, Anrede, Sprache, mit/ohne Detail.
 * Ruft nur die KI auf, nie tutor24; sendet nichts, schreibt nichts in die Datenbank.
 *   npx tsx scripts/zwei-saetze-test.mts   → tutor24-followup/zwei_saetze_test.md
 */
import { config } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
config({ path: ".env.local" });

const O = await import("../lib/tutor24-course-offer");
const { FOLLOWUP_DIR, loadCourses, loadSettings, loadLog } = await import("../lib/tutor24-followup-store");
const { personalSentenceV3 } = await import("../lib/tutor24-message-prompt");
const { resolveTargetLanguage, TUTOR24_BASE_URL } = await import("../lib/tutor24-messaging");
const { prisma } = await import("../lib/prisma");
type ListingInfo = import("../lib/tutor24-followup").ListingInfo;

const settings = { ...loadSettings(), satzV4: true };
const courses = loadCourses();
const log = await loadLog();
await prisma.$disconnect();
const cache: Record<string, { info: ListingInfo | null }> = JSON.parse(readFileSync(join(FOLLOWUP_DIR, "course_offer_listings.json"), "utf8"));

type C = { typ: string; stufe: string | null; sprache: string };
type Slot = { label: string; ok: (c: C) => boolean; detail: boolean | null };
const eltern = (c: C) => c.typ === "eltern";
const slots: Slot[] = [
  { label: "Eltern · Primar · mit Detail", ok: (c) => eltern(c) && c.stufe === "primar", detail: true },
  { label: "Eltern · Primar · ohne Detail", ok: (c) => eltern(c) && c.stufe === "primar", detail: false },
  { label: "Eltern · Sek · mit Detail", ok: (c) => eltern(c) && c.stufe === "sek", detail: true },
  { label: "du · Sek · mit Detail", ok: (c) => c.typ === "du" && c.stufe === "sek", detail: true },
  { label: "du · Sek · ohne Detail", ok: (c) => c.typ === "du" && c.stufe === "sek", detail: false },
  { label: "du · Gymi · mit Detail", ok: (c) => c.typ === "du" && c.stufe === "gymi", detail: true },
  { label: "neutral · Gymi", ok: (c) => c.typ === "neutral" && c.stufe === "gymi", detail: null },
  { label: "Gymiprüfung · mit Detail", ok: (c) => c.stufe === "gymipruefung" && c.sprache === "de", detail: true },
  { label: "BM", ok: (c) => c.stufe === "bm" && c.sprache === "de", detail: null },
  { label: "Matura", ok: (c) => c.stufe === "matura" && c.sprache === "de", detail: null },
  { label: "Uni/FH", ok: (c) => c.stufe === "uni", detail: null },
  { label: "neutral · ohne Detail", ok: (c) => c.typ === "neutral" && c.stufe !== null, detail: false },
  { label: "Englisch · mit Detail", ok: (c) => c.typ === "en", detail: true },
  { label: "Englisch · ohne Detail", ok: (c) => c.typ === "en", detail: false },
  { label: "Französisch", ok: (c) => c.typ === "fr", detail: null },
];
type Out = { slot: string; id: string; c: C; quelle: string; detail: string | null; gruende: string[]; satz: string; text: string; problem: string | null; inserat: string };
const filled = new Map<number, Out>();
let calls = 0;
// zuerst Inserate mit echten Details (Zahl, Pruefung, Thema, Schwierigkeit), dann die uebrigen
const RICH = /\d\.? ?(klasse|sek|primar|gym)|prüfung|probezeit|matura|exam|test|bruch|algebra|geometr|gleichung|funktion|textaufgab|dyskalk|lücke|note|vektor|analysis|ableitung|integral|stochast|janu|febr|märz|april|mai|juni|juli|august|sept|okt|nov|dez/i;
const entries = Object.entries(cache).sort(([, a], [, b]) => Number(RICH.test(b.info?.description ?? "")) - Number(RICH.test(a.info?.description ?? "")));
for (const [id, v] of entries) {
  if (filled.size === slots.length || calls >= 120) break;
  const info = v.info;
  if (!info?.description) continue;
  const sprache = resolveTargetLanguage(`${TUTOR24_BASE_URL}/de/jobs/0`, "de", info.title, info.description).language;
  const plan = O.planFirstMessage(info, courses, settings, log, new Date(), sprache);
  const c: C = { typ: plan.form.typ, stufe: O.satzStufe(plan.analysis, info), sprache };
  if (!slots.some((s, i) => !filled.has(i) && s.ok(c))) continue;
  calls++;
  const r = await personalSentenceV3(info, plan.form, O.festeZweiSaetze(c.stufe, plan.form, settings.zweiSaetze), (s) => console.log(s), true);
  const mitDetail = r.quelle === "ki";
  const i = slots.findIndex((s, i) => !filled.has(i) && s.ok(c) && (s.detail === null || s.detail === mitDetail));
  if (i < 0) continue;
  const m = O.assembleFirstMessage(plan, r.satz);
  filled.set(i, { slot: slots[i].label, id, c, quelle: r.quelle, detail: r.detail, gruende: r.gruende, satz: r.satz, text: m.text, problem: m.problem, inserat: `${info.title} | ${info.schulstufe} | ${info.description.replace(/\s+/g, " ").slice(0, 260)}` });
  console.log(`${filled.size}/${slots.length} (${calls} KI-Aufrufe): ${slots[i].label}`);
}

const rows = slots.map((s, i) => filled.get(i) ?? { slot: s.label, missing: true as const });
const md = [
  `# Zwei Sätze v4 – Test ${new Date().toLocaleString("de-CH")}`,
  "",
  `${filled.size} von ${slots.length} Fällen gefunden, ${calls} KI-Aufrufe. Nichts gesendet.`,
  "",
  ...rows.flatMap((o, n) =>
    "missing" in o
      ? [`## ${n + 1}. ${o.slot}`, "", "_kein passendes Inserat gefunden_", ""]
      : [
          `## ${n + 1}. ${o.slot}`,
          "",
          `Inserat: ${o.inserat}`,
          "",
          `Quelle: **${o.quelle === "ki" ? "KI" : o.quelle === "fest" ? "fester Text" : "ohne"}**${o.detail ? ` · Detail: „${o.detail}“` : ""}${o.gruende.length ? ` · ${o.gruende.join("; ")}` : ""}${o.problem ? ` · ⚠ Prüfung: ${o.problem}` : ""}`,
          "",
          `> ${o.satz || "(kein Satz)"}`,
          "",
        ]
  ),
].join("\n");
writeFileSync(join(FOLLOWUP_DIR, "zwei_saetze_test.md"), md);
writeFileSync(join(FOLLOWUP_DIR, "zwei_saetze_test.json"), JSON.stringify(Array.from(filled.values()), null, 1));
console.log(md);
process.exit(0);
