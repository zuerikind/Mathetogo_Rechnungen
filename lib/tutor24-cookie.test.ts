import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright";
import { COOKIE_BANNER_MESSAGE, CookieBannerError, closeCookieBanner } from "./tutor24-messaging";
import { summarizeRunError } from "./tutor24-followup";

// Lokale Testseite (kein Netz): Cookiebot-Fenster unten, das den Senden-Knopf verdeckt wie auf tutor24.
const page_ = (opts: { closable: boolean; declineButton?: boolean }) => `
<html><body style="margin:0">
  <textarea class="js-conversations-interface-input"></textarea>
  <button id="send" style="position:fixed;bottom:10px;left:10px" onclick="window.sent=(window.sent||0)+1">Senden</button>
  <div id="CybotCookiebotDialog" style="position:fixed;inset:0;background:#fff;z-index:9">
    ${opts.declineButton === false ? "" : `<button id="CybotCookiebotDialogBodyButtonDecline" onclick="window.choice='decline';${opts.closable ? "this.parentElement.style.display='none'" : ""}">Ablehnen</button>`}
    <button id="CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll" onclick="window.choice='all';this.parentElement.style.display='none'">Alle akzeptieren</button>
  </div>
</body></html>`;

let browser: Browser;
let page: Page;
beforeAll(async () => {
  const { chromium } = await import("playwright");
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
}, 30_000);
// setContent behaelt das window-Objekt: Zaehler pro Test zuruecksetzen.
const load = async (html: string) => {
  await page.setContent(html);
  await page.evaluate(() => {
    const w = window as unknown as { sent?: number; choice?: string };
    w.sent = 0;
    w.choice = undefined;
  });
};
afterAll(async () => {
  await browser?.close();
});

describe("Cookie-Fenster (gemeinsam fuer alle tutor24-Automationen)", () => {
  it("schliesst mit 'Ablehnen', nie 'Alle akzeptieren'; danach ist der Senden-Knopf klickbar", async () => {
    await load(page_({ closable: true }));
    await expect(page.locator("#send").click({ timeout: 500 })).rejects.toThrow(); // verdeckt, wie im echten Abbruch
    expect(await closeCookieBanner(page)).toBe("geschlossen");
    expect(await page.evaluate(() => (window as unknown as { choice?: string }).choice)).toBe("decline");
    await page.locator("#send").click({ timeout: 2_000 });
    expect(await page.evaluate(() => (window as unknown as { sent?: number }).sent)).toBe(1);
  });

  it("ohne Fenster: nichts tun", async () => {
    await load("<html><body><button id='send'>Senden</button></body></html>");
    expect(await closeCookieBanner(page)).toBe("keins");
  });

  it("laesst sich nicht schliessen → klare Meldung, nicht 'Alle akzeptieren' als Ausweg", async () => {
    await load(page_({ closable: false }));
    await expect(closeCookieBanner(page)).rejects.toThrow(CookieBannerError);
    await expect(closeCookieBanner(page)).rejects.toThrow(COOKIE_BANNER_MESSAGE);
    expect(await page.evaluate(() => (window as unknown as { choice?: string }).choice)).not.toBe("all");
    expect(await page.evaluate(() => (window as unknown as { sent?: number }).sent ?? 0)).toBe(0);
  }, 20_000);
});

describe("Fehlermeldung auf /kurse", () => {
  // Gekuerzt aus dem echten Abbruch vom 5.11.2026 (Luana)
  const raw =
    "elementHandle.click: Timeout 30000ms exceeded.\nCall log:\n\u001b[2m  - attempting click action\u001b[22m\n" +
    '[2m      - <div id="CybotCookiebotDialogBody" class="CybotCookiebotDialogTabPanel">…</div> from <div id="CybotCookiebotDialog">…</div> subtree intercepts pointer events[22m';

  it("ein Satz oben, Protokoll ohne Steuerzeichen in den Details", () => {
    const s = summarizeRunError(raw, "other", "Luana (33216495), Nr. 1 von 2, 0 gesendet", "send");
    expect(s.error).toBe("Ein Cookie-Fenster von tutor24 hat den Knopf verdeckt. Es wurde nichts gesendet. Stand: Luana (33216495), Nr. 1 von 2, 0 gesendet.");
    expect(s.details).toContain("intercepts pointer events");
    expect(s.details).not.toMatch(/\[2m|\[22m|\u001b/);
  });

  it("Browser-Absturz, eigene Meldung, Cookie-Fehler", () => {
    expect(summarizeRunError("page.goto: Target crashed", "other", "", "preview").error).toMatch(/^Der Browser ist während des Laufs abgestürzt/);
    expect(summarizeRunError("Captcha erkannt (Inserat 1)", "stop", "", "send").error).toBe("Captcha erkannt (Inserat 1)");
    expect(summarizeRunError(COOKIE_BANNER_MESSAGE, "cookie", "", "send").error).toBe(COOKIE_BANNER_MESSAGE);
  });
});
