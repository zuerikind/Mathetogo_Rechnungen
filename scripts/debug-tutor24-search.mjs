/**
 * Debug tutor24 student search + login state.
 * Run: node scripts/debug-tutor24-search.mjs
 */
import { config } from "dotenv";
import { chromium } from "playwright";

config({ path: ".env.local" });

const email = process.env.TUTOR24_EMAIL;
const password = process.env.TUTOR24_PASSWORD;
if (!email || !password) {
  console.error("Set TUTOR24_EMAIL and TUTOR24_PASSWORD in .env.local");
  process.exit(1);
}

const SEARCH_URLS = [
  "https://www.tutor24.ch/de/students/search?q%5Bsubject_cont%5D=Mathematik&q%5Bradius%5D=100&page=1",
  "https://www.tutor24.ch/de/jobs/search?q%5Bdistance%5D=10&q%5Bplace%5D=8000+Z%C3%BCrich&q%5Bsubject_cont%5D=Mathematik",
  "https://www.tutor24.ch/de/students/search",
];

const linkRe = /^\/(de|en|fr)\/(students|requests|jobs|gesuche|providers)\/(\d+)/;

async function acceptCookies(page) {
  const btn = page
    .locator(
      'button:has-text("Alle akzeptieren"), button:has-text("Akzeptieren"), #CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll'
    )
    .first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click().catch(() => {});
    await page.waitForTimeout(800);
  }
}

async function fillLogin(page) {
  const emailField = page.locator("#user_login, input[name='user[login]']").first();
  await emailField.waitFor({ state: "visible", timeout: 15000 });
  await emailField.fill(email);
  await page.locator("#user_password, input[name='user[password]']").first().fill(password);
  await page.locator("#login-btn, #login-form input[type='submit']").first().click();
  await page.waitForTimeout(5000);
}

async function loginState(page) {
  const url = page.url();
  const signOut = await page
    .locator('a[href*="sign_out"], button:has-text("Abmelden")')
    .first()
    .isVisible()
    .catch(() => false);
  const signIn = await page
    .locator('a[href*="sign_in"]')
    .first()
    .isVisible()
    .catch(() => false);
  return { url, signOut, signIn };
}

async function dumpLinks(page, label) {
  await page.waitForTimeout(2000);
  const data = await page.evaluate((reSource) => {
    const re = new RegExp(reSource);
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const matches = [];
    const allHrefs = [];
    for (const a of anchors) {
      const p = a.pathname;
      if (re.test(p)) matches.push({ path: p, text: (a.textContent || "").trim().slice(0, 40) });
      if (/\/(jobs|students|providers)\//.test(p)) allHrefs.push(p);
    }
    return {
      title: document.title,
      h1: document.querySelector("h1")?.textContent?.trim() ?? "",
      matchCount: matches.length,
      matches: matches.slice(0, 8),
      samplePaths: [...new Set(allHrefs)].slice(0, 15),
      bodySnippet: document.body.innerText.slice(0, 400).replace(/\s+/g, " "),
    };
  }, linkRe.source);

  console.log(`\n=== ${label} ===`);
  console.log("URL:", page.url());
  console.log("Title:", data.title);
  console.log("H1:", data.h1);
  console.log("Regex matches:", data.matchCount);
  console.log("Samples:", data.matches);
  console.log("Other job/student paths:", data.samplePaths);
  console.log("Body:", data.bodySnippet);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
});
const page = await context.newPage();

console.log("1) Login...");
await page.goto("https://www.tutor24.ch/de/sign_in", { waitUntil: "domcontentloaded", timeout: 60000 });
await acceptCookies(page);
console.log("   Before login:", await loginState(page));
await fillLogin(page);
console.log("   After login:", await loginState(page));

for (const url of SEARCH_URLS) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await acceptCookies(page);
  await dumpLinks(page, url);
}

await browser.close();
console.log("\nDone.");
