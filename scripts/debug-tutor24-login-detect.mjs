import { config } from "dotenv";
import { chromium } from "playwright";

config({ path: ".env.local" });

const email = process.env.TUTOR24_EMAIL;
const password = process.env.TUTOR24_PASSWORD;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("https://www.tutor24.ch/de/sign_in", { waitUntil: "domcontentloaded" });
await page.locator("#user_login").fill(email);
await page.locator("#user_password").fill(password);
await page.locator("#login-btn").click();
await page.waitForTimeout(6000);

const checks = await page.evaluate(() => ({
  url: location.href,
  signOutLinks: Array.from(document.querySelectorAll('a[href*="sign_out"], form[action*="sign_out"]')).map(
    (a) => ({ href: a.getAttribute("href"), visible: a.offsetParent !== null, text: a.textContent?.trim() })
  ),
  signInLinks: Array.from(document.querySelectorAll('a[href*="sign_in"]')).map((a) => ({
    visible: a.offsetParent !== null,
    text: a.textContent?.trim(),
  })),
  meinProfil: !!document.querySelector('a[href*="/providers/"]:has-text("Mein Profil"), a:has-text("Mein Profil")'),
  loginForm: !!document.querySelector("#login-form"),
}));

console.log(JSON.stringify(checks, null, 2));
await browser.close();
