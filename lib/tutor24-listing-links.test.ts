import { afterAll, beforeAll, expect, it } from "vitest";
import type { Browser, Page } from "playwright";
import { collectListingLinks } from "./tutor24-messaging";

// 24.11. 17:54: Suchseite lud waehrend des Auslesens neu → "Execution context was destroyed" brach den ganzen Durchgang ab.
let browser: Browser;
let page: Page;
beforeAll(async () => {
  const { chromium } = await import("playwright");
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
}, 30_000);
// Echte Herkunft noetig (setContent hat origin "null"); kein Netz: die Anfrage wird lokal beantwortet.
const load = async () => {
  await page.route("https://tutor24.ch/**", (r) => r.fulfill({ contentType: "text/html", body: html }));
  await page.goto("https://tutor24.ch/de/jobs/search");
  // wie lib/tutor24.ts (addInitScript): esbuild fuegt in Browser-Funktionen __name(...) ein
  await page.evaluate("globalThis.__name = globalThis.__name || function (f) { return f; };");
};
afterAll(() => browser?.close());

const html = `<html><body>
  <a href="https://tutor24.ch/de/jobs/111?x=1">A</a><a href="https://tutor24.ch/de/jobs/111">A2</a>
  <a href="https://tutor24.ch/de/jobs/222">B</a><a href="https://tutor24.ch/de/about">C</a>
</body></html>`;
const DESTROYED = "page.evaluate: Execution context was destroyed, most likely because of a navigation";

/** page.evaluate wirft beim Auslesen der Links (Argument = Segment-Muster) die ersten `n` Male */
function failLinkRead(n: number) {
  const orig = page.evaluate.bind(page) as (...a: unknown[]) => Promise<unknown>;
  let left = n;
  (page as unknown as { evaluate: unknown }).evaluate = (fn: unknown, arg?: unknown) =>
    typeof arg === "string" && arg.includes("students") && left-- > 0 ? Promise.reject(new Error(DESTROYED)) : orig(fn, arg);
  return () => ((page as unknown as { evaluate: unknown }).evaluate = orig);
}

it("liest nach einem Neuladen der Suchseite einmal nochmals", async () => {
  await load();
  const restore = failLinkRead(1);
  const log: string[] = [];
  try {
    const links = await collectListingLinks(page, "jobs", (s) => log.push(s));
    expect(links.map((l) => l.id)).toEqual(["111", "222"]);
    expect(log.some((l) => l.includes("Suchseite hat neu geladen"))).toBe(true);
  } finally {
    restore();
  }
}, 30_000);

it("zweimal hintereinander: Fehler geht weiter (kein Endlos-Versuch)", async () => {
  await load();
  const restore = failLinkRead(2);
  try {
    await expect(collectListingLinks(page, "jobs")).rejects.toThrow("Execution context was destroyed");
  } finally {
    restore();
  }
}, 30_000);
