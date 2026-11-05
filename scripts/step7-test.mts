/**
 * Schritt-7-Test: Erst-Nachricht und Nachfassen nebeneinander, wo die Person auf /kurse landet,
 * dazu die Szenarien (Kurs voll, Anmeldeschluss vorbei, neuer Kurs, angemeldet, Kursdaten geaendert,
 * Kurs abgesagt). SENDET NICHTS, SCHREIBT NICHTS IN DIE DATENBANK (liest nur Protokoll und Personen).
 *
 * Voraussetzung: Inserate gelesen mit
 *   npx tsx scripts/course-offer-dryrun.mts --offset 50 --limit 318 --fetch-only --nachgefasst
 * Dann:
 *   npx tsx scripts/step7-test.mts [--offset 50 --limit 318] [--ohne-ki]
 * Ergebnis: tutor24-followup/schritt7_test.md und schritt7_test.csv (Namen → gitignored Ordner).
 */
import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

config({ path: ".env.local" });

const F = await import("../lib/tutor24-followup");
const O = await import("../lib/tutor24-course-offer");
const { FOLLOWUP_DIR, loadCourses, loadSettings, loadLog, readPreview } = await import("../lib/tutor24-followup-store");
const { buildInterestList } = await import("../lib/tutor24-leads");
const { generatePersonalSentence } = await import("../lib/tutor24-message-prompt");
const { resolveTargetLanguage, scoreTextLanguage, TUTOR24_BASE_URL } = await import("../lib/tutor24-messaging");
const { prisma } = await import("../lib/prisma");
type Course = import("../lib/tutor24-followup").Course;
type LeadInfo = import("../lib/tutor24-followup").LeadInfo;
type PreviewRow = import("../lib/tutor24-followup").PreviewRow;
type LeadRow = import("../lib/tutor24-leads").LeadRow;
type ListingInfo = import("../lib/tutor24-followup").ListingInfo;

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? Number(process.argv[i + 1]) : def;
};
const offset = arg("--offset", 50);
const limit = arg("--limit", 318);
const withAi = !process.argv.includes("--ohne-ki");

const isoDayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const NOW = new Date();
const LATER = new Date(NOW.getTime() + 5 * 24 * 3600 * 1000); // Nachfassen 5 Tage spaeter (vor dem Anmeldeschluss)
const settings = loadSettings();
// Testannahme: alle Kurse aus courses.json aktiv (der BM-Kurs ist im Moment pausiert).
const courses: Course[] = loadCourses().map((c) => ({ ...c, active: true }));
const log = await loadLog();
type Cached = { jobId: string | null; info: (ListingInfo & { active: boolean }) | null; error?: string };
const cache: Record<string, Cached> = JSON.parse(readFileSync(join(FOLLOWUP_DIR, "course_offer_listings.json"), "utf8"));
const KI_CACHE = join(FOLLOWUP_DIR, "schritt7_ki_saetze.json");
const kiCache: Record<string, string | null> = existsSync(KI_CACHE) ? JSON.parse(readFileSync(KI_CACHE, "utf8")) : {};
const preview = readPreview();
const byConvo = new Map(preview.map((r) => [r.conversation_id, r]));
const batch = preview.filter((r) => r.stufe || r.fach).slice(offset, offset + limit);
const followedUp = await prisma.tutor24Lead.findMany({
  where: { kategorie: "", conversationId: { not: null }, messages: { some: { art: "nachfassen" } } },
  select: { conversationId: true, name: true, messages: { select: { variante: true } } },
});
await prisma.$disconnect(); // ab hier keine Datenbank mehr

const lang = (info: ListingInfo): "de" | "en" | "fr" =>
  resolveTargetLanguage(`${TUTOR24_BASE_URL}/de/jobs/0`, "de", info.title, info.description).language;

/** Kopie der Spracherkennung VOR der Korrektur (Commit 2cd2d0c), nur fuer den Vorher/Nachher-Vergleich. */
function legacyLang(info: ListingInfo): "de" | "en" | "fr" {
  const score = (text: string) => {
    const s = text.toLowerCase();
    const count = (re: RegExp) => (s.match(re) ?? []).length;
    const en =
      count(/\b(the|and|for|with|you|your|student|tutor|math|mathematics|physics|wanted|needed|help|lessons|hour|school|primary|secondary|university|looking|searching|tutoring|weekly|online|experience)\b/g) +
      count(/\b(tutor wanted|wanted for|need a tutor|math tutor|looking for|searching for|hourly rate)\b/g);
    const de =
      count(/\b(der|die|das|und|ich|wir|suche|gesucht|schüler|schülerin|nachhilfe|prüfung|stunde|gymnasium|mathematik|physik|lehrer|lehrerin|auftrag|anfrage)\b/g) +
      count(/\b(nachhilfelehrer|gesucht in|ich suche|wir suchen|bitte melden)\b/g);
    const fr =
      count(/\b(le|la|les|des|je|nous|cherche|recherche|élève|professeur|mathématiques|physique|cours|besoin|soutien)\b/g) +
      count(/\b(je recherche|cherche un|recherche un prof)\b/g);
    return { de, en, fr };
  };
  const pick = ({ de, en, fr }: { de: number; en: number; fr: number }) => {
    const max = Math.max(de, en, fr);
    if (max < 2) return null;
    if (en === max && en >= de && en >= fr) return "en" as const;
    if (fr === max && fr > de && fr >= en) return "fr" as const;
    if (de === max) return "de" as const;
    return null;
  };
  const title = info.title.trim();
  return pick(score(title)) ?? pick(score(`${title} ${info.description.trim()}`)) ?? "de";
}

function asPreviewRow(id: string, name: string, a: ReturnType<typeof F.analyzeListing>, jobId: string | null): PreviewRow {
  return {
    ...(Object.fromEntries(F.PREVIEW_COLS.map((c) => [c, ""])) as PreviewRow),
    ...a,
    status: F.isOfferLevel(a.kategorie) ? "send" : "skip",
    conversation_id: id, name, inserat_id: jobId ?? "", grund: F.isOfferLevel(a.kategorie) ? "" : `stufe_${a.kategorie}`,
  };
}

function asLeadRow(id: string, name: string, plan: ReturnType<typeof O.planFirstMessage>, sprache: string, kursId: string | null, p: Partial<LeadRow> = {}): LeadRow {
  const a = plan.analysis;
  return {
    id, name, createdAt: NOW, inseratId: null, conversationId: id, quelle: "erstnachricht", stufe: "", kategorie: a.kategorie,
    kursgruppe: a.kursgruppe, sicherheit: a.sicherheit, ausschluss: a.ausschluss, faecher: a.faecher, anlass: a.anlass, ort: a.ort,
    ortsname: a.ortsname, wer: plan.addressee.wer, anrede: plan.addressee.anrede, kind: plan.addressee.kind, sprache, kursId,
    freigabeKursId: null, status: "offen", geantwortet: "", einzelunterricht: false, ...p,
  };
}

/** Wo die Person auf /kurse steht. */
function placement(lead: LeadRow, cs: Course[], lg = log, now = NOW): string {
  const open = lead.kursId ? cs.find((c) => c.id === lead.kursId && c.active && c.deadline >= isoDayOf(now)) : null;
  if (["Zusage", "Bezahlt"].includes(lead.status) && lead.kursId) return `Pipeline „${cs.find((c) => c.id === lead.kursId)?.name}“: ${lead.status === "Zusage" ? "Zugesagt" : "Bezahlt"} (belegt einen Platz)`;
  if (open) return `Pipeline „${open.name}“: Angeschrieben (Erst-Nachricht)`;
  const list = buildInterestList([lead], cs, settings, lg, now);
  const g = list.groups[0];
  if (!g) return "nicht auf /kurse (ausgeschlossen oder fremdes Fach)";
  const p = g.people[0];
  const art = p.sicher ? "sicher" : p.tief ? "ohne Klassenangabe (eingeklappt)" : "unsicher";
  return `Interessentenliste ${g.label} · ${g.fach}, ${art}, Grund: ${p.grund}${p.passtZu ? ` → passt zu „${cs.find((c) => c.id === p.passtZu)?.name}“ (Freigabe nötig)` : ""}`;
}

type Result = {
  id: string; name: string; sprache: string; wer: string; kind: string; kategorie: string; kursgruppe: string; sicherheit: string;
  ausschluss: string; ergebnis: string; kurs: string; grund: string; satz: string; kiGrund: string; problem: string; erst: string;
  nachfassen: string; nachfassenArt: string; nachfassenProblem: string; kurse: string; info: ListingInfo;
  plan: ReturnType<typeof O.planFirstMessage>; lead: LeadRow; leadInfo: LeadInfo; row: PreviewRow;
};

async function simulate(id: string, name: string, info: ListingInfo, jobId: string | null, cs = courses, lg = log): Promise<Result> {
  const sprache = lang(info);
  const plan = O.planFirstMessage(info, cs, settings, lg, NOW, sprache);
  let erst = "";
  let course: Course | null = null;
  let satz = "";
  let kiGrund = "";
  let problem = "";
  if (sprache === "fr") {
    erst = "(Französisch: bisherige KI-Nachricht ohne Kurs — im Test nicht erzeugt)";
  } else {
    const f = plan.form;
    // KI-Saetze zwischenspeichern: ein zweiter Lauf fragt die KI nicht nochmals (gleiche Saetze, vergleichbar).
    const key = `${id}|${f.typ}`;
    if (withAi && !(key in kiCache)) {
      kiCache[key] = await generatePersonalSentence(info, f.typ === "fr" ? "neutral" : f.typ, f.typ === "eltern" ? f.nom : null, () => {});
      writeFileSync(KI_CACHE, JSON.stringify(kiCache, null, 1));
    }
    const personal = withAi ? kiCache[key] : null;
    kiGrund = personal ? O.sentenceProblem(personal, f) ?? "" : withAi ? "KI lieferte nichts" : "";
    const m = O.assembleFirstMessage(plan, personal);
    erst = m.text;
    course = m.course;
    satz = m.satz;
    problem = m.problem ?? "";
  }
  const lead = asLeadRow(id, name, plan, sprache, course?.id ?? null);
  const leadInfo: LeadInfo = {
    quelle: "erstnachricht", status: "offen", wer: lead.wer, kind: lead.kind, anrede: lead.anrede, sprache,
    erstKursId: course?.id ?? null, erstKursDaten: course ? F.courseSnapshot(course) : null, freigabeKursId: null, nachgefasst: false,
  };
  const row = asPreviewRow(id, name, plan.analysis, jobId);
  const fu = followup(row, leadInfo, cs, lg, LATER);
  return {
    id, name, sprache, wer: plan.addressee.wer, kind: plan.addressee.kind ?? "", kategorie: plan.analysis.kategorie,
    kursgruppe: plan.analysis.kursgruppe, sicherheit: plan.analysis.sicherheit, ausschluss: plan.analysis.ausschluss,
    ergebnis: course ? "kurs" : plan.offer.kind, kurs: course?.name ?? "", grund: plan.offer.kind === "kurs" ? (course ? "" : "prüfung") : plan.offer.grund,
    satz, kiGrund, problem, erst, nachfassen: fu.text, nachfassenArt: fu.label, nachfassenProblem: fu.problem, kurse: placement(lead, cs, lg), info, plan, lead, leadInfo, row,
  };
}

function followup(row: PreviewRow, lead: LeadInfo, cs: Course[], lg = log, now = LATER) {
  const eff = F.effectiveStatus(row, cs, settings, new Set(), lg, now, lead);
  if (!eff.kind) return { label: `kein Nachfassen (${eff.label})`, text: "", problem: "" };
  const m = O.followupMessage(eff.kind, O.followupForm(lead, row.anrede), row.name, eff.course, settings.privatePricePerLesson);
  return { label: `${eff.kind}${eff.send ? "" : ` (${eff.label})`}`, text: m.text, problem: m.problem ?? "" };
}

// ── Lauf ──────────────────────────────────────────────────────────────────────

const results: Result[] = [];
const missing: string[] = [];
for (const [i, r] of batch.entries()) {
  const c = cache[r.conversation_id];
  if (!c?.info) {
    missing.push(`${r.conversation_id}: ${c ? c.error ?? "kein Inserat" : "nicht gelesen"}`);
    continue;
  }
  results.push(await simulate(r.conversation_id, r.name, c.info, c.jobId));
  if ((i + 1) % 25 === 0) console.log(`${i + 1}/${batch.length} ausgewertet`);
}

// Die 10 schon Nachgefassten (ohne Analyse): nur anzeigen, was fuers Nachfassen bekannt waere.
const bm = followedUp.map((l) => {
  const c = cache[l.conversationId as string];
  if (!c?.info) return { name: l.name, text: `Inserat nicht gelesen (${c?.error ?? "fehlt"})` };
  const plan = O.planFirstMessage(c.info, courses, settings, log, NOW, lang(c.info));
  const ad = plan.addressee;
  return {
    name: l.name,
    text: `Sprache ${lang(c.info)}, Anrede ${ad.wer}${ad.kind ? ` (${ad.kind})` : ""} → ${ad.anrede}; gesendet wurde: ${l.messages.map((m) => m.variante).join(", ")}; Stufe ${plan.analysis.kategorie}/${plan.analysis.kursgruppe} (${plan.analysis.sicherheit})`,
  };
});

// ── Szenarien ─────────────────────────────────────────────────────────────────

const matura = courses.find((c) => c.gruppe === "matura") as Course;
const withCourse = results.find((r) => r.kurs === matura.name && r.sprache === "de") ?? results.find((r) => r.kurs);
// Ohne Kurs, sicher erkannt und nicht nur vor Ort (sonst kann ein Online-Kurs ihr nie angeboten werden).
const noCourseOk = (r: Result) => !r.kurs && r.sicherheit === "hoch" && r.plan.analysis.ort !== "vor Ort" && r.sprache === "de";
const withoutCourse = results.find((r) => noCourseOk(r) && /^sek/.test(r.kursgruppe)) ?? results.find(noCourseOk);
const scen: string[] = [];
const sc = (title: string, lines: string[]) => scen.push(`### ${title}\n\n${lines.join("\n\n")}`);
const block = (t: string) => "```\n" + t + "\n```";
const zusagen = (n: number, id: string) => Array.from({ length: n }, () => ({ kurs: id, markierung: "Zusage" }));

if (withCourse) {
  const c = courses.find((x) => x.id === withCourse.leadInfo.erstKursId) as Course;
  // 1. Kurs voll
  const full = [...log, ...zusagen(F.capacity(c), c.id)] as typeof log;
  const neu = await simulate("neu-voll", "Neue Person", withCourse.info, null, courses, full);
  sc("1. Kurs voll", [
    `Annahme: „${c.name}“ hat ${F.capacity(c)} Zusagen (alle Plätze belegt).`,
    `**Neue Erst-Nachricht** (gleiches Inserat wie ${withCourse.name}): Kurs ${neu.kurs ? "„" + neu.kurs + "“ ✗ FEHLER" : "nicht angeboten ✓"}, Grund ${neu.grund}. /kurse: ${neu.kurse}`,
    `**Nachfassen bei ${withCourse.name}** (Kurs stand in der Erst-Nachricht): ${followup(withCourse.row, withCourse.leadInfo, courses, full).label}`,
  ]);
  // 2. Anmeldeschluss vorbei
  const after = new Date(`${c.deadline}T12:00:00`);
  after.setDate(after.getDate() + 1);
  sc("2. Anmeldeschluss vorbei", [
    `Annahme: heute ist der ${after.toLocaleDateString("de-CH")}.`,
    `**Erst-Nachricht**: ${O.pickCourse(withCourse.plan.analysis, courses, settings, log, after).kind === "kurs" ? "Kurs angeboten ✗ FEHLER" : "kein Kurs ✓"}`,
    `**Nachfassen bei ${withCourse.name}**: ${followup(withCourse.row, withCourse.leadInfo, courses, log, after).label}`,
    `**/kurse**: ${placement(withCourse.lead, courses, log, after)}`,
  ]);
  // 4. Person angemeldet
  const zugesagt = { ...withCourse.leadInfo, status: "Zusage" };
  const lgZ = [...log, { kurs: c.id, markierung: "Zusage" }] as typeof log;
  const frei = (lg: typeof log) => F.capacity(c) - F.courseStats(c, lg).zusagen;
  sc("4. Person angemeldet", [
    `Annahme: ${withCourse.name} sagt auf die Erst-Nachricht zu (Status Zusage).`,
    `**Nachfassen**: ${followup(withCourse.row, zugesagt, courses, lgZ).label}`,
    `**/kurse**: ${placement({ ...withCourse.lead, status: "Zusage" }, courses, lgZ)}; freie Plätze ${frei(log)} → ${frei(lgZ)}`,
  ]);
  // 5. Kursdaten geaendert
  const moved: Course = { ...c, saturdays: c.saturdays.map((d) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + 7); return isoDayOf(x); }) as Course["saturdays"] };
  const cs5 = courses.map((x) => (x.id === c.id ? moved : x));
  const renamed = courses.map((x) => (x.id === c.id ? { ...x, name: `${x.name} (neu formuliert)` } : x));
  const f5 = followup(withCourse.row, withCourse.leadInfo, cs5);
  sc("5. Kursdaten geändert", [
    `Annahme: alle Termine eine Woche später.`,
    `**Nachfassen bei ${withCourse.name}**: ${f5.label}${f5.problem ? ` — Problem: ${f5.problem}` : ""}`,
    block(f5.text),
    `Gegenprobe, nur der Kursname umformuliert: ${followup(withCourse.row, withCourse.leadInfo, renamed).label} (erwartet: erinnerung)`,
  ]);
  // 6. Kurs abgesagt mangels Anmeldungen
  const cancelled = courses.map((x) => (x.id === c.id ? { ...x, active: false } : x));
  sc("6. Kurs abgesagt (zu wenige Anmeldungen)", [
    `Annahme: „${c.name}“ wird pausiert/abgesagt.`,
    `**Erst-Nachricht** für neue Personen: ${O.pickCourse(withCourse.plan.analysis, cancelled, settings, log, NOW).kind === "kurs" ? "Kurs ✗ FEHLER" : "kein Kurs ✓"}`,
    `**Nachfassen bei ${withCourse.name}**: ${followup(withCourse.row, withCourse.leadInfo, cancelled).label}`,
    `**/kurse**: ${placement(withCourse.lead, cancelled)}`,
  ]);
  // Erinnerung (Normalfall) als Text
  const f0 = followup(withCourse.row, withCourse.leadInfo, courses);
  sc("0. Normalfall: Kurs stand in der Erst-Nachricht, unverändert offen", [`**Nachfassen bei ${withCourse.name}**: ${f0.label}`, block(f0.text)]);
}
if (withoutCourse) {
  const g = withoutCourse.kursgruppe as import("../lib/tutor24-followup").CourseGroup;
  const fach = F.splitList(withoutCourse.plan.analysis.faecher)[0] ?? "Mathe";
  const nc: Course = { ...F.newCourse(fach, g, NOW), id: "test-neu", active: true };
  const cs3 = [...courses, nc];
  const before = followup(withoutCourse.row, withoutCourse.leadInfo, cs3);
  const freigegeben = { ...withoutCourse.leadInfo, freigabeKursId: nc.id };
  const after = followup(withoutCourse.row, freigegeben, cs3);
  sc("3. Neuer passender Kurs angelegt", [
    `${withoutCourse.name} (${F.GROUP_LABEL[g]}, ${fach}) bekam die Erst-Nachricht ohne Kurs. Neu angelegt: „${nc.name}“.`,
    `**/kurse**: ${placement(withoutCourse.lead, cs3)}`,
    `**Nachfassen ohne Freigabe**: ${before.label}`,
    `**Nachfassen nach Freigabe**: ${after.label}${after.problem ? ` — Problem: ${after.problem}` : ""}`,
    after.text ? block(after.text) : "_kein Text_",
  ]);
}

// ── Beispiele: 10 gemischte Faelle ────────────────────────────────────────────

// Zehn Faecher: echtes Inserat, wenn eines passt, sonst ein synthetisches (im Titel als "(synthetisch)" markiert).
// Mit Kurs gibt es in den echten Daten nur 2 Faelle (nur Matura- und BM-Kurs vorhanden).
type Slot = { pred: (r: Result) => boolean; synth?: { name: string; info: ListingInfo } };
const de = (r: Result) => r.sprache === "de";
const offerLevel = (r: Result) => F.isOfferLevel(r.kategorie) && !r.ausschluss;
const slots: Slot[] = [
  { pred: (r) => de(r) && r.wer === "schueler" && !!r.kurs },
  {
    pred: (r) => de(r) && r.wer === "eltern" && !!r.kind && !!r.kurs,
    synth: { name: "Petra", info: { title: "Mathe-Nachhilfe für die Matura", fach: "Mathematik", schulstufe: "Gymnasium", description: "Ich suche für meine Tochter Unterstützung in Mathematik. Sie macht dieses Jahr die Matura am Gymnasium und möchte sich gezielt auf die Prüfung vorbereiten. Online wäre ideal." } },
  },
  {
    pred: (r) => de(r) && r.wer === "unklar" && !!r.kurs,
    synth: { name: "Kim", info: { title: "Nachhilfe Mathematik BM", fach: "Mathematik", schulstufe: "Berufsschule", description: "Nachhilfe in Mathematik für die Berufsmatura gesucht. Die BM-Abschlussprüfung steht im Frühling an. Online-Unterricht ist möglich." } },
  },
  { pred: (r) => de(r) && r.wer === "schueler" && !r.kurs && offerLevel(r) },
  { pred: (r) => de(r) && r.wer === "eltern" && !r.kurs && offerLevel(r) && r.sicherheit === "hoch" },
  { pred: (r) => de(r) && r.wer === "unklar" && !r.kurs && offerLevel(r) && r.sicherheit === "mittel" },
  { pred: (r) => de(r) && !r.kurs && r.kursgruppe === "offen" },
  {
    pred: (r) => r.sprache === "en" && !!r.kurs,
    synth: { name: "Sam", info: { title: "Maths tutor wanted for Matura", fach: "Mathematik", schulstufe: "Gymnasium", description: "I am in my last year at the Gymnasium and will write the Matura in maths this year. I am looking for help with the typical exam exercises. Online lessons would be perfect." } },
  },
  { pred: (r) => r.sprache === "en" && !r.kurs && offerLevel(r) },
  { pred: (r) => r.sprache === "fr" && !!r.nachfassen },
];
const examples: Result[] = [];
for (const [i, s] of slots.entries()) {
  const real = results.find((r) => s.pred(r) && !examples.includes(r));
  if (real) examples.push(real);
  else if (s.synth) examples.push(await simulate(`synth-${i}`, `${s.synth.name} (synthetisch)`, s.synth.info, null));
}

// ── Bericht ───────────────────────────────────────────────────────────────────

const count = (xs: string[]) => Object.entries(xs.reduce<Record<string, number>>((a, k) => ({ ...a, [k || "—"]: (a[k || "—"] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join(" · ");
const placeKey = (s: string) => s.replace(/, Grund:.*$/, "").replace(/ → passt.*$/, "");
const lines: string[] = [];
lines.push(`# Schritt-7-Test (${NOW.toLocaleString("de-CH")})`, "", `Nichts gesendet, nichts in die Datenbank geschrieben. Testannahme: alle Kurse aktiv (${courses.map((c) => c.name).join(", ")}). Nachfassen simuliert ${LATER.toLocaleDateString("de-CH")}.`, "");
lines.push(`## Zahlen (${results.length} Inserate ausgewertet, ${missing.length} ohne Inserat)`, "");
lines.push(`- Ergebnis Erst-Nachricht: ${count(results.map((r) => r.ergebnis))}`);
lines.push(`- Grund ohne Kurs: ${count(results.filter((r) => !r.kurs).map((r) => r.grund))}`);
lines.push(`- Kurs angeboten: ${count(results.filter((r) => r.kurs).map((r) => r.kurs))}`);
lines.push(`- Anrede: ${count(results.map((r) => r.wer + (r.kind ? `/${r.kind}` : "")))}`);
lines.push(`- Sprache: ${count(results.map((r) => r.sprache))}`);
lines.push(`- Persönlicher Satz: ${count(results.map((r) => r.satz))}`);
lines.push(`- Warum der KI-Satz abgelehnt wurde (→ Ersatzsatz): ${count(results.filter((r) => r.kiGrund).map((r) => r.kiGrund.replace(/„.*“/, "„…“")))}`);
lines.push(`- Prüfung Erst-Nachricht fehlgeschlagen: ${results.filter((r) => r.problem).length}${results.filter((r) => r.problem).map((r) => ` (${r.name}: ${r.problem})`).join("")}`);
lines.push(`- Nachfassen: ${count(results.map((r) => r.nachfassenArt.replace(/\(stufe_\w+\)/, "(Stufe ausgeschlossen)")))}`);
lines.push(`- Prüfung Nachfassen fehlgeschlagen: ${results.filter((r) => r.nachfassenProblem).length}${results.filter((r) => r.nachfassenProblem).map((r) => ` (${r.name}: ${r.nachfassenProblem})`).join("")}`);
lines.push(`- /kurse: ${count(results.map((r) => placeKey(r.kurse)))}`);
if (missing.length) lines.push(`- Ohne Inserat: ${missing.join("; ")}`);
const changedLang = results.filter((r) => legacyLang(r.info) !== r.sprache);
lines.push(
  `- Sprache nach der Korrektur anders als vorher: ${changedLang.length} von ${results.length}` +
    (changedLang.length ? ` — ${changedLang.map((r) => `${r.name}: ${legacyLang(r.info)} → ${r.sprache} („${r.info.title.slice(0, 50)}“)`).join("; ")}` : "")
);
// Grenzfaelle der Schwelle: Deutsch erkannt, aber 1–3 englische oder franzoesische Signalwoerter.
const borderline = results
  .filter((r) => r.sprache === "de")
  .map((r) => ({ r, s: scoreTextLanguage(`${r.info.title} ${r.info.description}`) }))
  .filter(({ s }) => (s.en >= 1 && s.en <= 3) || (s.fr >= 1 && s.fr <= 3));
lines.push("", `## Grenzfälle Sprache: Deutsch, aber 1–3 englische/französische Signalwörter (${borderline.length})`, "");
lines.push("Schwelle: en/fr erst ab 4 Signalwörtern und doppelt so vielen wie jede andere Sprache. Zahlen: Signalwörter je Sprache.", "");
for (const { r, s } of borderline)
  lines.push(
    `- **${r.name}** — en ${s.en}, fr ${s.fr}, de ${s.de}${s.it ? `, it ${s.it}` : ""}${s.es ? `, es ${s.es}` : ""}: „${r.info.title.slice(0, 70)}“ — ${r.info.description.replace(/\s+/g, " ").slice(0, 180)}${r.info.description.length > 180 ? " …" : ""}`
  );
lines.push("", "## Die 10 schon Nachgefassten (Berufsmatura) — nur angezeigt, nicht gespeichert", "", ...bm.map((b) => `- **${b.name}**: ${b.text}`));
lines.push("", "## Beispielpaare", "");
for (const [i, r] of examples.entries()) {
  lines.push(
    `### ${i + 1}. ${r.name} — ${r.sprache}, ${r.wer}${r.kind ? `/${r.kind}` : ""}, ${F.LEVEL_LABEL[r.kategorie as import("../lib/tutor24-followup").LevelCategory] ?? r.kategorie}${r.kursgruppe ? ` / ${r.kursgruppe}` : ""} (${r.sicherheit})${r.ausschluss ? `, Ausschluss ${r.ausschluss}` : ""}`,
    "",
    `Inserat: „${r.info.description.replace(/\s+/g, " ").slice(0, 220)}${r.info.description.length > 220 ? " …" : ""}“`,
    "",
    `**Erst-Nachricht** (${r.kurs ? `mit Kurs „${r.kurs}“` : `ohne Kurs, Grund ${r.grund}`}, Satz ${r.satz || "—"}${r.problem ? `, PROBLEM ${r.problem}` : ""})`,
    block(r.erst),
    `**Nachfassen** (${r.nachfassenArt}${r.nachfassenProblem ? `, PROBLEM ${r.nachfassenProblem}` : ""})`,
    r.nachfassen ? block(r.nachfassen) : "_kein Nachfassen_",
    `**/kurse**: ${r.kurse}`,
    ""
  );
}
lines.push("## Szenarien", "", ...scen.flatMap((s) => [s, ""]));
writeFileSync(join(FOLLOWUP_DIR, "schritt7_test.md"), lines.join("\n"));
writeFileSync(
  join(FOLLOWUP_DIR, "schritt7_test.csv"),
  F.toCsv(
    results.map((r) => ({
      conversation_id: r.id, name: r.name, sprache: r.sprache, wer: r.wer, kind: r.kind, kategorie: r.kategorie, kursgruppe: r.kursgruppe,
      sicherheit: r.sicherheit, ausschluss: r.ausschluss, ergebnis: r.ergebnis, kurs: r.kurs, grund: r.grund, satz: r.satz, problem: r.problem,
      nachfassen: r.nachfassenArt, nachfassen_problem: r.nachfassenProblem, kurse: r.kurse,
    })),
    ["conversation_id", "name", "sprache", "wer", "kind", "kategorie", "kursgruppe", "sicherheit", "ausschluss", "ergebnis", "kurs", "grund", "satz", "problem", "nachfassen", "nachfassen_problem", "kurse"]
  )
);
console.log(lines.slice(0, 20).join("\n"));
console.log(`\nBericht: ${join(FOLLOWUP_DIR, "schritt7_test.md")}`);
process.exit(0);
