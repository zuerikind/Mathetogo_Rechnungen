/**
 * Debug: login → job page → contact button → message form
 * Run: node scripts/debug-tutor24-message-flow.mjs [jobId]
 */
import { config } from "dotenv";
import { chromium } from "playwright";

config({ path: ".env.local" });

const email = process.env.TUTOR24_EMAIL;
const password = process.env.TUTOR24_PASSWORD;
const jobId = process.argv[2] || "";

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function acceptCookies(page) {
  const btn = page
    .locator(
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, button:has-text("Alle akzeptieren"), button:has-text("Akzeptieren")'
    )
    .first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click().catch(() => {});
    await sleep(600);
  }
}

async function login(page) {
  await page.goto("https://www.tutor24.ch/de/sign_in", { waitUntil: "domcontentloaded", timeout: 60000 });
  await acceptCookies(page);
  const loginForm = page.locator("#login-form").first();
  if (!(await loginForm.isVisible().catch(() => false))) {
    console.log("Already logged in?", page.url());
    return;
  }
  await page.locator("#user_login").fill(email);
  await page.locator("#user_password").fill(password);
  await page.locator("#login-btn").click();
  await sleep(5000);
  console.log("After login:", page.url());
}

async function dumpButtons(page, label) {
  const data = await page.evaluate(() => {
    const sels = ["a.js-btn-send-message", 'a[href*="/messages/new"]'];
    const interest = Array.from(document.querySelectorAll("a, button")).filter((el) =>
      /interessiert/i.test(el.textContent || "")
    );
    const out = {};
    for (const sel of sels) {
      out[sel] = Array.from(document.querySelectorAll(sel)).map((el) => ({
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50),
        href: el.getAttribute("href"),
        visible: el.offsetParent !== null,
        rect: el.getBoundingClientRect(),
      }));
    }
    return {
      url: location.href,
      title: document.title,
      textareas: Array.from(
        document.querySelectorAll('textarea[name="message[content]"], textarea.js-message-form-input')
      ).map((t) => ({
        name: t.getAttribute("name"),
        visible: t.offsetParent !== null,
        disabled: t.disabled,
      })),
      buttons: out,
      interessiert: interest.map((el) => ({
        tag: el.tagName,
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50),
        href: el.getAttribute("href"),
        visible: el.offsetParent !== null,
      })),
    };
  });
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(data, null, 2));
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
});

await login(page);

let jobHref = jobId ? `https://www.tutor24.ch/de/jobs/${jobId}` : null;
if (!jobHref) {
  await page.goto(
    "https://www.tutor24.ch/de/jobs/search?q%5Bplace%5D=8000%2C+Z%C3%BCrich&q%5Bsubject_cont%5D=Mathematik&page=1",
    { waitUntil: "domcontentloaded" }
  );
  await sleep(2000);
  jobHref = await page.evaluate(() => {
    const a = document.querySelector('a[href*="/de/jobs/"]');
    return a?.href || null;
  });
  console.log("First job link:", jobHref);
}

if (!jobHref) {
  console.error("No job found");
  await browser.close();
  process.exit(1);
}

await page.goto(jobHref, { waitUntil: "domcontentloaded", timeout: 60000 });
await acceptCookies(page);
await sleep(2000);
await dumpButtons(page, "job page before click");

const btn = page.locator("a.js-btn-send-message").first();
const visible = await btn.isVisible().catch(() => false);
console.log("\nPrimary btn visible:", visible);
if (visible) {
  const href = await btn.getAttribute("href");
  console.log("Clicking:", href);
  await btn.click();
  await sleep(3000);
  await dumpButtons(page, "after Playwright click");

  if (!(await page.locator('textarea[name="message[content]"]').isVisible().catch(() => false))) {
    const dest = href?.startsWith("http") ? href : `https://www.tutor24.ch${href}`;
    console.log("No textarea — goto:", dest);
    await page.goto(dest, { waitUntil: "domcontentloaded" });
    await sleep(2000);
    await dumpButtons(page, "after goto messages/new");
  }
}

await browser.close();
console.log("\nDone.");
