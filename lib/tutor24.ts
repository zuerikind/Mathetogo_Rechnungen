import { prisma } from "./prisma";
import { assertNoAutomationRunning, tutor24JobState as jobState } from "./automation-state";
import {
  generateTutor24Message,
  TUTOR24_MESSAGE_TEMPLATE,
} from "./tutor24-message-prompt";
import {
  EXISTING_CONVO_SEL,
  TUTOR24_BASE_URL,
  buildPaginatedUrl,
  collectListingLinks,
  extractProfile,
  findVisible,
  gotoTutor24,
  acceptTutor24Cookies,
  jsClick,
  loginToTutor24,
  resolveTargetLanguage,
  sendMessageOnListing,
  sleep,
  ts,
  type ListingProfile,
} from "./tutor24-messaging";

export type { Tutor24Result } from "./tutor24-types";
export { tutor24JobState as jobState } from "./automation-state";

export const MESSAGE_TEMPLATE = TUTOR24_MESSAGE_TEMPLATE;

const BASE_URL = TUTOR24_BASE_URL;
const SEARCH_BASE = `${BASE_URL}/de/students/search`;

function searchUrl(subject: string, pageNum: number) {
  const q = encodeURIComponent(subject);
  return `${SEARCH_BASE}?q%5Bsubject_cont%5D=${q}&q%5Bradius%5D=100&page=${pageNum}`;
}

export async function runTutor24Messaging(
  headless = false,
  maxPages = 10,
  subjects = ["Mathematik", "Physik"]
): Promise<import("./tutor24-types").Tutor24Result> {
  assertNoAutomationRunning("tutor24");

  const email = process.env.TUTOR24_EMAIL;
  const password = process.env.TUTOR24_PASSWORD;
  if (!email || !password) throw new Error("TUTOR24_EMAIL and TUTOR24_PASSWORD must be set in .env.local");

  jobState.running = true;
  jobState.startedAt = new Date();

  const result: import("./tutor24-types").Tutor24Result = {
    messaged: 0,
    skipped: 0,
    errors: [],
    log: [],
    newContacts: [],
  };
  jobState.result = result;

  const { chromium } = await import("playwright");

  const browser = await chromium.launch({
    headless,
    slowMo: headless ? 0 : 80,
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    await loginToTutor24(page, email, password, (s) => result.log.push(s));
    await acceptTutor24Cookies(page, (s) => result.log.push(s));

    for (const subject of subjects) {
      result.log.push(`${ts()} ════ Suche: ${subject} ════`);

      await gotoTutor24(page, SEARCH_BASE, (s) => result.log.push(s));
      await sleep(1000);

      let subjectBaseUrl = searchUrl(subject, 1);

      const INPUT_SEL = [
        'input[name*="subject"]',
        'input[name*="fach"]',
        'input[placeholder*="Fach"]',
        'input[placeholder*="fach"]',
        'input[id*="subject"]',
        'input[id*="fach"]',
      ].join(", ");

      const inputEl = await findVisible(page, INPUT_SEL);
      let formFilled = false;

      if (inputEl) {
        await inputEl.fill(subject);
        await sleep(700);
        const autoItem = await findVisible(
          page,
          `[class*="dropdown"] *:has-text("${subject}"), ` +
            `[class*="suggest"] *:has-text("${subject}"), ` +
            `[role="option"]:has-text("${subject}"), ` +
            `[role="listbox"] li:has-text("${subject}")`
        );
        if (autoItem) {
          result.log.push(`${ts()} Autocomplete-Vorschlag geklickt`);
          await jsClick(autoItem);
          await sleep(400);
        }
        formFilled = true;
        result.log.push(`${ts()} Textfeld befüllt mit "${subject}"`);
      } else {
        const SELECT_SEL = [
          'select[name*="subject"]',
          'select[name*="fach"]',
          'select[id*="subject"]',
          'select[id*="fach"]',
        ].join(", ");
        const matchedOpt = await page.evaluate(
          ([sel, subj]: [string, string]) => {
            const el = document.querySelector(sel) as HTMLSelectElement | null;
            if (!el) return null;
            const opt = Array.from(el.options).find(
              (o) =>
                o.text.toLowerCase().includes(subj.toLowerCase()) ||
                o.value.toLowerCase().includes(subj.toLowerCase())
            );
            if (!opt) return null;
            el.value = opt.value;
            el.dispatchEvent(new Event("change", { bubbles: true }));
            return opt.text;
          },
          [SELECT_SEL, subject] as [string, string]
        );
        if (matchedOpt) {
          result.log.push(`${ts()} Select-Option gewählt: "${matchedOpt}"`);
          formFilled = true;
        }
      }

      if (!formFilled) {
        result.log.push(`${ts()} ⚠ Kein Suchfeld gefunden — Fallback auf URL-Parameter`);
      }

      const radiusSet = await page.evaluate(() => {
        const SLIDER_SEL = [
          'input[type="range"][name*="radius"]',
          'input[type="range"][id*="radius"]',
          'input[type="range"][class*="radius"]',
          'input[type="range"]',
        ].join(", ");
        const slider = document.querySelector(SLIDER_SEL) as HTMLInputElement | null;
        if (!slider) return false;
        const max = slider.max || "100";
        slider.value = max;
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        slider.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      });
      result.log.push(
        radiusSet ? `${ts()} Radius-Slider auf Maximum gesetzt` : `${ts()} Kein Radius-Slider gefunden`
      );

      const submitBtn = await findVisible(
        page,
        'button[type="submit"], input[type="submit"], button:has-text("Suchen"), button:has-text("Search")'
      );
      if (submitBtn) {
        const beforeUrl = page.url();
        await jsClick(submitBtn);
        try {
          await page.waitForURL((u) => u.toString() !== beforeUrl, {
            timeout: 15000,
            waitUntil: "domcontentloaded",
          });
        } catch {
          await sleep(2000);
        }
        const postSubmitUrl = page.url();
        if (postSubmitUrl !== SEARCH_BASE && postSubmitUrl.includes("/search")) {
          subjectBaseUrl = postSubmitUrl.replace(/([?&])page=\d+&?/, "$1").replace(/[?&]$/, "");
          result.log.push(`${ts()} ✓ Filter-URL: ${subjectBaseUrl}`);
        } else {
          result.log.push(`${ts()} ⚠ Submit führte zu keiner Filterseite (${postSubmitUrl}) — Fallback`);
        }
      } else {
        result.log.push(`${ts()} ⚠ Kein Submit-Button gefunden — Fallback auf URL-Parameter`);
      }

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        result.log.push(`${ts()} ── ${subject} Seite ${pageNum}/${maxPages} ──`);

        const listingUrl = buildPaginatedUrl(subjectBaseUrl, pageNum);
        await gotoTutor24(page, listingUrl, (s) => result.log.push(s));
        await sleep(1200);

        const links = await collectListingLinks(page, "jobs");

        if (links.length === 0) {
          result.log.push(`${ts()} Seite ${pageNum}: keine passenden Gesuche — Ende`);
          break;
        }
        result.log.push(`${ts()} Seite ${pageNum}: ${links.length} Gesuche gefunden`);

        for (const { href, id: tutor24Id } of links) {
          if (jobState.shouldStop) {
            result.log.push(`${ts()} ⏹ Gestoppt durch Benutzer`);
            break;
          }
          try {
            const existing = await prisma.tutor24Contact.findUnique({ where: { tutor24Id } });
            if (existing) {
              result.skipped++;
              continue;
            }

            await gotoTutor24(page, href, (s) => result.log.push(s));
            await sleep(800);

            const listingTitle = await page.title();
            const displayName = listingTitle.split(/[-–|]/)[0].trim() || tutor24Id;
            const pageUrl = page.url();

            const existingConvo = await findVisible(page, EXISTING_CONVO_SEL);
            if (existingConvo) {
              result.log.push(`${ts()} [${tutor24Id}] Konversation bereits vorhanden — übersprungen`);
              result.skipped++;
              continue;
            }

            const extracted = await extractProfile(page, displayName, subject, listingTitle);
            const { language, source } = resolveTargetLanguage(
              pageUrl,
              extracted.htmlLang,
              extracted.pageTitle,
              extracted.bodyText
            );
            const profile: ListingProfile = {
              name: extracted.name,
              subject: extracted.subject,
              bodyText: extracted.bodyText,
              pageTitle: extracted.pageTitle,
              language,
            };
            result.log.push(
              `${ts()} [${tutor24Id}] Sprache=${language} (${source}, URL=${pageUrl.match(/\/(de|en|fr)\//)?.[1] ?? "?"}) ` +
                `bodyText="${profile.bodyText.slice(0, 80) || "(leer)"}"`
            );
            const message = await generateTutor24Message(profile, (s) =>
              result.log.push(`${ts()} [${tutor24Id}] ${s}`)
            );

            const outcome = await sendMessageOnListing(page, message, tutor24Id, displayName, (s) =>
              result.log.push(s),
              href
            );

            if (outcome === "sent") {
              await prisma.tutor24Contact.create({ data: { tutor24Id, name: displayName, profileUrl: href } });
              result.messaged++;
              result.newContacts.push({ name: displayName, tutor24Id, profileUrl: href });
              await sleep(1500);
            } else if (outcome === "skipped_no_button") {
              result.skipped++;
            } else if (outcome === "skipped_no_textarea") {
              result.errors.push(`No textarea: ${tutor24Id} (${displayName})`);
            } else if (outcome === "error_no_submit") {
              result.errors.push(`No submit button: ${tutor24Id} (${displayName})`);
            } else if (outcome === "error_unconfirmed") {
              result.errors.push(`Send unconfirmed: ${tutor24Id} (${displayName})`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push(`[${tutor24Id}] ${msg}`);
            result.log.push(`${ts()} [${tutor24Id}] Fehler: ${msg}`);
          }
          if (jobState.shouldStop) break;
        }
        if (jobState.shouldStop) break;
      }
      if (jobState.shouldStop) break;
    }
  } finally {
    await browser.close();
    jobState.running = false;
    jobState.shouldStop = false;
    jobState.result = result;
  }

  return result;
}
