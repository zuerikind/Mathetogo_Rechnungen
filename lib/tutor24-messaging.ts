/** Shared Playwright helpers for tutor24.ch (Tutor24 + Academigo). */

export const TUTOR24_BASE_URL = "https://www.tutor24.ch";

export type ListingProfile = {
  name: string;
  language: "de" | "en" | "fr";
  subject: string;
  bodyText: string;
  pageTitle: string;
};

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const NAV_TIMEOUT_MS = 30_000;

/** goto with domcontentloaded; continues if the page is partially loaded after timeout. */
export async function gotoTutor24(
  page: import("playwright").Page,
  url: string,
  pushLog?: (s: string) => void
): Promise<void> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Timeout") && !page.url().includes("about:blank")) {
      pushLog?.(`${ts()} ⚠ Langsames Laden (${page.url()}) — fahre fort`);
      return;
    }
    throw err;
  }
  await sleep(400);
}

async function isLoggedInToTutor24(page: import("playwright").Page): Promise<boolean> {
  const url = page.url();
  if (url.includes("tutor24.ch") && !url.includes("sign_in")) return true;
  const logout = await page.$(
    'a[href*="sign_out"], a[href*="logout"], form[action*="sign_out"], button:has-text("Abmelden")'
  );
  return !!logout && (await logout.isVisible().catch(() => false));
}

async function readLoginError(page: import("playwright").Page): Promise<string> {
  return page.evaluate(() => {
    const selectors = [
      ".alert-danger",
      ".alert-error",
      '[class*="flash-error"]',
      '[class*="error-message"]',
      '[role="alert"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const t = (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t.length > 5 && t.length < 300) return t;
    }
    return "";
  });
}

/** tutor24 uses #user_login (name user[login]), not user[email]; custom widgets need input events. */
async function fillTutor24LoginField(
  page: import("playwright").Page,
  selector: string,
  value: string
): Promise<void> {
  const field = page.locator(selector).first();
  await field.waitFor({ state: "visible", timeout: 15000 });
  await field.click();
  await field.fill("");
  await field.fill(value);
  await field.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = v;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function waitForLoginOutcome(
  page: import("playwright").Page,
  timeoutMs: number
): Promise<"ok" | "still_on_sign_in" | "challenge"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    if (
      /two_factor|2fa|verification|confirm|challenge|captcha/i.test(url)
    ) {
      return "challenge";
    }
    if (await isLoggedInToTutor24(page)) return "ok";
    await sleep(400);
  }
  if (await isLoggedInToTutor24(page)) return "ok";
  const url = page.url();
  if (/two_factor|verification|confirm|challenge|captcha/i.test(url)) return "challenge";
  return page.url().includes("sign_in") ? "still_on_sign_in" : "ok";
}

export function ts() {
  return new Date().toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export async function findVisible(page: import("playwright").Page, selector: string) {
  try {
    const all = await page.$$(selector);
    for (const el of all) {
      if (await el.isVisible()) return el;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function jsClick(el: import("playwright").ElementHandle) {
  await el.evaluate((node) => (node as HTMLElement).click());
}

type ExtractedProfile = Omit<ListingProfile, "language"> & { htmlLang: ListingProfile["language"] };

export async function extractProfile(
  page: import("playwright").Page,
  displayName: string,
  subject: string,
  listingTitle: string
): Promise<ExtractedProfile> {
  return page.evaluate(
    ({ name, subject, title }) => {
      const langAttr = (document.documentElement.lang ?? "de").toLowerCase();
      const htmlLang: "de" | "en" | "fr" = langAttr.startsWith("en")
        ? "en"
        : langAttr.startsWith("fr")
          ? "fr"
          : "de";

      const SKIP = [
        "cookie",
        "agb",
        "datenschutz",
        "impressum",
        "sitemap",
        "nutzungsbedingungen",
        "je schneller sie sich bewerben",
        "ihre chancen auf den job",
        "umso höher sind ihre chancen",
        "bewerben sie sich",
        "tutor24.ch",
        "ähnliche gesuche",
        "weitere gesuche",
        "ähnliche anbieter",
        "weitere anbieter",
      ];
      const isSkipped = (t: string) => {
        const low = t.toLowerCase();
        return SKIP.some((w) => low.includes(w));
      };

      const candidates = Array.from(document.querySelectorAll("p, li, .description, [class*='description']"))
        .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter((t) => t.length > 25 && t.length < 600)
        .filter((t) => !isSkipped(t));

      const bodyText = candidates.join(" ").slice(0, 500);
      return { name, htmlLang, subject, bodyText, pageTitle: title };
    },
    { name: displayName, subject, title: listingTitle }
  );
}

export type ProviderHourlyRate = {
  chfPerHour: number | null;
  raw: string;
  negotiable: boolean;
};

function parseChfNumber(s: string): number {
  return parseFloat(s.replace(",", "."));
}

/** Parse tutor24 hourly rate text (profile box or search card). */
export function parseProviderHourlyRateText(raw: string): ProviderHourlyRate {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return { chfPerHour: null, raw: "", negotiable: false };

  if (/verhandelbar/i.test(text)) {
    return { chfPerHour: null, raw: text, negotiable: true };
  }

  const rangeMatch = text.match(/CHF\s*(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)/i);
  if (rangeMatch) {
    return {
      chfPerHour: parseChfNumber(rangeMatch[2]),
      raw: text,
      negotiable: false,
    };
  }

  const singleMatch = text.match(/CHF\s*(\d+(?:[.,]\d+)?)/i);
  if (singleMatch) {
    return {
      chfPerHour: parseChfNumber(singleMatch[1]),
      raw: text,
      negotiable: false,
    };
  }

  return { chfPerHour: null, raw: text, negotiable: false };
}

function parseProviderHourlyRateFromBlob(blob: string): ProviderHourlyRate {
  const lines = blob
    .split(/\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    if (!/^stundenlohn$/i.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const parsed = parseProviderHourlyRateText(lines[j]);
      if (parsed.chfPerHour !== null || parsed.negotiable) return parsed;
    }
  }

  const normalized = blob.replace(/\s+/g, " ");
  const rangeMatch = normalized.match(/CHF\s*(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*\/?\s*Stunde/i);
  if (rangeMatch) {
    return parseProviderHourlyRateText(rangeMatch[0]);
  }

  const singleMatch = normalized.match(/CHF\s*(\d+(?:[.,]\d+)?)\s*\/?\s*Stunde/i);
  if (singleMatch) {
    return parseProviderHourlyRateText(singleMatch[0]);
  }

  if (/verhandelbar\s*\/?\s*stunde/i.test(normalized)) {
    return { chfPerHour: null, raw: "Verhandelbar / Stunde", negotiable: true };
  }

  return { chfPerHour: null, raw: "", negotiable: false };
}

/** Parse tutor24 provider profile hourly rate (CHF / Stunde). */
export async function extractProviderHourlyRate(
  page: import("playwright").Page
): Promise<ProviderHourlyRate> {
  const fromProfileBox = await page.evaluate(() => {
    const boxes = Array.from(
      document.querySelectorAll(".profile-value-boxes > div, .profile-value-boxes > .bg-gray-0")
    );
    for (const box of boxes) {
      const labelEl = box.querySelector(".mb-4");
      const label = (labelEl?.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!/^stundenlohn$/i.test(label)) continue;
      const valueEl = box.querySelector(".profile-value-boxes__value");
      const value = (valueEl?.textContent ?? "").replace(/\s+/g, " ").trim();
      if (value) return value;
    }
    return "";
  });

  if (fromProfileBox) {
    return parseProviderHourlyRateText(fromProfileBox);
  }

  const blob = await page.evaluate(() => document.body.innerText.slice(0, 12000));
  return parseProviderHourlyRateFromBlob(blob);
}

export function isTeacherHourlyRateAllowed(
  rate: ProviderHourlyRate,
  maxChfPerHour: number
): { allowed: boolean; reason: string } {
  if (rate.chfPerHour !== null) {
    if (rate.chfPerHour > maxChfPerHour) {
      return {
        allowed: false,
        reason: `Stundenlohn CHF ${rate.chfPerHour} > max. CHF ${maxChfPerHour}`,
      };
    }
    return { allowed: true, reason: `Stundenlohn CHF ${rate.chfPerHour}/h` };
  }
  if (rate.negotiable) {
    return {
      allowed: false,
      reason: "Stundenlohn «Verhandelbar» — kein fester Betrag ≤ Grenze",
    };
  }
  return { allowed: false, reason: "Kein Stundenlohn auf Profil gefunden" };
}

function localeFromPageUrl(pageUrl: string): ListingProfile["language"] | null {
  const m = pageUrl.match(/tutor24\.ch\/(en|fr)(?:\/|$)/i);
  if (!m) return null;
  return m[1].toLowerCase() as ListingProfile["language"];
}

const SITE_BOILERPLATE_RE =
  /je schneller sie sich bewerben|ihre chancen auf den job|umso höher sind ihre chancen/i;

function isSiteBoilerplate(text: string): boolean {
  return SITE_BOILERPLATE_RE.test(text);
}

function scoreTextLanguage(text: string): { de: number; en: number; fr: number } {
  const s = text.toLowerCase();
  const count = (re: RegExp) => (s.match(re) ?? []).length;

  const en =
    count(
      /\b(the|and|for|with|you|your|student|tutor|math|mathematics|physics|wanted|needed|help|lessons|hour|school|primary|secondary|university|looking|searching|tutoring|weekly|online|experience)\b/g
    ) +
    count(/\b(tutor wanted|wanted for|need a tutor|math tutor|looking for|searching for|hourly rate)\b/g);

  const de =
    count(
      /\b(der|die|das|und|ich|wir|suche|gesucht|schüler|schülerin|nachhilfe|prüfung|stunde|gymnasium|mathematik|physik|lehrer|lehrerin|auftrag|anfrage)\b/g
    ) +
    count(/\b(nachhilfelehrer|gesucht in|ich suche|wir suchen|bitte melden)\b/g);

  const fr =
    count(/\b(le|la|les|des|je|nous|cherche|recherche|élève|professeur|mathématiques|physique|cours|besoin|soutien)\b/g) +
    count(/\b(je recherche|cherche un|recherche un prof)\b/g);

  return { de, en, fr };
}

function pickLanguage(scores: { de: number; en: number; fr: number }): ListingProfile["language"] | null {
  const { de, en, fr } = scores;
  const max = Math.max(de, en, fr);
  if (max < 2) return null;
  if (en === max && en >= de && en >= fr) return "en";
  if (fr === max && fr > de && fr >= en) return "fr";
  if (de === max) return "de";
  return null;
}

function detectLanguageFromText(listingTitle: string, bodyText: string): ListingProfile["language"] | null {
  const title = listingTitle.trim();
  const body = isSiteBoilerplate(bodyText) ? "" : bodyText.trim();

  const fromTitle = title ? pickLanguage(scoreTextLanguage(title)) : null;
  if (fromTitle) return fromTitle;

  const combined = `${title} ${body}`.trim();
  if (!combined) return null;
  return pickLanguage(scoreTextLanguage(combined));
}

export function resolveTargetLanguage(
  pageUrl: string,
  htmlLang: ListingProfile["language"],
  listingTitle: string,
  bodyText: string
): { language: ListingProfile["language"]; source: string } {
  const fromText = detectLanguageFromText(listingTitle, bodyText);
  if (fromText) return { language: fromText, source: "Titel/Text" };

  const fromUrl = localeFromPageUrl(pageUrl);
  if (fromUrl) return { language: fromUrl, source: "URL" };

  return { language: htmlLang, source: "HTML" };
}

export const EXISTING_CONVO_SEL =
  'a:has-text("Konversation öffnen"), button:has-text("Konversation öffnen"), ' +
  'a:has-text("Gespräch öffnen"), button:has-text("Gespräch öffnen")';

/** @deprecated Prefer findContactButton() — kept for reference */
export const CONTACT_BTN_SEL = [
  "a.js-btn-send-message",
  "button.js-btn-send-message",
  'a[href*="/messages-new"]',
  'a[href*="/messages/new"]',
  'a:has-text("Nachricht senden")',
  'a:has-text("Ich bin interessiert")',
  'button:has-text("Ich bin interessiert")',
  'a:has-text("Nachricht schreiben")',
  'a:has-text("Kontaktieren")',
  'a:has-text("Kontakt aufnehmen")',
  'a:has-text("Auf Gesuch bewerben")',
  'a:has-text("Bewerben")',
  'button:has-text("Bewerben")',
  ".message-btn",
  ".contact-btn",
].join(", ");

export const SUBMIT_SEL =
  'input[type="submit"], button[type="submit"], button:has-text("Senden"), button:has-text("Absenden"), button:has-text("Schicken"), button:has-text("Nachricht senden")';

const COOKIE_ACCEPT_SEL = [
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#onetrust-accept-btn-handler",
  'button:has-text("Alle akzeptieren")',
  'button:has-text("Akzeptieren")',
  'button:has-text("Accept all")',
  'button:has-text("Accept")',
].join(", ");

export async function acceptTutor24Cookies(
  page: import("playwright").Page,
  pushLog?: (s: string) => void
): Promise<void> {
  const btn = await findVisible(page, COOKIE_ACCEPT_SEL);
  if (!btn) return;
  await jsClick(btn);
  await sleep(600);
  pushLog?.(`${ts()} Cookie-Banner geschlossen`);
}

function isExcludedContactLink(href: string | null): boolean {
  if (!href) return false;
  return (
    href.includes("/conversations") ||
    href.includes("feedback_message") ||
    href.includes("inappropriate-messages")
  );
}

/** tutor24 provider/job pages use .js-btn-send-message (not always /messages/new). */
async function findContactButton(page: import("playwright").Page) {
  const primary = await findVisible(page, "a.js-btn-send-message, button.js-btn-send-message");
  if (primary) return primary;

  const selectors = [
    'a[href*="/users/"][href*="/messages/new"]',
    'a[href*="/messages/new"]',
    'a[href*="/messages-new"]',
    'a:has-text("Nachricht senden")',
    'a:has-text("Ich bin interessiert")',
    'button:has-text("Ich bin interessiert")',
    'a:has-text("Auf Gesuch bewerben")',
    'a:has-text("Kontaktieren")',
    'a:has-text("Kontakt aufnehmen")',
    'a:has-text("Bewerben")',
    'button:has-text("Bewerben")',
    ".message-btn",
    ".contact-btn",
  ];

  for (const sel of selectors) {
    const candidates = await page.$$(sel);
    for (const el of candidates) {
      if (!(await el.isVisible())) continue;
      const href = await el.getAttribute("href");
      if (isExcludedContactLink(href)) continue;
      return el;
    }
  }
  return null;
}

async function isPremiumGateVisible(page: import("playwright").Page): Promise<boolean> {
  if (page.url().includes("upgrade_to_premium")) return true;
  return !!(await findVisible(
    page,
    'a:has-text("Nachrichten freischalten"), a:has-text("Premium freischalten"), a:has-text("Premium-Mitglied werden")'
  ));
}

async function waitForMessageTextarea(
  page: import("playwright").Page,
  timeoutMs = 8000
): Promise<import("playwright").ElementHandle | null> {
  const sel =
    'textarea[name="message[content]"], textarea.js-message-form-input, textarea:not([disabled]):not(#report_open_input)';
  try {
    return await page.waitForSelector(sel, { state: "visible", timeout: timeoutMs });
  } catch {
    return null;
  }
}

async function hasMessageTextarea(page: import("playwright").Page): Promise<boolean> {
  return !!(await waitForMessageTextarea(page, 1500));
}

function messageFormUrls(
  listingHref: string,
  tutor24Id: string,
  contactHref?: string | null
): string[] {
  const urls: string[] = [];
  const add = (u: string) => {
    if (u && !urls.includes(u)) urls.push(u);
  };

  if (contactHref && !contactHref.startsWith("#") && contactHref.includes("messages")) {
    add(contactHref.startsWith("http") ? contactHref : `${TUTOR24_BASE_URL}${contactHref}`);
  }

  const locale = listingHref.match(/\/(de|en|fr)\//)?.[1] ?? "de";
  const id =
    listingHref.match(/\/(providers|jobs|students|users|requests|gesuche)\/(\d+)/)?.[2] ?? tutor24Id;

  add(`${TUTOR24_BASE_URL}/${locale}/users/${id}/messages/new`);

  const kind = listingHref.match(/\/(providers|jobs|students|requests|gesuche)\/(\d+)/)?.[1];
  if (kind === "providers" || kind === "students" || kind === "jobs") {
    add(`${TUTOR24_BASE_URL}/${locale}/${kind}/${id}#send_message`);
  }

  return urls;
}

async function openMessageForm(
  page: import("playwright").Page,
  listingHref: string,
  tutor24Id: string,
  pushLog: (s: string) => void,
  contactHref?: string | null
): Promise<boolean> {
  if (await hasMessageTextarea(page)) return true;

  if (page.url().includes("#send_message")) {
    const ta = await waitForMessageTextarea(page, 6000);
    if (ta) return true;
  }

  if (await isPremiumGateVisible(page)) {
    pushLog(`${ts()} [${tutor24Id}] Premium-Dialog erkannt`);
  }

  for (const msgUrl of messageFormUrls(listingHref, tutor24Id, contactHref)) {
    const currentNorm = page.url().split("#")[0].replace(/\/$/, "");
    const targetNorm = msgUrl.split("#")[0].replace(/\/$/, "");
    // Already on profile with message anchor — don't navigate away to a broken /messages-new URL
    if (currentNorm === targetNorm && page.url().includes("#send_message")) {
      const ta = await waitForMessageTextarea(page, 4000);
      if (ta) return true;
      continue;
    }
    if (currentNorm === targetNorm && msgUrl.includes("#") && page.url().includes("#")) continue;

    pushLog(`${ts()} [${tutor24Id}] Öffne Nachrichtenformular: ${msgUrl}`);
    await gotoTutor24(page, msgUrl, pushLog);
    await acceptTutor24Cookies(page, pushLog);
    await sleep(1500);
    if (await waitForMessageTextarea(page, 6000)) return true;
  }

  const modalTa = await page
    .waitForSelector(
      '[role="dialog"] textarea[name="message[content]"], .modal textarea.js-message-form-input, form textarea.js-message-form-input',
      { timeout: 3000 }
    )
    .catch(() => null);
  return !!modalTa;
}

async function clickContactButton(
  page: import("playwright").Page,
  msgBtn: import("playwright").ElementHandle
): Promise<void> {
  const btnHref = await msgBtn.getAttribute("href");
  const isHashOrEmpty = !btnHref || btnHref.startsWith("#") || btnHref === "";
  if (!isHashOrEmpty && !btnHref.startsWith("javascript:")) {
    const dest = btnHref.startsWith("http") ? btnHref : `${TUTOR24_BASE_URL}${btnHref}`;
    await gotoTutor24(page, dest);
  } else {
    await jsClick(msgBtn);
    await sleep(1500);
  }
}

export async function loginToTutor24(
  page: import("playwright").Page,
  email: string,
  password: string,
  pushLog: (s: string) => void
): Promise<void> {
  pushLog(`${ts()} Logging in to tutor24.ch (${email})...`);
  await gotoTutor24(page, `${TUTOR24_BASE_URL}/de/sign_in`, pushLog);
  await acceptTutor24Cookies(page, pushLog);

  if (await isLoggedInToTutor24(page)) {
    pushLog(`${ts()} Bereits angemeldet`);
    return;
  }

  await page.waitForSelector("#login-form, form.js-new-user-form", { timeout: 15000 });
  await sleep(600);

  const emailField = "#user_login, input[name='user[login]']";
  const passwordField = "#user_password, input[name='user[password]']";

  await fillTutor24LoginField(page, emailField, email);
  await fillTutor24LoginField(page, passwordField, password);

  const emailValue = await page.locator(emailField).first().inputValue();
  if (emailValue.trim() !== email.trim()) {
    pushLog(`${ts()} ⚠ E-Mail-Feld per fill leer — tippe erneut`);
    await page.locator(emailField).first().pressSequentially(email, { delay: 25 });
  }

  const submit =
    (await findVisible(page, "#login-btn, #login-form input[type='submit']")) ??
    (await findVisible(page, 'input[type="submit"], button[type="submit"]'));
  if (!submit) {
    throw new Error("Login: Submit-Button auf tutor24.ch nicht gefunden");
  }

  const emailBeforeSubmit = await page.locator(emailField).first().inputValue();
  pushLog(
    `${ts()} Login-Formular: E-Mail="${emailBeforeSubmit ? emailBeforeSubmit.slice(0, 3) + "…" : "(leer)"}"`
  );
  if (!emailBeforeSubmit.trim()) {
    throw new Error("E-Mail wurde nicht ins Login-Feld geschrieben — bitte erneut versuchen.");
  }

  // tutor24 often updates via SPA — do not rely on waitForNavigation (times out).
  await jsClick(submit);
  try {
    await page.waitForURL((u) => !u.toString().includes("sign_in"), {
      timeout: 8000,
      waitUntil: "domcontentloaded",
    });
  } catch {
    /* poll below */
  }

  const outcome = await waitForLoginOutcome(page, NAV_TIMEOUT_MS);
  if (outcome === "challenge") {
    throw new Error(
      "Login braucht eine zusätzliche Bestätigung (E-Mail-Link/2FA). Bitte einmal manuell auf tutor24.ch anmelden, dann Automation erneut starten."
    );
  }
  if (outcome === "still_on_sign_in") {
    const err = await readLoginError(page);
    throw new Error(
      err
        ? `Login fehlgeschlagen: ${err}`
        : "Login fehlgeschlagen — TUTOR24_EMAIL / TUTOR24_PASSWORD in .env.local prüfen."
    );
  }

  pushLog(`${ts()} Login successful`);
}

export async function collectListingLinks(
  page: import("playwright").Page,
  pathSegment: "jobs" | "providers"
): Promise<{ href: string; id: string }[]> {
  const segments =
    pathSegment === "jobs"
      ? "students|requests|jobs|gesuche"
      : "providers|tutors|teachers|nachhilfelehrer|private-teacher";
  return page.evaluate((segPattern: string) => {
    const re = new RegExp(`^\\/(de|en|fr)\\/(${segPattern})\\/(\\d+)`);
    const anchors = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];
    const seen = new Set<string>();
    const links: { href: string; id: string }[] = [];
    for (const a of anchors) {
      const m = a.pathname.match(re);
      if (!m) continue;
      const id = m[3];
      if (seen.has(id)) continue;
      seen.add(id);
      links.push({ href: a.href, id });
    }
    return links;
  }, segments);
}

export function buildPaginatedUrl(baseUrl: string, pageNum: number): string {
  if (baseUrl.includes("page=")) {
    return baseUrl.replace(/([?&])page=\d+/, `$1page=${pageNum}`);
  }
  return baseUrl + (baseUrl.includes("?") ? "&" : "?") + `page=${pageNum}`;
}

export type SendMessageOutcome = "sent" | "skipped_no_button" | "skipped_no_textarea" | "error_no_submit" | "error_unconfirmed";

export async function sendMessageOnListing(
  page: import("playwright").Page,
  message: string,
  tutor24Id: string,
  displayName: string,
  pushLog: (s: string) => void,
  listingHref?: string
): Promise<SendMessageOutcome> {
  await acceptTutor24Cookies(page, pushLog);

  const msgBtn = await findContactButton(page);
  if (!msgBtn) {
    pushLog(`${ts()} [${tutor24Id}] kein Kontakt-Button — übersprungen`);
    return "skipped_no_button";
  }

  const btnText = (await msgBtn.evaluate((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())) || "";
  const btnHref = await msgBtn.getAttribute("href");
  pushLog(`${ts()} [${tutor24Id}] Kontakt-Button «${btnText.slice(0, 40)}» href=${btnHref ?? "(click)"}`);

  await clickContactButton(page, msgBtn);
  await acceptTutor24Cookies(page, pushLog);
  await sleep(1000);

  let textarea = await waitForMessageTextarea(page, 8000);
  if (!textarea) {
    const profileUrl = listingHref ?? page.url();
    const formReady = await openMessageForm(page, profileUrl, tutor24Id, pushLog, btnHref);
    textarea = formReady ? await waitForMessageTextarea(page, 4000) : null;
  }

  if (!textarea) {
    if (await isPremiumGateVisible(page)) {
      pushLog(
        `${ts()} [${tutor24Id}] ⚠ Kein Nachrichtenformular — vermutlich Premium nötig auf tutor24.ch (Nachrichten freischalten)`
      );
    } else {
      pushLog(`${ts()} [${tutor24Id}] kein Textfeld — URL: ${page.url()}`);
    }
    return "skipped_no_textarea";
  }

  await textarea.fill(message);
  await sleep(600);

  const submitBtn = await findVisible(page, SUBMIT_SEL);
  const submitDebug = await Promise.all(
    (await page.$$(SUBMIT_SEL)).map(async (b) => {
      const txt = await b.evaluate(
        (el) => (el as HTMLElement).innerText?.trim() || (el as HTMLInputElement).value || ""
      );
      const vis = await b.isVisible();
      return `"${txt}"(${vis ? "✓" : "✗"})`;
    })
  );
  pushLog(`${ts()} [${tutor24Id}] Submit-Buttons: ${submitDebug.join(", ") || "keine"}`);

  if (!submitBtn) {
    pushLog(`${ts()} [${tutor24Id}] kein sichtbarer Absenden-Button`);
    return "error_no_submit";
  }

  pushLog(`${ts()} [${tutor24Id}] Sende...`);
  const preSendUrl = page.url();
  await jsClick(submitBtn);
  await sleep(2500);

  const postSendUrl = page.url();
  const urlChanged = postSendUrl !== preSendUrl;
  const successEl = await findVisible(
    page,
    '[class*="success"], [class*="alert-success"], [class*="notice--success"], ' +
      'div:has-text("Nachricht gesendet"), div:has-text("erfolgreich gesendet"), ' +
      'div:has-text("Danke"), p:has-text("Nachricht gesendet")'
  );
  if (!urlChanged && !successEl) {
    pushLog(`${ts()} [${tutor24Id}] ⚠ Kein Erfolgsindikator nach Absenden (URL: ${postSendUrl})`);
    return "error_unconfirmed";
  }

  pushLog(`${ts()} ✓ Gesendet an ${displayName} (ID ${tutor24Id})`);
  return "sent";
}
