import { config } from "dotenv";
import { chromium } from "playwright";

config({ path: ".env.local" });

const email = process.env.TUTOR24_EMAIL;
const password = process.env.TUTOR24_PASSWORD;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!email || !password) {
  console.error("Missing TUTOR24_EMAIL/PASSWORD");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
});
console.log("login...");
await page.goto("https://www.tutor24.ch/de/sign_in", { waitUntil: "domcontentloaded" });
const cookie = page.locator('button:has-text("Akzeptieren"), button:has-text("Alle akzeptieren")').first();
if (await cookie.isVisible().catch(() => false)) await cookie.click();
if (await page.locator("#login-form").isVisible().catch(() => false)) {
  await page.locator("#user_login").fill(email);
  await page.locator("#user_password").fill(password);
  await page.locator("#login-btn").click();
  await sleep(5000);
}
console.log("after login", page.url());

await page.goto(
  "https://www.tutor24.ch/de/jobs/search?q%5Bplace%5D=8000%2C+Z%C3%BCrich&q%5Bsubject_cont%5D=Mathematik&page=1",
  { waitUntil: "domcontentloaded" }
);
await page.waitForSelector('a[href*="/jobs/"]', { timeout: 20000 }).catch(() => {});
await sleep(2000);

console.log("search url", page.url());
const jobIds = await page.evaluate(() => {
  const re = /^\/de\/jobs\/(\d+)/;
  const ids = [];
  for (const a of document.querySelectorAll("a[href]")) {
    const m = a.pathname.match(re);
    if (m && !ids.includes(m[1])) ids.push(m[1]);
  }
  return ids.slice(0, 8);
});
console.log("jobIds", jobIds);

for (const id of jobIds) {
  await page.goto(`https://www.tutor24.ch/de/jobs/${id}`, { waitUntil: "domcontentloaded" });
  await sleep(1500);
  const info = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("a.js-btn-send-message, button.js-btn-send-message")).map(
      (el) => ({
        text: (el.textContent || "").trim().slice(0, 40),
        href: el.getAttribute("href"),
        vis: el.offsetParent !== null,
      })
    );
    const interessiert = Array.from(document.querySelectorAll("a[href*='/messages/new']")).map((el) => ({
      text: (el.textContent || "").trim().slice(0, 40),
      href: el.getAttribute("href"),
      vis: el.offsetParent !== null,
    }));
    return { btns, interessiert, hasTa: !!document.querySelector('textarea[name="message[content]"]') };
  });
  console.log(id, JSON.stringify(info));
}

await browser.close();
