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
  firstName: string;
  language: "de" | "en" | "fr";
  level: string;
  subject: string;
  bodyText: string;
};

const BASE_URL = "https://www.tutor24.ch";
const SEARCH_BASE = `${BASE_URL}/de/students/search`;

function searchUrl(subject: string, pageNum: number) {
  const q = encodeURIComponent(subject);
  return `${SEARCH_BASE}?q%5Bsubject_cont%5D=${q}&page=${pageNum}`;
}

const MESSAGE_TEMPLATE = `Hallo zusammen,

gerne unterstütze ich dich in Mathematik und der Physik, entweder online oder in Zürich, auf Deutsch oder Englisch. Ich unterrichte seit über 12 Jahren, habe an der ETH studiert und begleite aktuell mehr als 30 aktive Schüler, die meisten auf Gymi- oder Universitätsniveau. Entsprechend gut kenne ich die Anforderungen, typischen Fehler und relevanten Themen über alle Stufen hinweg.

Für meinen Unterricht habe ich eigene Lehrmittel für die Gymivorbereitung, BM-Vorbereitung sowie verschiedene Gymi- und BM-Stufen entwickelt. Zusätzlich habe ich die Lernplattform Mathetogo programmiert (www.platform.mathetogo.xyz). Dort arbeitest du mit klar strukturierten Inhalten, löst gezielte Aufgaben, hältst deinen Lösungsweg fest und erhältst persönliches Feedback. Ergänzende Quizzes helfen dir, deinen Lernstand realistisch einzuschätzen und gezielt Fortschritte zu machen.

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

const SYSTEM_PROMPT = `Du bist Omid, ein Mathematik- und Physiklehrer in der Schweiz mit über 12 Jahren Unterrichtserfahrung. Du hast an der ETH Zürich studiert und begleitest aktuell mehr als 30 aktive Schüler auf allen Niveaus. Du hast eigene Lehrmittel für Gymiprüfung, BM-Vorbereitung und verschiedene Stufen entwickelt sowie die Lernplattform Mathetogo (www.platform.mathetogo.xyz) programmiert.

Schreibe eine persönliche Kontaktnachricht auf tutor24.ch an einen Schüler, der nach Nachhilfe sucht.

Regeln:
- Schreibe in der Sprache des Schülers (Deutsch oder Englisch — erkennbar am Inseratstext)
- Sprich den Schüler mit dem Vornamen an (kein "Hallo zusammen")
- Passe den Inhalt dem erkannten Niveau an:
    Matura → "ich habe viele Schüler durch die Maturavorbereitung geführt und kenne die Prüfungsanforderungen genau"
    Gymnasium/Gymiprüfung → "ich habe viele Schüler erfolgreich durch die Gymiprüfung begleitet"
    Universität/ETH → "als ETH-Absolvent kenne ich die universitären Anforderungen aus eigener Erfahrung"
    BM/BMS → "ich habe eigene Lehrmittel für die BM-Vorbereitung entwickelt"
    Sekundar/Primar → "ich erkläre den Stoff stufengerecht und mit viel Geduld"
- Erwähne die Lernplattform Mathetogo kurz
- Maximal 220 Wörter
- Schliesse immer mit: WhatsApp 078 693 68 98 | www.mathetogo.xyz | dann "Liebi Grüess, Omid" (DE) oder "Kind regards, Omid" (EN)
- Schreibe NUR die Nachricht, keine Metakommentare davor oder danach`;

function buildUserPrompt(p: StudentProfile): string {
  return [
    `Vorname des Schülers: ${p.firstName}`,
    `Gesuchtes Fach: ${p.subject}`,
    `Sprache des Inserats: ${p.language === "en" ? "Englisch" : p.language === "fr" ? "Französisch" : "Deutsch"}`,
    p.level ? `Erkanntes Niveau: ${p.level}` : "Niveau: nicht erkannt",
    "",
    "Inseratstext (Kontext für die Nachricht):",
    p.bodyText,
  ].join("\n");
}

async function extractProfile(
  page: import("playwright").Page,
  displayName: string,
  subject: string
): Promise<StudentProfile> {
  const firstName = displayName.split(/\s+/)[0];
  return page.evaluate(
    ({ name, firstName, subject }) => {
      const main =
        (document.querySelector("main, [role='main'], article, .container") as HTMLElement) ||
        document.body;
      const rawText = (main.textContent ?? "").replace(/\s+/g, " ").trim();
      const bodyText = rawText.slice(0, 700);

      const langAttr = (document.documentElement.lang ?? "de").toLowerCase();
      const language: "de" | "en" | "fr" = langAttr.startsWith("en")
        ? "en"
        : langAttr.startsWith("fr")
        ? "fr"
        : "de";

      const t = rawText.toLowerCase();
      let level = "";
      if (t.includes("maturaprüf") || t.includes("maturavorbereitung") || t.includes("matura"))
        level = "Maturavorbereitung";
      else if (t.includes("eth") || t.includes("universität") || t.includes("hochschule"))
        level = "Universität/ETH";
      else if (t.includes("gymnasium") || t.includes("kantonsschule") || t.includes("gymi"))
        level = "Gymnasium";
      else if (t.includes("berufsmatura") || t.includes("bms") || t.includes("bm-") || t.includes("berufsschule"))
        level = "BM/BMS";
      else if (t.includes("sekundar") || t.includes("oberstufe"))
        level = "Sekundarschule";
      else if (t.includes("primar"))
        level = "Primarschule";

      return { name, firstName, language, level, subject, bodyText };
    },
    { name: displayName, firstName, subject }
  );
}

async function generateMessage(
  profile: StudentProfile,
  pushLog: (s: string) => void
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    pushLog("ℹ OpenAI-Key fehlt — Template wird verwendet");
    return MESSAGE_TEMPLATE;
  }
  try {
    // Dynamic import so Next.js build doesn't include openai in edge bundles
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 500,
      temperature: 0.75,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(profile) },
      ],
    });
    const message = resp.choices[0]?.message?.content?.trim();
    if (!message) throw new Error("Leere Antwort von OpenAI");
    return message;
  } catch (err) {
    pushLog(`⚠ OpenAI-Fehler (Template-Fallback): ${err instanceof Error ? err.message : String(err)}`);
    return MESSAGE_TEMPLATE;
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
      page.waitForNavigation({ waitUntil: "networkidle", timeout: 20000 }),
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
      await page.goto(SEARCH_BASE, { waitUntil: "networkidle", timeout: 20000 });
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

      // Submit form and capture the URL tutor24 redirects to
      const submitBtn = await findVisible(page, 'button[type="submit"], input[type="submit"], button:has-text("Suchen"), button:has-text("Search")');
      if (submitBtn) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "networkidle", timeout: 20000 }).catch(() => {}),
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

        await page.goto(listingUrl, { waitUntil: "networkidle", timeout: 20000 });
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

          await page.goto(href, { waitUntil: "networkidle", timeout: 20000 });
          await sleep(800);

          const pageTitle = await page.title();
          const displayName = pageTitle.split(/[-–|]/)[0].trim() || tutor24Id;

          // Debug: visible buttons on profile page
          const debugBtns = await page.evaluate(() =>
            Array.from(document.querySelectorAll("a, button"))
              .filter((el) => (el as HTMLElement).offsetParent !== null)
              .map((el) => (el as HTMLElement).innerText?.trim().slice(0, 40))
              .filter((t) => t && t.length > 1)
              .slice(0, 20)
          );
          result.log.push(`${ts()} [${tutor24Id}] ${displayName} — Buttons: ${debugBtns.map((t) => `"${t}"`).join(", ")}`);

          // If tutor24 shows "Konversation öffnen", a conversation already exists —
          // skip cleanly rather than trying to send another message.
          const existingConvo = await findVisible(
            page,
            'a:has-text("Konversation öffnen"), button:has-text("Konversation öffnen"), ' +
            'a:has-text("Gespräch öffnen"), button:has-text("Gespräch öffnen")'
          );
          if (existingConvo) {
            result.log.push(`${ts()} [${tutor24Id}] ${displayName} — Konversation bereits vorhanden, übersprungen`);
            result.skipped++;
            continue;
          }

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
            await page.goto(dest, { waitUntil: "networkidle", timeout: 20000 });
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

          const profile = await extractProfile(page, displayName, subject);
          result.log.push(
            `${ts()} [${tutor24Id}] Profil: Niveau="${profile.level || "?"}", Sprache=${profile.language}`
          );
          const message = await generateMessage(profile, (s) => result.log.push(`${ts()} [${tutor24Id}] ${s}`));
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
