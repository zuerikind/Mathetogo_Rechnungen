/**
 * Batch von Hand (bis 20.11.: Automatik aus, nur iPhone-Hotspot). Gestartet von /kurse → Reiter "Batch".
 *   npx tsx scripts/batch.mts --prepare 5   neue Inserate lesen, Nachrichten erstellen, NICHTS senden → tutor24-followup/batch.json
 *   npx tsx scripts/batch.mts --send        die in der Vorschau ausgewählten senden (Erst-Nachrichten, dann fälliges Nachfassen)
 * Regeln: lib/tutor24-batch.ts (Mindestabstand: Vorbereiten + Senden = ein Lauf), 429-Pause, nie doppelt (Tutor24Contact / Chat-Prüfung).
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const { BATCH_MAX, loadBatch, saveBatch, sendBlock, wahlOf } = await import("../lib/tutor24-batch");
type Batch = import("../lib/tutor24-batch").Batch;
type BatchItem = import("../lib/tutor24-batch").BatchItem;
const { RATE_LIMIT_TEXT, activePause, appendPassLog, autoEligible, emptyCounts, fmtZurich, is429, notify, readPassLog } = await import("../lib/tutor24-autopilot");
const { AUTOPILOT_LOCK_PATH, acquireTutor24Lock, earliestNext, lastRunEnd, tooSoonText } = await import("../lib/tutor24-lock");
const { loadCourses, loadSettings, sendQueue } = await import("../lib/tutor24-followup-store");
const { runTutor24Messaging, sendBatchErst } = await import("../lib/tutor24");
const { runFollowup } = await import("../lib/tutor24-followup-runner");
const { followupJobState } = await import("../lib/automation-state");
const { prisma } = await import("../lib/prisma");

const prepareArg = process.argv.indexOf("--prepare");
const n = prepareArg > -1 ? Number(process.argv[prepareArg + 1]) : null;
const SEND = process.argv.includes("--send");
if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= BATCH_MAX)) {
  console.error(`--prepare braucht eine ganze Zahl von 1 bis ${BATCH_MAX}`);
  process.exit(1);
}
if (n === null && !SEND) {
  console.error("--prepare N oder --send");
  process.exit(1);
}

const start = new Date().toISOString();
let batch: Batch = SEND
  ? loadBatch()!
  : { zustand: "vorbereiten", pid: process.pid, gestartet: start, vorbereitetBis: null, fehler: null, items: [], log: [] };
const log = (s: string) => {
  console.log(s);
  if (!batch) return;
  batch.log.push(`${new Date().toLocaleTimeString("de-CH")} ${s}`);
  if (batch.log.length > 400) batch.log.splice(0, batch.log.length - 400);
  saveBatch(batch);
};
const fail = async (msg: string) => {
  if (batch) {
    // Senden: der Batch bleibt "bereit" (nichts gesendet), nur der Grund steht dabei.
    if (!SEND) batch.zustand = "fehler";
    batch.fehler = msg;
    saveBatch(batch);
  }
  console.error(msg);
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
};

const pause = activePause(readPassLog(50));
if (pause) await fail(`${RATE_LIMIT_TEXT} Pause bis ${fmtZurich(pause)}.`);

if (!SEND) {
  saveBatch(batch);
  const soon = earliestNext();
  if (soon) await fail(tooSoonText(soon));
  // Ohne Internet gar nicht erst anfangen (Hotspot)
  const { hasInternet } = await import("../lib/tutor24-network");
  if (!(await hasInternet())) await fail("Kein Internet (Hotspot?) — nicht gestartet.");
  const counts = emptyCounts();
  let stopp: string | null = null;
  try {
    log(`Vorbereiten: bis zu ${n} neue Inserate (nichts wird gesendet) …`);
    const r = await runTutor24Messaging(true, 10, ["Mathematik", "Physik"], {
      limit: n!, dryRun: true, mayContinue: () => null, counts, probe: [], notes: [], maxOpen: n! * 3,
      collect: ({ tutor24Id, href, info, plan, composed, language }) => {
        const course = composed.course;
        batch.items.push({
          id: tutor24Id, art: "erst", titel: info.title, stufe: info.schulstufe, ort: plan.analysis.ortsname || info.ort || "",
          link: href, sprache: language, anrede: wahlOf(plan.addressee),
          block: course ? `Kursblock: ${course.name}` : composed.hint ? "Kurs-Hinweis" : "ohne",
          kursId: course?.id ?? null, hint: composed.hint, satz: composed.satz, text: composed.text, problem: composed.problem,
          ausgewaehlt: !composed.problem, info,
        });
        log(`[${tutor24Id}] vorbereitet: ${info.title}${composed.problem ? ` — ⚠ ${composed.problem}` : ""}`);
      },
    });
    for (const e of r.errors) log(`⚠ ${e}`);
  } catch (err) {
    stopp = err instanceof Error ? err.message : String(err);
    log(`✖ ${stopp}`);
  }
  // Faelliges Nachfassen (z. B. Kursangebot mit Anmeldeschluss): ohne tutor24-Aufruf aus der Vorschau-Liste.
  // Hotspot weg (9.11. 13:24): ohne Datenbank kein Nachfassen in der Liste, aber kein Absturz mit haengendem Stand.
  try {
    const q = await sendQueue(loadCourses(), loadSettings());
    for (const r of q.pending.filter(autoEligible)) {
      batch.items.push({
        id: r.conversation_id, art: "nachfassen", titel: r.name, stufe: r.stufe, ort: r.ortsname, link: r.link || `https://www.tutor24.ch/de/conversations/${r.conversation_id}?tab=sent`,
        sprache: "de", anrede: r.anrede === "du" ? "du" : "unklar", block: r.course ? `Nachfassen: ${r.course.name}` : "Nachfassen",
        kursId: r.course?.id ?? null, hint: null, satz: "-", text: r.text, problem: r.problem, ausgewaehlt: !r.problem,
      });
    }
  } catch (err) {
    stopp = [stopp, `Nachfassen nicht geladen: ${(err instanceof Error ? err.message : String(err)).split("\n").find((l) => /reach|fetch|timeout/i.test(l)) ?? "Datenbank nicht erreichbar"}`].filter(Boolean).join(" · ");
    log(`✖ ${stopp}`);
  }
  batch.vorbereitetBis = lastRunEnd()?.toISOString() ?? null;
  batch.zustand = stopp && !batch.items.length ? "fehler" : "bereit";
  batch.fehler = stopp;
  saveBatch(batch);
  appendPassLog({ start, ende: new Date().toISOString(), modus: "probe", erst: counts, nachfassen: emptyCounts(), antworten: 0, fehler: stopp ? [stopp] : [], stopp: stopp && is429(stopp) ? stopp : null, probe: batch.items.map((i) => `Batch vorbereitet · ${i.titel}`) });
  const erst = batch.items.filter((i) => i.art === "erst").length;
  await notify(
    stopp && is429(stopp)
      ? `⛔ Batch: ${RATE_LIMIT_TEXT} 12 h Pause.`
      : `📝 Batch vorbereitet: ${erst} Erst-Nachrichten, ${batch.items.length - erst} Nachfassen. Nichts gesendet — Vorschau und Freigabe auf /kurse (Reiter Batch).${stopp ? `\n⚠ ${stopp.slice(0, 200)}` : ""}`
  );
  await prisma.$disconnect();
  process.exit(0);
}

// ── Senden ──
const block = sendBlock(batch, new Date(), lastRunEnd(), earliestNext());
if (block) {
  console.error(block);
  await prisma.$disconnect();
  process.exit(0);
}
let release: () => void;
try {
  // Haelt die Automatik-Sperre: die tutor24-Sperre darin prueft den Abstand nicht nochmals (sendBlock hat entschieden).
  release = acquireTutor24Lock("Batch senden", AUTOPILOT_LOCK_PATH);
} catch (err) {
  // z. B. Doppelklick: der erste Sende-Prozess laeuft schon — dessen Stand nicht anfassen.
  console.error(err instanceof Error ? err.message : String(err));
  await prisma.$disconnect();
  process.exit(0);
}
batch.zustand = "sendet";
batch.pid = process.pid;
batch.fehler = null;
saveBatch(batch);
const chosen = batch.items.filter((i) => i.ausgewaehlt && !i.problem && !i.ergebnis);
const erstItems = chosen.filter((i) => i.art === "erst");
const nachItems = chosen.filter((i) => i.art === "nachfassen");
const erstCounts = emptyCounts();
const nachCounts = emptyCounts();
let stopp: string | null = null;
const tally = (i: BatchItem) => {
  if (i.ergebnis === "gesendet") erstCounts.gesendet++;
  else erstCounts.uebersprungen++;
  saveBatch(batch);
};
try {
  log(`Senden: ${erstItems.length} Erst-Nachrichten, ${nachItems.length} Nachfassen …`);
  if (erstItems.length) await sendBatchErst(erstItems, log, tally);
  if (nachItems.length) {
    if (erstItems.length) await new Promise((r) => setTimeout(r, 8_000 + Math.random() * 7_000));
    const since = new Date();
    try {
      await runFollowup({
        mode: "send", headless: true, onLog: log,
        auto: {
          limit: nachItems.length, minAgeDays: loadSettings().nachfassNachTagen, dryRun: false, mayContinue: () => null,
          counts: nachCounts, probe: [], antworten: [], onlyIds: nachItems.map((i) => i.id),
          expectedText: Object.fromEntries(nachItems.map((i) => [i.id, i.text])),
        },
      });
    } finally {
      const sent = await prisma.tutor24Message.findMany({
        where: { art: "nachfassen", sentAt: { gte: since }, lead: { conversationId: { in: nachItems.map((i) => i.id) } } },
        select: { status: true, lead: { select: { conversationId: true } } },
      });
      for (const i of nachItems) {
        const m = sent.find((s) => s.lead.conversationId === i.id);
        i.ergebnis = m ? (m.status === "gesendet" ? "gesendet" : "fehler") : "übersprungen";
        i.meldung = m ? m.status : "nicht gesendet (Antwort, zu jung oder Text geändert — siehe Protokoll)";
      }
      saveBatch(batch);
    }
  }
} catch (err) {
  stopp = followupJobState.error ?? (err instanceof Error ? err.message : String(err));
  log(`✖ ${stopp}`);
}
release!();
batch.zustand = "fertig";
batch.fehler = stopp;
saveBatch(batch);
const gesendet = chosen.filter((i) => i.ergebnis === "gesendet");
const fehler = chosen.filter((i) => i.ergebnis === "fehler");
appendPassLog({
  start, ende: new Date().toISOString(), modus: "an", erst: erstCounts, nachfassen: nachCounts, antworten: 0,
  fehler: [...fehler.map((i) => `[${i.id}] ${i.meldung}`), ...(stopp ? [stopp] : [])], stopp: stopp && is429(stopp) ? stopp : null,
});
await notify(
  `✉️ Batch gesendet: ${gesendet.length} von ${chosen.length}` +
    ` (${gesendet.filter((i) => i.art === "erst").length} Erst-Nachrichten, ${gesendet.filter((i) => i.art === "nachfassen").length} Nachfassen).` +
    (chosen.length - gesendet.length - fehler.length ? `\nÜbersprungen: ${chosen.length - gesendet.length - fehler.length}` : "") +
    (fehler.length ? `\n⚠ Fehler: ${fehler.map((i) => `${i.titel.slice(0, 40)} (${i.meldung})`).join("; ").slice(0, 600)}` : "") +
    (stopp ? `\n⛔ Abgebrochen: ${stopp.slice(0, 300)}${is429(stopp) ? " — 12 h Pause." : ""}` : "")
);
await prisma.$disconnect();
process.exit(0);
