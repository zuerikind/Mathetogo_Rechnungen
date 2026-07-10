/**
 * Debug collectListingLinks on filtered search URL (same as automation).
 */
import { config } from "dotenv";
import { chromium } from "playwright";

config({ path: ".env.local" });

const email = process.env.TUTOR24_EMAIL;
const password = process.env.TUTOR24_PASSWORD;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FILTER_URL =
  "https://tutor24.ch/de/jobs/search?q%5Bconsumer_subjects___%5D=Mathematik&q%5Bdistance%5D=100&q%5Border%5D=publish_date&q%5Bplace%5D=8000%2C+Z%C3%BCrich";

function buildPaginatedUrl(baseUrl, pageNum) {
  if (baseUrl.includes("page=")) {
    return baseUrl.replace(/([?&])page=\d+/, `$1page=${pageNum}`);
  }
  return baseUrl + (baseUrl.includes("?") ? "&" : "?") + `page=${pageNum}`;
}

async function collectLinks(page, segPattern) {
  return page.evaluate((pattern) => {
    const re = new RegExp(`^\\/(de|en|fr)\\/(${pattern})\\/(\\d+)`);
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const seen = new Set();
    const links = [];
    const allJobPaths = [];
    for (const a of anchors) {
      const p = a.pathname;
      if (/\/jobs\//.test(p)) allJobPaths.push(p);
      const m = p.match(re);
      if (!m) continue;
      const id = m[3];
      if (seen.has(id)) continue;
      seen.add(id);
      links.push({ href: a.href, id, path: p });
    }
    return {
      matchCount: links.length,
      links: links.slice(0, 5),
      sampleJobPaths: [...new Set(allJobPaths)].slice(0, 20),
      bodySnippet: document.body.innerText.slice(0, 200).replace(/\s+/g, " "),
      title: document.title,
    };
  }, segPattern);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
});

await page.goto("https://www.tutor24.ch/de/sign_in", { waitUntil: "domcontentloaded", timeout: 60000 });
const c = page.locator('button:has-text("Akzeptieren"), button:has-text("Alle akzeptieren")').first();
if (await c.isVisible().catch(() => false)) await c.click();
if (await page.locator("#login-form").isVisible().catch(() => false)) {
  await page.locator("#user_login").fill(email);
  await page.locator("#user_password").fill(password);
  await page.locator("#login-btn").click();
  await sleep(5000);
}
console.log("logged in:", page.url());

for (const [label, url] of [
  ["filter no page", FILTER_URL],
  ["page 1", buildPaginatedUrl(FILTER_URL, 1)],
  ["page 2", buildPaginatedUrl(FILTER_URL, 2)],
]) {
  console.log(`\n=== ${label} ===`);
  console.log(url);
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (e) {
    console.log("goto error:", e.message, "url now:", page.url());
  }
  console.log("goto ms:", Date.now() - t0);
  await page.waitForSelector('a[href*="/jobs/"]', { timeout: 20000 }).catch(() => console.log("waitForSelector timeout"));
  await sleep(1500);
  const seg = "students|requests|jobs|gesuche";
  const data = await collectLinks(page, seg);
  console.log(JSON.stringify(data, null, 2));
}

await browser.close();
