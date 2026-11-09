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

/**
 * Netzfehler, die voruebergehen — der Lauf darf daran nicht sterben.
 *
 * ERR_NETWORK_IO_SUSPENDED kommt, wenn Windows die Netzwerk-IO anhaelt: Standby,
 * zugeklappter Deckel, schlafender WLAN-Adapter. Der Lauf dauert lange, das
 * passiert also irgendwann zwangslaeufig. Vorher warf goto den Fehler durch bis
 * in die Seitenschleife, die ausserhalb des try/catch der einzelnen Gesuche
 * liegt — ein einziger Aussetzer beendete damit den ganzen Durchgang samt der
 * noch offenen Fächer.
 */
const RETRYABLE_NET_ERRORS = [
  "ERR_NETWORK_IO_SUSPENDED",
  "ERR_NETWORK_CHANGED",
  "ERR_INTERNET_DISCONNECTED",
  "ERR_NAME_NOT_RESOLVED",
  "ERR_CONNECTION_RESET",
  "ERR_CONNECTION_CLOSED",
  "ERR_CONNECTION_TIMED_OUT",
  "ERR_CONNECTION_FAILED",
  "ERR_ADDRESS_UNREACHABLE",
  "ERR_SOCKET_NOT_CONNECTED",
];

/** Wartezeiten zwischen den Versuchen — grosszuegig, weil das Netz nach dem
 *  Aufwachen ein paar Sekunden braucht, bis DNS wieder antwortet. */
const NAV_RETRY_DELAYS_MS = [3_000, 10_000, 30_000];

/** goto with domcontentloaded; continues if the page is partially loaded after
 *  timeout, and retries transient network failures (standby, WLAN change). */
export async function gotoTutor24(
  page: import("playwright").Page,
  url: string,
  pushLog?: (s: string) => void
): Promise<void> {
  for (let versuch = 0; ; versuch++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      if (versuch > 0) pushLog?.(`${ts()} ✓ Netz wieder da — ${url} geladen`);
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const current = page.url();
      if (msg.includes("Timeout") && !current.includes("about:blank")) {
        pushLog?.(`${ts()} ⚠ Langsames Laden (${current}) — fahre fort`);
        return;
      }
      const retryable = RETRYABLE_NET_ERRORS.find((code) => msg.includes(code));
      const delay = NAV_RETRY_DELAYS_MS[versuch];
      if (!retryable || delay === undefined) throw err;
      pushLog?.(
        `${ts()} ⚠ Netzfehler ${retryable} — neuer Versuch in ${delay / 1000}s ` +
          `(${versuch + 1}/${NAV_RETRY_DELAYS_MS.length})`
      );
      await sleep(delay);
    }
  }
  await sleep(400);
  // Gemeinsame Stelle fuer alle Automationen: jede tutor24-Seite laeuft hier durch.
  await closeCookieBanner(page, pushLog);
}

async function isLoggedInToTutor24(page: import("playwright").Page): Promise<boolean> {
  const url = page.url();

  if (url.includes("sign_in")) {
    const loginForm = page.locator("#login-form, form.js-new-user-form").first();
    if (await loginForm.isVisible().catch(() => false)) return false;
  }

  // tutor24 redirects here after login; sign-out is often inside a closed user menu
  if (/\/dashboard(?:\/|$|\?|#)/.test(url)) return true;

  const signOut = await findVisible(
    page,
    'a[href*="sign_out"], a[href*="logout"], form[action*="sign_out"], button:has-text("Abmelden")'
  );
  if (signOut) return true;

  const loggedInNav = await findVisible(
    page,
    'a:has-text("Mein Profil"), a[href*="profil-besuche"], a[href*="/conversations"], a[href*="/messages"]'
  );
  if (loggedInNav) return true;

  const signIn = await findVisible(page, 'a[href*="sign_in"]');
  if (signIn) return false;

  const loginFormVisible = await page
    .locator("#login-form, form.js-new-user-form")
    .first()
    .isVisible()
    .catch(() => false);
  if (loginFormVisible) return false;

  return false;
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
    if (/\/dashboard(?:\/|$|\?|#)/.test(url)) return "ok";
    if (await isLoggedInToTutor24(page)) return "ok";
    await sleep(400);
  }
  if (await isLoggedInToTutor24(page)) return "ok";
  const url = page.url();
  if (/two_factor|verification|confirm|challenge|captcha/i.test(url)) return "challenge";
  return "still_on_sign_in";
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
    return { allowed: true, reason: "Stundenlohn verhandelbar" };
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

// Nur Funktionswoerter und typische Satzteile: Fachwoerter wie "Math", "Tutor", "Coach", "online"
// stehen auch in deutschen Inseraten und zaehlen nicht. Italienisch und Spanisch werden mitgezaehlt,
// damit "la", "le", "per" … sie nicht zu Franzoesisch machen — unterstuetzt sind sie nicht (→ Deutsch).
const LANG_WORDS: Record<"de" | "en" | "fr" | "it" | "es", string[]> = {
  de: [
    "der", "die", "das", "und", "ich", "wir", "mein", "meine", "meinen", "unser", "unsere", "unseren", "sucht", "suche", "suchen", "gesucht",
    "für", "mit", "nachhilfe", "schüler", "schülerin", "klasse", "ist", "sind", "bei", "auf", "zu", "im", "ein", "eine", "einen", "prüfung",
    "wird", "unterricht", "sohn", "tochter", "kind", "brauchen", "braucht", "bitte", "oder", "nicht",
  ],
  en: [
    "the", "and", "for", "with", "you", "your", "my", "our", "we", "is", "are", "i am", "i'm", "looking for", "need", "needs", "would", "could",
    "son", "daughter", "child", "lessons", "improve", "grades", "year old", "who", "this", "that", "to", "of", "in the", "help with",
  ],
  fr: [
    "le", "les", "des", "du", "nous", "notre", "nos", "cherche", "cherchons", "recherche", "recherché", "recherchés", "élève", "cours",
    "pour", "avec", "est", "une", "et", "enfant", "fils", "fille", "mathématiques", "particuliers", "besoin", "aide", "sont", "dans",
  ],
  it: [
    "il", "di", "per", "che", "della", "delle", "dello", "gli", "sono", "nostro", "nostra", "figlio", "figlia", "scuola", "ripetizioni",
    "lezioni", "cercate", "cerchiamo", "cercasi", "studente", "matematica", "tedesco", "casa", "alla", "piacerebbe", "trovare", "viviamo",
  ],
  es: ["el", "los", "las", "para", "con", "que", "clases", "busco", "buscamos", "hijo", "hija", "estudiante", "matemáticas", "profesor", "ayuda"],
};
const LANG_RE = Object.fromEntries(
  Object.entries(LANG_WORDS).map(([k, ws]) => [k, new RegExp(`(?<!\\p{L})(?:${ws.join("|")})(?!\\p{L})`, "gu")])
) as Record<keyof typeof LANG_WORDS, RegExp>;

export function scoreTextLanguage(text: string): Record<keyof typeof LANG_WORDS, number> {
  const s = text.toLowerCase().replace(/[’`]/g, "'");
  return Object.fromEntries(Object.entries(LANG_RE).map(([k, re]) => [k, (s.match(re) ?? []).length])) as Record<keyof typeof LANG_WORDS, number>;
}

/** Englisch/Franzoesisch nur bei klarem Signal (mind. 4 typische Woerter, doppelt so viele wie jede andere Sprache). */
const MIN_SIGNAL = 4;

/**
 * Sprache des Inserats: de, en oder fr. Im Zweifel und bei anderen Sprachen (Italienisch, Spanisch …) Deutsch.
 * null nur ohne Text (dann entscheiden URL bzw. HTML).
 */
export function detectLanguageFromText(listingTitle: string, bodyText: string): ListingProfile["language"] | null {
  const body = isSiteBoilerplate(bodyText) ? "" : bodyText.trim();
  const combined = `${listingTitle.trim()} ${body}`.trim();
  if (!combined) return null;
  const scores = scoreTextLanguage(combined);
  for (const lang of ["en", "fr"] as const) {
    const others = Math.max(...Object.entries(scores).filter(([k]) => k !== lang).map(([, n]) => n));
    if (scores[lang] >= MIN_SIGNAL && scores[lang] >= 2 * others) return lang;
  }
  return "de";
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
  'form:has(textarea[name="message[content]"]) button[type="submit"], ' +
  'form:has(textarea[name="message[content]"]) input[type="submit"], ' +
  'form:has(textarea.js-message-form-input) button[type="submit"], ' +
  'form:has(textarea.js-message-form-input) input[type="submit"], ' +
  'button:has-text("Nachricht senden"), input[type="submit"], button[type="submit"], ' +
  'button:has-text("Senden"), button:has-text("Absenden"), button:has-text("Schicken")';

const SEND_SUCCESS_SEL =
  '[class*="success"], [class*="alert-success"], [class*="notice--success"], ' +
  'div:has-text("Nachricht gesendet"), div:has-text("erfolgreich gesendet"), ' +
  'div:has-text("Danke"), p:has-text("Nachricht gesendet")';

/** Cookie-Fenster (Cookiebot auf tutor24, OneTrust als Rueckfall). */
export const COOKIE_DIALOG_SEL = "#CybotCookiebotDialog, #onetrust-banner-sdk";

/**
 * Knoepfe in der Reihenfolge der wenigsten Cookies: ablehnen / nur notwendige zuerst.
 * "Auswahl erlauben" zuletzt: dort sind nur die notwendigen Cookies vorausgewaehlt. Nie "Alle akzeptieren".
 */
export const COOKIE_DECLINE_SEL = [
  "#CybotCookiebotDialogBodyButtonDecline",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll",
  "#onetrust-reject-all-handler",
  'button:has-text("Nur notwendige")',
  'button:has-text("Nur erforderliche")',
  'button:has-text("Alle ablehnen")',
  'button:has-text("Ablehnen")',
  'button:has-text("Reject all")',
  'button:has-text("Only necessary")',
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowallSelection",
];

export class CookieBannerError extends Error {}
export const COOKIE_BANNER_MESSAGE = "Das Cookie-Fenster von tutor24 liess sich nicht schliessen. Es wurde nichts gesendet.";

/**
 * Gemeinsam fuer alle tutor24-Automationen (Kandidaten suchen, Erst-Nachricht, Kursangebot, Antworten pruefen):
 * ein offenes Cookie-Fenster mit der Option mit den wenigsten Cookies schliessen. Vor jedem Klick aufrufen —
 * Cookiebot erscheint oft erst Sekunden nach dem Laden und verdeckt dann den Senden-Knopf.
 * Bleibt das Fenster offen: CookieBannerError (der Aufrufer bricht ab, es wird nichts gesendet).
 */
export async function closeCookieBanner(
  page: import("playwright").Page,
  pushLog?: (s: string) => void
): Promise<"keins" | "geschlossen"> {
  const dialog = page.locator(COOKIE_DIALOG_SEL).first();
  const open = () => dialog.isVisible().catch(() => false);
  if (!(await open())) return "keins";
  for (const sel of COOKIE_DECLINE_SEL) {
    const btn = page.locator(sel).first();
    if (!(await btn.isVisible().catch(() => false))) continue;
    // force: der Knopf liegt im Fenster selbst; ein Overlay darueber soll den Klick nicht abfangen.
    await btn.click({ force: true, timeout: 5_000 }).catch(() => {});
    break;
  }
  if (await dialog.waitFor({ state: "hidden", timeout: 4_000 }).then(() => true, () => false)) {
    pushLog?.(`${ts()} Cookie-Fenster geschlossen (nur notwendige Cookies)`);
    return "geschlossen";
  }
  // Rueckfall: Cookiebot-Schnittstelle der Seite ("ablehnen").
  await page
    .evaluate(() => {
      const cb = (window as unknown as { Cookiebot?: { decline?: () => void } }).Cookiebot;
      if (cb && typeof cb.decline === "function") cb.decline();
    })
    .catch(() => {});
  if (await dialog.waitFor({ state: "hidden", timeout: 3_000 }).then(() => true, () => false)) {
    pushLog?.(`${ts()} Cookie-Fenster geschlossen (abgelehnt)`);
    return "geschlossen";
  }
  throw new CookieBannerError(COOKIE_BANNER_MESSAGE);
}

/** Alter Name, alle Aufrufer: schliesst das Cookie-Fenster mit "nur notwendige" (nicht mehr "alle akzeptieren"). */
export const acceptTutor24Cookies = closeCookieBanner;

function isExcludedContactLink(href: string | null): boolean {
  if (!href) return false;
  return (
    href.includes("/conversations") ||
    href.includes("feedback_message") ||
    href.includes("inappropriate-messages")
  );
}

function isExistingConversationButton(
  href: string | null,
  text: string
): boolean {
  if (/konversation öffnen|gespräch öffnen/i.test(text)) return true;
  return isExcludedContactLink(href);
}

/** tutor24 provider/job pages use .js-btn-send-message (not always /messages/new). */
export async function findContactButton(page: import("playwright").Page) {
  const primaryCandidates = await page.$$("a.js-btn-send-message, button.js-btn-send-message");
  for (const el of primaryCandidates) {
    if (!(await el.isVisible())) continue;
    const href = await el.getAttribute("href");
    const text = (await el.evaluate((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim())) || "";
    if (isExistingConversationButton(href, text)) continue;
    return el;
  }

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

export async function waitForMessageTextarea(
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

/**
 * Absaetze fuer tutor24: zwischen zwei Absaetzen eine Zeile mit einem geschuetzten Leerzeichen statt einer leeren Zeile.
 * So bleibt die Leerzeile sichtbar, auch wenn tutor24 leere Zeilen zusammenzieht (Luanas alte Nachricht, 9.11.).
 * Gespeichert (Tutor24Message) und geprueft wird immer der Text ohne diese Umwandlung.
 */
export const forTutor24 = (text: string) => text.trim().replace(/\n{2,}/g, "\n\u00A0\n");

async function fillMessageTextarea(
  page: import("playwright").Page,
  textarea: import("playwright").ElementHandle,
  message: string,
  pushLog: (s: string) => void,
  tutor24Id: string
): Promise<void> {
  const typed = forTutor24(message);
  await textarea.click();
  await textarea.fill("");
  await textarea.fill(typed);
  await textarea.evaluate((el, v) => {
    const t = el as HTMLTextAreaElement;
    t.value = v;
    t.dispatchEvent(new Event("input", { bubbles: true }));
    t.dispatchEvent(new Event("change", { bubbles: true }));
  }, typed);
  // Nie einen halben Text senden (frueher: nach 500 Zeichen abgeschnitten nachgetippt).
  const value = await textarea.evaluate((el) => (el as HTMLTextAreaElement).value);
  if (value.trim() !== typed) {
    pushLog(`${ts()} [${tutor24Id}] ⚠ Text nicht vollständig im Feld (${value.length} von ${typed.length} Zeichen) — nicht gesendet`);
    await textarea.fill("").catch(() => {});
    throw new Error(`Text liess sich nicht vollständig eintragen (${tutor24Id}) — nicht gesendet`);
  }
  void page;
}

async function scrollToSendMessageAnchor(page: import("playwright").Page): Promise<void> {
  await page.evaluate(() => {
    const anchor = document.getElementById("send_message");
    if (anchor) anchor.scrollIntoView({ block: "center", behavior: "instant" });
  });
  await sleep(500);
}

async function messageSendSucceeded(
  page: import("playwright").Page,
  preSendUrl: string
): Promise<boolean> {
  const postSendUrl = page.url();
  if (postSendUrl !== preSendUrl) return true;
  if (await findVisible(page, SEND_SUCCESS_SEL)) return true;
  if (await findVisible(page, EXISTING_CONVO_SEL)) return true;
  if (!(await hasMessageTextarea(page))) return true;
  const ta = await waitForMessageTextarea(page, 1000);
  if (!ta) return true;
  const len = await ta.evaluate((el) => (el as HTMLTextAreaElement).value.trim().length);
  return len === 0;
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

    if (currentNorm === targetNorm && msgUrl.includes("#send_message")) {
      await scrollToSendMessageAnchor(page);
      const ta = await waitForMessageTextarea(page, 6000);
      if (ta) return true;
    }

    if (currentNorm === targetNorm && page.url().includes("#send_message")) {
      await scrollToSendMessageAnchor(page);
      const ta = await waitForMessageTextarea(page, 4000);
      if (ta) return true;
    }

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
  msgBtn: import("playwright").ElementHandle,
  /** Vom Aufrufer gelesen, solange das Handle noch zur aktuellen Seite gehört. */
  btnHref: string | null,
  pushLog?: (s: string) => void
): Promise<void> {
  await msgBtn.evaluate((node) => {
    (node as HTMLElement).scrollIntoView({ block: "center", behavior: "instant" });
  });
  await sleep(400);

  try {
    await msgBtn.click({ timeout: 8000 });
  } catch {
    pushLog?.(`${ts()} ⚠ Klick fehlgeschlagen — versuche JS-Klick`);
    await jsClick(msgBtn);
  }
  await sleep(2000);

  if (await hasMessageTextarea(page)) return;

  if (page.url().includes("#send_message")) {
    await scrollToSendMessageAnchor(page);
    await sleep(800);
    if (await hasMessageTextarea(page)) return;
  }

  const isHashOrEmpty = !btnHref || btnHref.startsWith("#") || btnHref === "";
  if (!isHashOrEmpty && !btnHref.startsWith("javascript:")) {
    const dest = btnHref.startsWith("http") ? btnHref : `${TUTOR24_BASE_URL}${btnHref}`;
    pushLog?.(`${ts()} Öffne Kontakt-URL: ${dest}`);
    await gotoTutor24(page, dest, pushLog);
    await acceptTutor24Cookies(page, pushLog);
    await sleep(1500);
    if (page.url().includes("#send_message")) {
      await scrollToSendMessageAnchor(page);
    }
    if (await waitForMessageTextarea(page, 8000)) return;
  }
}

/** Wait until job listing is interactive (login required for «Ich bin interessiert»). */
export async function waitForJobListingReady(
  page: import("playwright").Page,
  tutor24Id: string,
  pushLog: (s: string) => void
): Promise<void> {
  await acceptTutor24Cookies(page, pushLog);

  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (page.url().includes("sign_in")) {
      throw new Error(
        `[${tutor24Id}] Nicht angemeldet — tutor24 zeigt die Login-Seite. Bitte Automation neu starten.`
      );
    }
    if (await findVisible(page, EXISTING_CONVO_SEL)) return;
    if (await findContactButton(page)) return;
    await sleep(400);
  }

  pushLog(`${ts()} [${tutor24Id}] ⚠ Job-Seite langsam (${page.url()}) — versuche trotzdem`);
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
    pushLog(`${ts()} ⚠ Login-Status unklar — URL: ${page.url()}`);
    const err = await readLoginError(page);
    throw new Error(
      err
        ? `Login fehlgeschlagen: ${err}`
        : `Login nicht erkannt (URL: ${page.url()}) — Passwort prüfen oder tutor24 manuell testen.`
    );
  }

  if (!(await isLoggedInToTutor24(page))) {
    throw new Error(
      `Login nicht bestätigt (URL: ${page.url()}) — TUTOR24_EMAIL / TUTOR24_PASSWORD prüfen.`
    );
  }

  pushLog(`${ts()} Login erfolgreich — ${page.url()}`);
}

/** Wait until numeric listing cards appear (not nav links like /jobs/search). */
export async function waitForListingCards(
  page: import("playwright").Page,
  pathSegment: "jobs" | "providers"
): Promise<boolean> {
  const pattern =
    pathSegment === "jobs"
      ? "^\\/(de|en|fr)\\/(students|requests|jobs|gesuche)\\/\\d+"
      : "^\\/(de|en|fr)\\/(providers|tutors|teachers|nachhilfelehrer|private-teacher)\\/\\d+";

  try {
    await page.waitForFunction(
      (reSource) => {
        const re = new RegExp(reSource);
        return Array.from(document.querySelectorAll("a[href]")).some((a) => {
          try {
            return re.test(new URL(a.getAttribute("href") ?? "", window.location.origin).pathname);
          } catch {
            return false;
          }
        });
      },
      pattern,
      { timeout: 25_000 }
    );
    return true;
  } catch {
    return false;
  }
}

export async function collectListingLinks(
  page: import("playwright").Page,
  pathSegment: "jobs" | "providers",
  pushLog?: (s: string) => void
): Promise<{ href: string; id: string }[]> {
  await acceptTutor24Cookies(page, pushLog);
  const ready = await waitForListingCards(page, pathSegment);
  if (!ready) {
    pushLog?.(`${ts()} ⚠ Warte auf Suchergebnisse — versuche trotzdem (${page.url()})`);
  }
  await sleep(600);

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
      let pathname = a.pathname;
      try {
        pathname = new URL(a.href, window.location.origin).pathname;
      } catch {
        /* keep pathname */
      }
      const m = pathname.match(re);
      if (!m) continue;
      const id = m[3];
      if (seen.has(id)) continue;
      seen.add(id);
      const href = a.href.split("?")[0];
      links.push({ href, id });
    }
    return links;
  }, segments);
}

/** True when current URL is already the same search filter (ignoring page=). */
export function isSameSearchResultsPage(currentUrl: string, targetUrl: string): boolean {
  try {
    const current = new URL(currentUrl);
    const target = new URL(targetUrl);
    if (current.pathname !== target.pathname) return false;
    const c = new URLSearchParams(current.search);
    const t = new URLSearchParams(target.search);
    c.delete("page");
    t.delete("page");
    return c.toString() === t.toString();
  } catch {
    return false;
  }
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

  if (page.url().includes("sign_in")) {
    pushLog(`${ts()} [${tutor24Id}] ⚠ Login-Seite statt Job — übersprungen`);
    return "skipped_no_button";
  }

  const msgBtn = await findContactButton(page);
  if (!msgBtn) {
    const onLogin = page.url().includes("sign_in") || (await page.locator("#login-form").isVisible().catch(() => false));
    pushLog(
      `${ts()} [${tutor24Id}] kein Kontakt-Button (${page.url()})` +
        (onLogin ? " — nicht angemeldet" : " — evtl. Seite nicht geladen")
    );
    return "skipped_no_button";
  }

  const btnText = (await msgBtn.evaluate((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())) || "";
  const btnHref = await msgBtn.getAttribute("href");
  if (isExistingConversationButton(btnHref, btnText)) {
    pushLog(`${ts()} [${tutor24Id}] bestehende Konversation — übersprungen`);
    return "skipped_no_button";
  }

  pushLog(`${ts()} [${tutor24Id}] Kontakt-Button «${btnText.slice(0, 40)}» href=${btnHref ?? "(click)"}`);

  let navigated = false;
  if (btnHref?.includes("/messages/new")) {
    const dest = btnHref.startsWith("http") ? btnHref : `${TUTOR24_BASE_URL}${btnHref}`;
    await gotoTutor24(page, dest, pushLog);
    await acceptTutor24Cookies(page, pushLog);
    await sleep(1200);
    navigated = true;
  }

  if (!(await hasMessageTextarea(page))) {
    // Nach der Navigation gehört msgBtn zur zerstörten Seite — jeder Zugriff darauf wirft
    // "Execution context was destroyed". Button auf der neuen Seite frisch suchen; findet
    // sich keiner, übernimmt openMessageForm() weiter unten per URL.
    const freshBtn = navigated ? await findContactButton(page) : msgBtn;
    if (freshBtn) await clickContactButton(page, freshBtn, btnHref, pushLog);
  }
  await acceptTutor24Cookies(page, pushLog);
  await sleep(1000);

  let textarea = await waitForMessageTextarea(page, 12000);
  if (!textarea) {
    const profileUrl = listingHref ?? page.url();
    const formReady = await openMessageForm(page, profileUrl, tutor24Id, pushLog, btnHref);
    textarea = formReady ? await waitForMessageTextarea(page, 8000) : null;
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

  await fillMessageTextarea(page, textarea, message, pushLog, tutor24Id);
  await sleep(600);

  const submitBtn =
    (await findVisible(
      page,
      'form:has(textarea[name="message[content]"]) button[type="submit"], form:has(textarea[name="message[content]"]) input[type="submit"]'
    )) ?? (await findVisible(page, SUBMIT_SEL));
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
  await sleep(3000);

  if (!(await messageSendSucceeded(page, preSendUrl))) {
    pushLog(`${ts()} [${tutor24Id}] ⚠ Kein Erfolgsindikator nach Absenden (URL: ${page.url()})`);
    return "error_unconfirmed";
  }

  pushLog(`${ts()} ✓ Gesendet an ${displayName} (ID ${tutor24Id})`);
  return "sent";
}
