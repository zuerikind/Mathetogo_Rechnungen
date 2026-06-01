import { AcademigoContactType } from "@prisma/client";
import { prisma } from "./prisma";
import type { AcademigoMode, AcademigoResult } from "./academigo-types";
import { ACADEMIGO_MAX_TEACHER_HOURLY_CHF } from "./academigo-types";
import { assertNoAutomationRunning, academigoJobState } from "./automation-state";
import { getAcademigoCredentials } from "./academigo-credentials";
import { generateAcademigoMessage } from "./academigo-message-prompt";
import {
  EXISTING_CONVO_SEL,
  buildPaginatedUrl,
  collectListingLinks,
  extractProfile,
  extractProviderHourlyRate,
  findVisible,
  gotoTutor24,
  acceptTutor24Cookies,
  isTeacherHourlyRateAllowed,
  loginToTutor24,
  resolveTargetLanguage,
  sendMessageOnListing,
  sleep,
  ts,
  type ListingProfile,
} from "./tutor24-messaging";
export type { AcademigoMode, AcademigoResult } from "./academigo-types";
export { academigoJobState } from "./automation-state";

const SEARCH_URLS: Record<AcademigoMode, string> = {
  teachers: "https://www.tutor24.ch/de/providers/search?q%5Bplace%5D=8000%2C+Z%C3%BCrich",
  students: "https://www.tutor24.ch/de/jobs/search?q%5Bdistance%5D=10&q%5Bplace%5D=8000+Z%C3%BCrich",
};

const MODE_LABEL: Record<AcademigoMode, string> = {
  teachers: "Lehrer",
  students: "Schüler",
};

/** Max. Stundenlohn (CHF) für Lehrer-Automation — darüber wird nicht angeschrieben. */
export { ACADEMIGO_MAX_TEACHER_HOURLY_CHF } from "./academigo-types";

function contactTypeForMode(mode: AcademigoMode): AcademigoContactType {
  return mode === "teachers" ? AcademigoContactType.teacher : AcademigoContactType.student;
}

function linkSegmentForMode(mode: AcademigoMode): "jobs" | "providers" {
  return mode === "students" ? "jobs" : "providers";
}

export async function runAcademigoMessaging(opts: {
  mode: AcademigoMode;
  headless?: boolean;
  maxPages?: number;
  messageTemplate: string;
}): Promise<AcademigoResult> {
  assertNoAutomationRunning("academigo");

  const { mode, headless = false, maxPages = 10, messageTemplate } = opts;
  const { email, password } = getAcademigoCredentials(mode);
  const contactType = contactTypeForMode(mode);
  const pathSegment = linkSegmentForMode(mode);
  const searchBase = SEARCH_URLS[mode];

  academigoJobState.running = true;
  academigoJobState.mode = mode;
  academigoJobState.startedAt = new Date();

  const result: AcademigoResult = {
    messaged: 0,
    skipped: 0,
    errors: [],
    log: [],
    newContacts: [],
  };
  academigoJobState.result = result;

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
    result.log.push(`${ts()} Login als ${email} (${MODE_LABEL[mode]})`);
    result.log.push(`${ts()} ════ Academigo: ${MODE_LABEL[mode]} ════`);
    result.log.push(`${ts()} Suche: ${searchBase}`);

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      result.log.push(`${ts()} ── Seite ${pageNum}/${maxPages} ──`);
      const listingUrl = buildPaginatedUrl(searchBase, pageNum);
      await gotoTutor24(page, listingUrl, (s) => result.log.push(s));
      await sleep(1200);

      const links = await collectListingLinks(page, pathSegment);
      if (links.length === 0) {
        result.log.push(`${ts()} Seite ${pageNum}: keine Einträge — Ende`);
        break;
      }
      result.log.push(`${ts()} Seite ${pageNum}: ${links.length} Einträge gefunden`);

      for (const { href, id: tutor24Id } of links) {
        if (academigoJobState.shouldStop) {
          result.log.push(`${ts()} ⏹ Gestoppt durch Benutzer`);
          break;
        }

        try {
          const existing = await prisma.academigoContact.findUnique({
            where: { tutor24Id_contactType: { tutor24Id, contactType } },
          });
          if (existing) {
            result.skipped++;
            continue;
          }

          await gotoTutor24(page, href, (s) => result.log.push(s));
          await sleep(800);
          await acceptTutor24Cookies(page, (s) => result.log.push(s));

          if (mode === "teachers") {
            const hourlyRate = await extractProviderHourlyRate(page);
            const rateCheck = isTeacherHourlyRateAllowed(hourlyRate, ACADEMIGO_MAX_TEACHER_HOURLY_CHF);
            const rateLabel = hourlyRate.raw || (hourlyRate.chfPerHour !== null ? `CHF ${hourlyRate.chfPerHour}` : "unbekannt");
            if (!rateCheck.allowed) {
              result.log.push(`${ts()} [${tutor24Id}] ${rateCheck.reason} (${rateLabel}) — übersprungen`);
              result.skipped++;
              continue;
            }
            result.log.push(`${ts()} [${tutor24Id}] ${rateCheck.reason} (${rateLabel})`);
          }

          const listingTitle = await page.title();
          const displayName = listingTitle.split(/[-–|]/)[0].trim() || tutor24Id;
          const pageUrl = page.url();

          const existingConvo = await findVisible(page, EXISTING_CONVO_SEL);
          if (existingConvo) {
            result.log.push(`${ts()} [${tutor24Id}] Konversation bereits vorhanden — übersprungen`);
            result.skipped++;
            continue;
          }

          const subjectLabel = MODE_LABEL[mode];
          const extracted = await extractProfile(page, displayName, subjectLabel, listingTitle);
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
            `${ts()} [${tutor24Id}] Sprache=${language} (${source}) ` +
              `bodyText="${profile.bodyText.slice(0, 80) || "(leer)"}"`
          );

          const message = await generateAcademigoMessage(
            profile,
            messageTemplate,
            mode,
            (s) => result.log.push(`${ts()} [${tutor24Id}] ${s}`)
          );

          const outcome = await sendMessageOnListing(page, message, tutor24Id, displayName, (s) =>
            result.log.push(s),
            href
          );

          if (outcome === "sent") {
            await prisma.academigoContact.create({
              data: { tutor24Id, contactType, name: displayName, profileUrl: href },
            });
            result.messaged++;
            result.newContacts.push({
              name: displayName,
              tutor24Id,
              profileUrl: href,
              contactType: contactType === AcademigoContactType.teacher ? "teacher" : "student",
            });
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

        if (academigoJobState.shouldStop) break;
      }
      if (academigoJobState.shouldStop) break;
    }
  } finally {
    await browser.close();
    academigoJobState.running = false;
    academigoJobState.shouldStop = false;
    academigoJobState.mode = null;
    academigoJobState.result = result;
  }

  return result;
}
