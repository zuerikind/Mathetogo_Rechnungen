import { prisma } from "./prisma";

export type Tutor24Result = {
  messaged: number;
  skipped: number;
  errors: string[];
  log: string[];
  newContacts: { name: string; tutor24Id: string; profileUrl: string }[];
};

type StudentProfile = {
  name: string;
  language: "de" | "en" | "fr";
  subject: string;
  bodyText: string;
  pageTitle: string;
};

const BASE_URL = "https://www.tutor24.ch";
const SEARCH_BASE = `${BASE_URL}/de/students/search`;

function searchUrl(subject: string, pageNum: number) {
  const q = encodeURIComponent(subject);
  return `${SEARCH_BASE}?q%5Bsubject_cont%5D=${q}&q%5Bradius%5D=100&page=${pageNum}`;
}

const MESSAGE_TEMPLATE = `Hallo zusammen,

gerne unterstütze ich dich in Mathematik und der Physik, entweder online oder in Zürich, auf Deutsch oder Englisch. Ich unterrichte seit über 12 Jahren, habe an der ETH studiert und begleite aktuell mehr als 30 aktive Schüler, die meisten auf Gymi- oder Universitätsniveau. Entsprechend gut kenne ich die Anforderungen, typischen Fehler und relevanten Themen über alle Stufen hinweg.

{{LEVEL_INSERT}}Für meinen Unterricht habe ich eigene Lehrmittel für die Gymivorbereitung, BM-Vorbereitung sowie verschiedene Gymi- und BM-Stufen entwickelt. Zusätzlich habe ich die Lernplattform Mathetogo programmiert (www.platform.mathetogo.xyz). Dort arbeitest du mit klar strukturierten Inhalten, löst gezielte Aufgaben, hältst deinen Lösungsweg fest und erhältst persönliches Feedback. Ergänzende Quizzes helfen dir, deinen Lernstand realistisch einzuschätzen und gezielt Fortschritte zu machen.

Online-Lektionen finden über Google Meet statt. Ich erkläre den Stoff verständlich und visuell mit dem iPad, und nach jeder Lektion erhältst du die bearbeiteten Unterlagen, damit du alles nochmals in Ruhe nachvollziehen kannst.

Mir ist wichtig, dass du nicht nur den aktuellen Stoff verstehst, sondern auch lernst, wie man Mathematik sinnvoll und nachhaltig angeht. Dabei unterstütze ich dich auch in Bezug auf Lernstrategie, Struktur und Motivation.

Wenn du deine Mathematikkenntnisse in einer ruhigen, unterstützenden Atmosphäre verbessern möchtest, melde dich gerne per WhatsApp für eine Terminvereinbarung (078 693 68 98).

Weitere Infos findest du hier: www.mathetogo.xyz

Liebi Grüess
Omid`;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function ts() {
  return new Date().toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Returns the first VISIBLE element matching selector, or null. Never throws. */
async function findVisible(page: import("playwright").Page, selector: string) {
  try {
    const all = await page.$$(selector);
    for (const el of all) {
      if (await el.isVisible()) return el;
    }
  } catch { /* ignore */ }
  return null;
}

/** Click using native JS — bypasses ALL Playwright visibility/stability checks. */
async function jsClick(el: import("playwright").ElementHandle) {
  await el.evaluate((node) => (node as HTMLElement).click());
}

// ── AI message personalisation ─────────────────────────────────────────────

type ExtractedProfile = Omit<StudentProfile, "language"> & { htmlLang: StudentProfile["language"] };

async function extractProfile(
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

const FALLBACK_PARAGRAPH =
  "Gerne helfe ich dir dabei, den Stoff strukturiert zu erarbeiten und gezielt die relevanten Themen zu festigen.";

const LANG_LABEL: Record<StudentProfile["language"], string> = {
  de: "Deutsch",
  en: "English",
  fr: "French",
};

/** Only /en/ and /fr/ paths imply listing language — /de/ is the default site locale. */
function localeFromPageUrl(pageUrl: string): StudentProfile["language"] | null {
  const m = pageUrl.match(/tutor24\.ch\/(en|fr)(?:\/|$)/i);
  if (!m) return null;
  return m[1].toLowerCase() as StudentProfile["language"];
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

function pickLanguage(scores: { de: number; en: number; fr: number }): StudentProfile["language"] | null {
  const { de, en, fr } = scores;
  const max = Math.max(de, en, fr);
  if (max < 2) return null;
  if (en === max && en >= de && en >= fr) return "en";
  if (fr === max && fr > de && fr >= en) return "fr";
  if (de === max) return "de";
  return null;
}

function detectLanguageFromText(listingTitle: string, bodyText: string): StudentProfile["language"] | null {
  const title = listingTitle.trim();
  const body = isSiteBoilerplate(bodyText) ? "" : bodyText.trim();

  const fromTitle = title ? pickLanguage(scoreTextLanguage(title)) : null;
  if (fromTitle) return fromTitle;

  const combined = `${title} ${body}`.trim();
  if (!combined) return null;
  return pickLanguage(scoreTextLanguage(combined));
}

function resolveTargetLanguage(
  pageUrl: string,
  htmlLang: StudentProfile["language"],
  listingTitle: string,
  bodyText: string
): { language: StudentProfile["language"]; source: string } {
  const fromText = detectLanguageFromText(listingTitle, bodyText);
  if (fromText) return { language: fromText, source: "Titel/Text" };

  const fromUrl = localeFromPageUrl(pageUrl);
  if (fromUrl) return { language: fromUrl, source: "URL" };

  return { language: htmlLang, source: "HTML" };
}

function profileContextForAi(profile: StudentProfile): string {
  const body = profile.bodyText.trim();
  const title = profile.pageTitle.trim();
  if (!body || isSiteBoilerplate(body)) return title;
  return `${title}\n${body}`;
}

const GERMAN_MESSAGE_MARKERS = [
  /^Hallo zusammen/m,
  /gerne unterstütze ich dich in Mathematik/i,
  /Liebi Grüess/i,
  /Für meinen Unterricht habe ich eigene Lehrmittel/i,
];

function stillLooksGerman(message: string): boolean {
  return GERMAN_MESSAGE_MARKERS.some((re) => re.test(message));
}

function parseMessageJson(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { message?: unknown };
    return typeof parsed.message === "string" ? parsed.message.trim() : null;
  } catch {
    const block = raw.match(/\{[\s\S]*\}/);
    if (!block) return null;
    try {
      const parsed = JSON.parse(block[0]) as { message?: unknown };
      return typeof parsed.message === "string" ? parsed.message.trim() : null;
    } catch {
      return null;
    }
  }
}

function buildFallbackMessage(): string {
  return MESSAGE_TEMPLATE.replace("{{LEVEL_INSERT}}", `${FALLBACK_PARAGRAPH}\n\n`);
}

async function translateFullMessage(
  client: import("openai").default,
  message: string,
  targetLang: "en" | "fr"
): Promise<string> {
  const targetLabel = LANG_LABEL[targetLang];
  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 2000,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content:
          `You translate tutoring outreach messages into ${targetLabel}. ` +
          `Preserve meaning, structure, facts, URLs, phone number 078 693 68 98, and tone. ` +
          `Output only the translated message — no preamble.`,
      },
      { role: "user", content: message },
    ],
  });
  return resp.choices[0]?.message?.content?.trim() ?? message;
}

// Personalised intro + full message (code picks language; model writes/translates in one call).
async function generateMessage(
  profile: StudentProfile,
  pushLog: (s: string) => void
): Promise<string> {
  const targetLang = profile.language;
  let message = buildFallbackMessage();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    if (targetLang !== "de") {
      pushLog("⚠ Kein OPENAI_API_KEY — Fallback bleibt Deutsch");
    }
    return message;
  }

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });
    const context = profileContextForAi(profile);
    const targetLabel = LANG_LABEL[targetLang];
    const languageRule =
      targetLang === "de"
        ? `Write the entire "message" in German (Swiss standard).`
        : `The listing is in ${targetLabel}. Write the entire "message" in ${targetLabel} only — do not leave any German sentences. ` +
          `The template below is German reference content: translate every part into ${targetLabel}, including greeting and sign-off.`;

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 2000,
      temperature: 0.5,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `You are Omid, a math and physics tutor in Switzerland (math and physics only).\n` +
            `You write complete tutor24.ch outreach messages.\n` +
            `Style: direct, professional, human. No marketing fluff, no em dashes.\n` +
            `TARGET LANGUAGE: ${targetLabel} (${targetLang}). ${languageRule}\n` +
            `Respond with JSON only: {"message":"<full outreach text>"}`,
        },
        {
          role: "user",
          content:
            `Listing title: "${profile.pageTitle}"\n` +
            `Description: ${context.slice(0, 400)}\n\n` +
            `Step 1 — personalised opening (1–2 sentences, max 40 words) for {{LEVEL_INSERT}}:\n` +
            `IF the listing mentions a concrete exam/school goal (Gymi, Matura, BM, Passerelle, university entrance, etc.):\n` +
            `→ Name that goal and one sentence on why Omid is a strong fit.\n` +
            `ELSE:\n` +
            `→ One sentence showing you read their need and how Omid can help specifically.\n` +
            `Do NOT mention: ETH, 12 years experience, 30+ students, own materials, Mathetogo platform, Google Meet, languages offered.\n` +
            `Do NOT: recap their situation, start with "I", mention location, other subjects.\n\n` +
            `Step 2 — insert opening into template, output full message in ${targetLabel}:\n` +
            MESSAGE_TEMPLATE,
        },
      ],
    });

    const raw = resp.choices[0]?.message?.content?.trim() ?? "";
    const parsed = parseMessageJson(raw);
    if (parsed) message = parsed;
    else if (raw && !raw.startsWith("{")) message = raw;
    else pushLog("⚠ JSON-Antwort ungültig — Fallback");

    if (targetLang !== "de" && stillLooksGerman(message)) {
      pushLog(`⚠ Nachricht noch auf Deutsch — Übersetzung nach ${targetLabel}`);
      message = await translateFullMessage(client, message, targetLang);
    }

    pushLog(`Zielsprache: ${targetLabel} | "${message.slice(0, 80)}..." | ${message.length} Zeichen`);
    return message;
  } catch (err) {
    pushLog(`⚠ OpenAI: ${err instanceof Error ? err.message : String(err)} — Fallback`);
    if (targetLang !== "de") {
      try {
        const { default: OpenAI } = await import("openai");
        const client = new OpenAI({ apiKey });
        return await translateFullMessage(client, message, targetLang);
      } catch {
        /* keep German fallback */
      }
    }
    return message;
  }
}

// In-memory job state (this process only — fine for single-user local app)
export const jobState: {
  running: boolean;
  shouldStop: boolean;
  result: Tutor24Result | null;
  startedAt: Date | null;
} = { running: false, shouldStop: false, result: null, startedAt: null };

export async function runTutor24Messaging(
  headless = false,
  maxPages = 10,
  subjects = ["Mathematik", "Physik"]
): Promise<Tutor24Result> {
  if (jobState.running) throw new Error("Automation is already running");

  const email = process.env.TUTOR24_EMAIL;
  const password = process.env.TUTOR24_PASSWORD;
  if (!email || !password) throw new Error("TUTOR24_EMAIL and TUTOR24_PASSWORD must be set in .env.local");

  jobState.running = true;
  jobState.startedAt = new Date();

  const result: Tutor24Result = { messaged: 0, skipped: 0, errors: [], log: [], newContacts: [] };
  // Set immediately so GET /api/tutor24 returns live log entries while running
  jobState.result = result;

  // Dynamic import so Next.js build doesn't choke on Playwright
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
    // ── Login ──────────────────────────────────────────────────────────────
    result.log.push(`${ts()} Logging in to tutor24.ch...`);
    await page.goto(`${BASE_URL}/de/sign_in`, { waitUntil: "domcontentloaded" });
    await page.fill('input[type="email"], input[name="user[email]"]', email);
    await page.fill('input[type="password"], input[name="user[password]"]', password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load", timeout: 20000 }),
      page.click('input[type="submit"], button[type="submit"]'),
    ]);

    const currentUrl = page.url();
    if (currentUrl.includes("sign_in")) {
      throw new Error("Login failed — check TUTOR24_EMAIL and TUTOR24_PASSWORD");
    }
    result.log.push(`${ts()} Login successful`);

    // ── Subject loop ───────────────────────────────────────────────────────
    for (const subject of subjects) {
      result.log.push(`${ts()} ════ Suche: ${subject} ════`);

      // Submit tutor24's own search form and capture the URL it redirects to.
      // This is the only reliable way to get the correctly-filtered URL — we cannot
      // safely construct it ourselves because tutor24 may use subject IDs, not text.
      await page.goto(SEARCH_BASE, { waitUntil: "load", timeout: 20000 });
      await sleep(1000);

      let subjectBaseUrl = searchUrl(subject, 1); // fallback if form submission fails

      // Try text input — use Playwright's native fill() which fires proper React/Vue events
      const INPUT_SEL = [
        'input[name*="subject"]', 'input[name*="fach"]',
        'input[placeholder*="Fach"]', 'input[placeholder*="fach"]',
        'input[id*="subject"]', 'input[id*="fach"]',
      ].join(", ");

      const inputEl = await findVisible(page, INPUT_SEL);
      let formFilled = false;

      if (inputEl) {
        await inputEl.fill(subject); // Playwright native — triggers React/Vue input events
        await sleep(700);
        // Click matching autocomplete suggestion if one appears
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
        // Try select/dropdown
        const SELECT_SEL = [
          'select[name*="subject"]', 'select[name*="fach"]',
          'select[id*="subject"]', 'select[id*="fach"]',
        ].join(", ");
        const matchedOpt = await page.evaluate(
          ([sel, subj]: [string, string]) => {
            const el = document.querySelector(sel) as HTMLSelectElement | null;
            if (!el) return null;
            const opt = Array.from(el.options).find(
              (o) => o.text.toLowerCase().includes(subj.toLowerCase()) || o.value.toLowerCase().includes(subj.toLowerCase())
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

      // Set radius slider to maximum (100km)
      const radiusSet = await page.evaluate(() => {
        const SLIDER_SEL = [
          'input[type="range"][name*="radius"]', 'input[type="range"][id*="radius"]',
          'input[type="range"][class*="radius"]', 'input[type="range"]',
        ].join(", ");
        const slider = document.querySelector(SLIDER_SEL) as HTMLInputElement | null;
        if (!slider) return false;
        const max = slider.max || "100";
        slider.value = max;
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        slider.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      });
      result.log.push(radiusSet ? `${ts()} Radius-Slider auf Maximum gesetzt` : `${ts()} Kein Radius-Slider gefunden`);

      // Submit form and capture the URL tutor24 redirects to
      const submitBtn = await findVisible(page, 'button[type="submit"], input[type="submit"], button:has-text("Suchen"), button:has-text("Search")');
      if (submitBtn) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "load", timeout: 20000 }).catch(() => {}),
          jsClick(submitBtn),
        ]);
        await sleep(500);
        const postSubmitUrl = page.url();
        if (postSubmitUrl !== SEARCH_BASE && postSubmitUrl.includes("/search")) {
          // Strip the page= param so we can add it cleanly per-page
          subjectBaseUrl = postSubmitUrl.replace(/([?&])page=\d+&?/, "$1").replace(/[?&]$/, "");
          result.log.push(`${ts()} ✓ Filter-URL: ${subjectBaseUrl}`);
        } else {
          result.log.push(`${ts()} ⚠ Submit führte zu keiner Filterseite (${postSubmitUrl}) — Fallback`);
        }
      } else {
        result.log.push(`${ts()} ⚠ Kein Submit-Button gefunden — Fallback auf URL-Parameter`);
      }

      // ── Page loop ────────────────────────────────────────────────────────
      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        result.log.push(`${ts()} ── ${subject} Seite ${pageNum}/${maxPages} ──`);

        // Build page URL: add/replace page= on the captured base URL
        const listingUrl = subjectBaseUrl.includes("page=")
          ? subjectBaseUrl.replace(/([?&])page=\d+/, `$1page=${pageNum}`)
          : subjectBaseUrl + (subjectBaseUrl.includes("?") ? "&" : "?") + `page=${pageNum}`;

        await page.goto(listingUrl, { waitUntil: "load", timeout: 20000 });
        await sleep(1200);

      // Collect student links — trust the server-side URL filter; no card text check
      const links = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];
        const seen = new Set<string>();
        const links: { href: string; id: string }[] = [];
        for (const a of anchors) {
          const m = a.pathname.match(/^\/(de|en|fr)\/(students|requests|jobs|gesuche)\/(\d+)/);
          if (!m) continue;
          const id = m[3];
          if (seen.has(id)) continue;
          seen.add(id);
          links.push({ href: a.href, id });
        }
        return links;
      });

      if (links.length === 0) {
        result.log.push(`${ts()} Seite ${pageNum}: keine passenden Gesuche — Ende`);
        break;
      }
      result.log.push(`${ts()} Seite ${pageNum}: ${links.length} Gesuche gefunden`);

      // Process each student directly — never navigate back to the listing page
      // so the subject filter is never lost.
      for (const { href, id: tutor24Id } of links) {
        if (jobState.shouldStop) {
          result.log.push(`${ts()} ⏹ Gestoppt durch Benutzer`);
          break;
        }
        try {
          const existing = await prisma.tutor24Contact.findUnique({ where: { tutor24Id } });
          if (existing) { result.skipped++; continue; }

          await page.goto(href, { waitUntil: "load", timeout: 20000 });
          await sleep(800);

          const listingTitle = await page.title();
          const displayName = listingTitle.split(/[-–|]/)[0].trim() || tutor24Id;
          const pageUrl = page.url();

          // Check for existing tutor24 conversation BEFORE the expensive profile/OpenAI step.
          const existingConvo = await findVisible(
            page,
            'a:has-text("Konversation öffnen"), button:has-text("Konversation öffnen"), ' +
            'a:has-text("Gespräch öffnen"), button:has-text("Gespräch öffnen")'
          );
          if (existingConvo) {
            result.log.push(`${ts()} [${tutor24Id}] Konversation bereits vorhanden — übersprungen`);
            result.skipped++;
            continue;
          }

          // Extract profile and generate personalised message while on the profile page.
          // Must happen before navigating to the contact form.
          const extracted = await extractProfile(page, displayName, subject, listingTitle);
          const { language, source } = resolveTargetLanguage(
            pageUrl,
            extracted.htmlLang,
            extracted.pageTitle,
            extracted.bodyText
          );
          const profile: StudentProfile = {
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
          const message = await generateMessage(profile, (s) => result.log.push(`${ts()} [${tutor24Id}] ${s}`));

          // Find visible contact button — exclude broad "message" href match to avoid
          // accidentally matching existing-conversation links.
          const BTN_SEL = [
            'a[href*="/messages/new"]', 'a[href*="messages/new"]', 'a[href*="contact"]',
            'button:has-text("Nachricht")', 'a:has-text("Nachricht senden")',
            'a:has-text("Nachricht schreiben")', 'a:has-text("Kontaktieren")',
            'a:has-text("Kontakt aufnehmen")', 'a:has-text("Bewerben")',
            'a:has-text("Auf Gesuch bewerben")', 'button:has-text("Bewerben")',
            ".message-btn", ".contact-btn",
          ].join(", ");

          const msgBtn = await findVisible(page, BTN_SEL);
          if (!msgBtn) {
            result.log.push(`${ts()} [${tutor24Id}] kein Kontakt-Button — übersprungen`);
            result.skipped++;
            continue; // next student, no page reload needed
          }

          const btnHref = await msgBtn.getAttribute("href");
          result.log.push(`${ts()} [${tutor24Id}] Kontakt-Button href=${btnHref ?? "(click)"}`);
          if (btnHref) {
            const dest = btnHref.startsWith("http") ? btnHref : `${BASE_URL}${btnHref}`;
            await page.goto(dest, { waitUntil: "load", timeout: 20000 });
          } else {
            await jsClick(msgBtn);
            await sleep(1500);
          }

          // Wait for textarea (modal may animate in)
          const textarea = await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 5000 }).catch(() => null);
          if (!textarea) {
            result.log.push(`${ts()} [${tutor24Id}] kein Textfeld — URL: ${page.url()}`);
            result.errors.push(`No textarea: ${tutor24Id} (${displayName})`);
            continue;
          }

          await textarea.fill(message);
          await sleep(600);

          // Find visible submit button
          const SUBMIT_SEL = 'input[type="submit"], button[type="submit"], button:has-text("Senden"), button:has-text("Absenden"), button:has-text("Schicken"), button:has-text("Nachricht senden")';
          const submitBtn = await findVisible(page, SUBMIT_SEL);

          const submitDebug = await Promise.all(
            (await page.$$(SUBMIT_SEL)).map(async (b) => {
              const txt = await b.evaluate((el) => (el as HTMLElement).innerText?.trim() || (el as HTMLInputElement).value || "");
              const vis = await b.isVisible();
              return `"${txt}"(${vis ? "✓" : "✗"})`;
            })
          );
          result.log.push(`${ts()} [${tutor24Id}] Submit-Buttons: ${submitDebug.join(", ") || "keine"}`);

          if (!submitBtn) {
            result.log.push(`${ts()} [${tutor24Id}] kein sichtbarer Absenden-Button`);
            result.errors.push(`No submit button: ${tutor24Id} (${displayName})`);
            continue;
          }

          result.log.push(`${ts()} [${tutor24Id}] Sende...`);
          const preSendUrl = page.url();
          await jsClick(submitBtn);
          await sleep(2500);

          // Verify send succeeded: URL must have changed (redirect after submit) OR
          // a visible success element must appear. Tutor24 always redirects to the
          // conversation/messages page on success.
          const postSendUrl = page.url();
          const urlChanged = postSendUrl !== preSendUrl;
          const successEl = await findVisible(
            page,
            '[class*="success"], [class*="alert-success"], [class*="notice--success"], ' +
            'div:has-text("Nachricht gesendet"), div:has-text("erfolgreich gesendet"), ' +
            'div:has-text("Danke"), p:has-text("Nachricht gesendet")'
          );
          const sendConfirmed = urlChanged || !!successEl;

          if (!sendConfirmed) {
            result.log.push(`${ts()} [${tutor24Id}] ⚠ Kein Erfolgsindikator nach Absenden — nicht gespeichert (URL: ${postSendUrl})`);
            result.errors.push(`Send unconfirmed: ${tutor24Id} (${displayName})`);
            continue;
          }

          await prisma.tutor24Contact.create({ data: { tutor24Id, name: displayName, profileUrl: href } });
          result.messaged++;
          result.newContacts.push({ name: displayName, tutor24Id, profileUrl: href });
          result.log.push(`${ts()} ✓ Gesendet an ${displayName} (ID ${tutor24Id})`);
          await sleep(1500);

        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`[${tutor24Id}] ${msg}`);
          result.log.push(`${ts()} [${tutor24Id}] Fehler: ${msg}`);
          // No page reload — outer loop simply moves to the next student URL
        }
        if (jobState.shouldStop) break; // propagate stop out of page loop
      }
      // ── end page loop ────────────────────────────────────────────────────
      if (jobState.shouldStop) break; // propagate stop — exit page loop
    }
    // ── end subject loop ─────────────────────────────────────────────────
    if (jobState.shouldStop) break; // propagate stop — skip remaining subjects
    }
  } finally {
    await browser.close();
    jobState.running = false;
    jobState.shouldStop = false;
    jobState.result = result;
  }

  return result;
}
