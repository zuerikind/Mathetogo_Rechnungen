/**
 * Probelauf fuer die neue Erst-Nachricht (Anrede, Kursangebot, Nachfrage) — sendet NICHTS
 * und schreibt NICHTS in die Datenbank.
 *
 *   npx tsx scripts/course-offer-dryrun.mts --offset 0 --limit 50
 *
 * Nimmt die Konversationen aus tutor24-followup/followup_preview.csv, deren Inserat schon
 * einmal gelesen wurde, oeffnet Konversation (fuer die Inserat-ID) und Inserat, 3–5 s Pause
 * nach jedem Aufruf. Gelesene Inserate werden zwischengespeichert (course_offer_listings.json),
 * ein zweiter Lauf oeffnet sie nicht nochmals.
 * Ergebnis: tutor24-followup/course_offer_dryrun.csv (+ _messages.json mit den Texten).
 */
import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

config({ path: ".env.local" });

const { FOLLOWUP_DIR, readPreview } = await import("../lib/tutor24-followup-store");
const { parseJobText, toCsv, parseCsv } = await import("../lib/tutor24-followup");
const { composeFirstMessage } = await import("../lib/tutor24");
const { StopRun, assertPageOk, BLOCKED_URLS } = await import("../lib/tutor24-followup-runner");
const { acquireTutor24Lock } = await import("../lib/tutor24-lock");
const { TUTOR24_BASE_URL, acceptTutor24Cookies, gotoTutor24, loginToTutor24, sleep } = await import("../lib/tutor24-messaging");

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? Number(process.argv[i + 1]) : def;
};
const offset = arg("--offset", 0);
const limit = arg("--limit", 50);

const CACHE = join(FOLLOWUP_DIR, "course_offer_listings.json");
const OUT = join(FOLLOWUP_DIR, "course_offer_dryrun.csv");
const MSG = join(FOLLOWUP_DIR, "course_offer_dryrun_messages.json");
const COLS = [
  "conversation_id", "inserat_id", "kategorie", "kursgruppe", "sicherheit", "wer", "anrede", "kind",
  "ergebnis", "kurs", "grund", "satz", "problem", "anrede_alt", "auszug",
] as const;

type Cached = { jobId: string | null; info: ReturnType<typeof parseJobText> | null; error?: string };
const cache: Record<string, Cached> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
const prevRows = existsSync(OUT) ? parseCsv(readFileSync(OUT, "utf8")) : [];
const messages: Record<string, string> = existsSync(MSG) ? JSON.parse(readFileSync(MSG, "utf8")) : {};

const candidates = readPreview().filter((r) => r.stufe || r.fach);
// --fetch-only: nur Inserate lesen und zwischenspeichern (ohne Text, ohne KI) — fuer scripts/step7-test.mts.
const fetchOnly = process.argv.includes("--fetch-only");
// --nachgefasst: zusaetzlich die schon Nachgefassten ohne Analyse (nur lesen aus der Datenbank, nichts schreiben).
const extra: Array<{ conversation_id: string; anrede: string }> = [];
if (process.argv.includes("--nachgefasst")) {
  const { prisma } = await import("../lib/prisma");
  const leads = await prisma.tutor24Lead.findMany({ where: { kategorie: "", conversationId: { not: null }, messages: { some: { art: "nachfassen" } } }, select: { conversationId: true, anrede: true } });
  extra.push(...leads.map((l) => ({ conversation_id: l.conversationId as string, anrede: l.anrede })));
  await prisma.$disconnect();
}
const batch = [...candidates.slice(offset, offset + limit), ...extra] as Array<{ conversation_id: string; anrede: string }>;
console.log(`${candidates.length} Konversationen mit gelesenem Inserat; dieser Lauf: ${offset + 1}–${offset + batch.length}.`);

const pause = () => sleep(3_000 + Math.random() * 2_000);
const releaseLock = acquireTutor24Lock("Probelauf Erst-Nachricht (nur lesend)");
const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true });
const rows = new Map(prevRows.map((r) => [r.conversation_id, r]));
try {
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setBlockedURLs", { urls: BLOCKED_URLS });
  const needsBrowser = batch.some((r) => !cache[r.conversation_id]?.info);
  if (needsBrowser) {
    // Das Login-Feld bleibt gelegentlich leer (Seite noch nicht fertig): einmal wiederholen.
    const login = () => loginToTutor24(page, process.env.TUTOR24_EMAIL ?? "", process.env.TUTOR24_PASSWORD ?? "", () => {});
    await login().catch(async (err) => {
      console.log(`Login-Versuch 1: ${(err as Error).message} — neuer Versuch`);
      await sleep(5_000);
      await login();
    });
    await acceptTutor24Cookies(page, () => {});
    await assertPageOk(page, "nach dem Login");
    console.log("Angemeldet.");
  }

  for (const [i, r] of batch.entries()) {
    const tag = `[${offset + i + 1}] ${r.conversation_id}`;
    let c = cache[r.conversation_id];
    if (!c?.info) {
      try {
        await gotoTutor24(page, `${TUTOR24_BASE_URL}/de/conversations/${r.conversation_id}?tab=sent`);
        await page.waitForSelector(".js-conversation-container", { timeout: 15_000 }).catch(() => {});
        await assertPageOk(page, `Konversation ${r.conversation_id}`);
        const link = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href*="/jobs/"]')).map((a) => a.getAttribute("href") ?? "").find((h) => /\/jobs\/\d+/.test(h) && h.includes("back=conversation")) ?? null
        );
        await pause();
        const jobId = link?.match(/\/jobs\/(\d+)/)?.[1] ?? null;
        if (!jobId) {
          c = { jobId: null, info: null, error: "kein Inserat-Link" };
        } else {
          await gotoTutor24(page, `${TUTOR24_BASE_URL}/de/jobs/${jobId}`);
          await page
            .waitForFunction(() => /Gesuchte Nachhilfe|nicht mehr aktiv|nicht mehr verfügbar|deaktiviert|wurde gelöscht|existiert nicht/i.test(document.body?.innerText ?? ""), undefined, { timeout: 15_000 })
            .catch(() => {});
          await assertPageOk(page, `Inserat ${jobId}`);
          const [t, title] = await Promise.all([page.evaluate(() => document.body.innerText), page.title()]);
          c = { jobId, info: parseJobText(t, title) };
          await pause();
        }
      } catch (err) {
        // Captcha, 429, Login: assertPageOk wirft StopRun → ganzer Lauf bricht ab (oben im finally aufgeraeumt).
        if (err instanceof StopRun) throw err;
        c = { jobId: null, info: null, error: (err as Error).message.slice(0, 120) };
      }
      cache[r.conversation_id] = c;
      writeFileSync(CACHE, JSON.stringify(cache, null, 1));
    }

    if (fetchOnly) {
      console.log(`${tag}: ${c.info ? `gelesen (${c.info.schulstufe || "?"})` : c.error}`);
      continue;
    }
    if (!c.info) {
      rows.set(r.conversation_id, { conversation_id: r.conversation_id, inserat_id: "", ergebnis: "fehler", grund: c.error ?? "", anrede_alt: r.anrede } as Record<string, string>);
      console.log(`${tag}: ${c.error}`);
      continue;
    }
    const m = await composeFirstMessage(c.info, (s) => console.log(`${tag}: ${s}`));
    const { plan } = m;
    messages[r.conversation_id] = m.text;
    rows.set(r.conversation_id, {
      conversation_id: r.conversation_id,
      inserat_id: c.jobId ?? "",
      kategorie: plan.analysis.kategorie,
      kursgruppe: plan.analysis.kursgruppe,
      sicherheit: plan.analysis.sicherheit,
      wer: plan.addressee.wer,
      anrede: plan.addressee.anrede,
      kind: plan.addressee.kind ?? "",
      ergebnis: m.course ? "kurs" : plan.offer.kind,
      kurs: m.course?.name ?? "",
      grund: plan.offer.kind === "kurs" ? (m.course ? "" : "prüfung_fehlgeschlagen") : plan.offer.grund,
      satz: m.satz,
      problem: m.problem ?? "",
      anrede_alt: r.anrede,
      auszug: c.info.description.replace(/\s+/g, " ").slice(0, 160),
    });
    writeFileSync(OUT, toCsv(Array.from(rows.values()), COLS));
    writeFileSync(MSG, JSON.stringify(messages, null, 1));
  }
} finally {
  await browser.close().catch(() => {});
  releaseLock();
}

const all = Array.from(rows.values());
const count = (k: string) => all.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r[k] || "-"]: (acc[r[k] || "-"] ?? 0) + 1 }), {});
console.log(`\n══ ${all.length} ausgewertet ══`);
console.log("Ergebnis:", count("ergebnis"));
console.log("Grund:", count("grund"));
console.log("Anrede:", count("wer"));
console.log("Satz:", count("satz"));
console.log(`CSV: ${OUT}`);
process.exit(0);
