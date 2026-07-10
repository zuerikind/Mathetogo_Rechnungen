/**
 * Quick end-to-end: login + collect links (mirrors fixed detection).
 */
import { config } from "dotenv";
import { chromium } from "playwright";

config({ path: ".env.local" });

const email = process.env.TUTOR24_EMAIL;
const password = process.env.TUTOR24_PASSWORD;

async function isLoggedIn(page) {
  const url = page.url();
  if (url.includes("sign_in")) {
    if (await page.locator("#login-form").first().isVisible().catch(() => false)) return false;
  }
  if (/\/dashboard(?:\/|$|\?|#)/.test(url)) return true;
  for (const sel of [
    'a[href*="sign_out"]',
    'a:has-text("Mein Profil")',
    'a[href*="/conversations"]',
  ]) {
    if (await page.locator(sel).first().isVisible().catch(() => false)) return true;
  }
  if (await page.locator('a[href*="sign_in"]').first().isVisible().catch(() => false)) return false;
  if (await page.locator("#login-form").first().isVisible().catch(() => false)) return false;
  return false;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("https://www.tutor24.ch/de/sign_in", { waitUntil: "domcontentloaded" });
const cookie = page.locator('button:has-text("Alle akzeptieren"), button:has-text("Akzeptieren")').first();
if (await cookie.isVisible().catch(() => false)) await cookie.click();

if (!(await isLoggedIn(page))) {
  await page.locator("#user_login").fill(email);
  await page.locator("#user_password").fill(password);
  await page.locator("#login-btn").click();
  for (let i = 0; i < 40; i++) {
    if (await isLoggedIn(page)) break;
    await page.waitForTimeout(500);
  }
}

console.log("loggedIn:", await isLoggedIn(page), "url:", page.url());

const searchUrl =
  "https://www.tutor24.ch/de/jobs/search?q%5Bplace%5D=8000%2C+Z%C3%BCrich&q%5Bsubject_cont%5D=Mathematik&page=1";
await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
await page.waitForSelector('a[href*="/jobs/"]', { timeout: 20000 }).catch(() => {});

const links = await page.evaluate(() => {
  const re = /^\/(de|en|fr)\/(students|requests|jobs|gesuche)\/(\d+)/;
  const seen = new Set();
  const out = [];
  for (const a of document.querySelectorAll("a[href]")) {
    const m = a.pathname.match(re);
    if (!m || seen.has(m[3])) continue;
    seen.add(m[3]);
    out.push({ id: m[3], href: a.href });
  }
  return out;
});

console.log("job links:", links.length, links.slice(0, 3));
await browser.close();
