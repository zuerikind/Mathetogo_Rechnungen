import { config } from "dotenv";
import { chromium } from "playwright";

config({ path: ".env.local" });

const email = process.env.TUTOR24_EMAIL;
const password = process.env.TUTOR24_PASSWORD;
const jobId = "5810540";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jsClick(el) {
  await el.evaluate((node) => (node).click());
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
});

await page.goto("https://www.tutor24.ch/de/sign_in", { waitUntil: "domcontentloaded" });
const c = page.locator('button:has-text("Akzeptieren"), button:has-text("Alle akzeptieren")').first();
if (await c.isVisible().catch(() => false)) await c.click();
if (await page.locator("#login-form").isVisible().catch(() => false)) {
  await page.locator("#user_login").fill(email);
  await page.locator("#user_password").fill(password);
  await page.locator("#login-btn").click();
  await sleep(5000);
}

await page.goto(`https://www.tutor24.ch/de/jobs/${jobId}`, { waitUntil: "domcontentloaded" });
await sleep(2000);

const handle = await page.$("a.js-btn-send-message");
const href = await handle?.getAttribute("href");
const text = await handle?.evaluate((el) => el.textContent?.trim());
console.log("btn:", text, href);

// mimic clickContactButton
await jsClick(handle);
await sleep(2000);
console.log("after jsClick:", page.url());

const ta1 = await page.$('textarea[name="message[content]"]');
console.log("textarea visible after click:", ta1 ? await ta1.isVisible() : false);

if (!ta1 || !(await ta1.isVisible())) {
  const dest = href.startsWith("http") ? href : `https://www.tutor24.ch${href}`;
  await page.goto(dest, { waitUntil: "domcontentloaded" });
  await sleep(2000);
  console.log("after goto:", page.url());
}

const ta2 = await page.waitForSelector('textarea[name="message[content]"]', { state: "visible", timeout: 10000 }).catch(() => null);
console.log("textarea found:", !!ta2);

if (ta2) {
  await ta2.fill("Test message automation debug - please ignore");
  const submit = await page.$('form:has(textarea[name="message[content]"]) button[type="submit"]');
  console.log("submit found:", !!submit);
}

await browser.close();
