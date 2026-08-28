import { describe, expect, it } from "vitest";
import { gotoTutor24, sendMessageOnListing } from "./tutor24-messaging";

/**
 * Regression: ein ElementHandle darf nach einer Navigation nicht mehr benutzt werden.
 * Die Stub-Page bildet Chromium darin exakt nach — jedes Handle merkt sich den
 * Navigationszähler seiner Seite und wirft danach denselben Fehler wie Playwright.
 *
 * ponytail: die echten sleep()s laufen mit (~10 s pro Test), statt Timer zu mocken.
 * Wenn die Suite dadurch stört, sleep injizierbar machen.
 */

type Use = string;

function makeStubPage(opts: { contactHref: string | null; buttonAfterNav: boolean }) {
  const uses: Use[] = [];
  let url = "https://www.tutor24.ch/de/gesuche/5967929";
  let nav = 0;

  const makeHandle = (href: string | null, text: string) => {
    const born = nav;
    const guard = (method: string) => {
      if (nav !== born) {
        // Wortlaut wie Playwright — das ist der Fehler aus dem Live-Log.
        throw new Error(
          `elementHandle.${method}: Execution context was destroyed, most likely because of a navigation`
        );
      }
      uses.push(`${method}@${born}`);
    };
    return {
      isVisible: async () => (guard("isVisible"), true),
      getAttribute: async () => (guard("getAttribute"), href),
      evaluate: async () => (guard("evaluate"), text),
      click: async () => void guard("click"),
    };
  };

  const page = {
    url: () => url,
    goto: async (to: string) => {
      url = to;
      nav += 1;
    },
    $$: async (selector: string) => {
      // Nur der Kontakt-Button existiert; Cookie-Banner/Premium-Gate/Submit gibt es nicht.
      if (!selector.includes("js-btn-send-message")) return [];
      if (nav > 0 && !opts.buttonAfterNav) return [];
      return [makeHandle(opts.contactHref, "Ich bin interessiert")];
    },
    // Kein Nachrichtenformular auf keiner Seite → Flow endet in skipped_no_textarea.
    waitForSelector: async () => {
      throw new Error("Timeout exceeded");
    },
    locator: () => ({ first: () => ({ isVisible: async () => false }) }),
    evaluate: async () => undefined,
  };

  return { page: page as unknown as import("playwright").Page, uses, navCount: () => nav };
}

async function run(stub: ReturnType<typeof makeStubPage>) {
  return sendMessageOnListing(
    stub.page,
    "Testnachricht",
    "5967929",
    "Testschüler",
    () => {},
    "https://www.tutor24.ch/de/gesuche/5967929"
  );
}

describe("sendMessageOnListing — Handles über Navigationen hinweg", () => {
  it(
    "sucht den Kontakt-Button nach der /messages/new-Navigation neu, statt das tote Handle zu benutzen",
    async () => {
      const stub = makeStubPage({
        contactHref: "/de/users/999/messages/new",
        buttonAfterNav: true,
      });

      // Vor dem Fix: wirft "elementHandle.getAttribute: Execution context was destroyed".
      await expect(run(stub)).resolves.toBe("skipped_no_textarea");

      expect(stub.navCount()).toBeGreaterThan(0);
      // Geklickt wurde ein Handle, das NACH der Navigation entstanden ist.
      expect(stub.uses).toContain("click@1");
      expect(stub.uses).not.toContain("click@0");
    },
    30_000
  );

  it(
    "benutzt ohne Navigation weiterhin das ursprüngliche Handle",
    async () => {
      const stub = makeStubPage({ contactHref: "#send_message", buttonAfterNav: false });

      await expect(run(stub)).resolves.toBe("skipped_no_textarea");
      expect(stub.uses).toContain("click@0");
    },
    30_000
  );
});

/**
 * Regression: ERR_NETWORK_IO_SUSPENDED (Standby, WLAN-Wechsel) beendete den
 * ganzen Lauf. Der Aufruf der Listenseite liegt ausserhalb des try/catch der
 * einzelnen Gesuche, ein Aussetzer riss also auch die noch offenen Fächer mit.
 *
 * Der Fall mit erschoepften Versuchen ist bewusst NICHT getestet: er wuerde die
 * echten 3+10+30 s abwarten. Wie oft es probiert, steht in NAV_RETRY_DELAYS_MS.
 */
function makeGotoPage(fehler: string[], startUrl = "about:blank") {
  let url = startUrl;
  const versuche: string[] = [];
  const page = {
    url: () => url,
    goto: async (to: string) => {
      const fehlerJetzt = fehler[versuche.length];
      versuche.push(to);
      // Timeouts melden sich ohne net::-Praefix — genau daran unterscheidet
      // gotoTutor24 "langsam" von "kein Netz".
      if (fehlerJetzt?.startsWith("Timeout")) throw new Error(`page.goto: ${fehlerJetzt}`);
      if (fehlerJetzt) throw new Error(`page.goto: net::${fehlerJetzt} at ${to}`);
      url = to;
    },
  };
  return { page: page as unknown as import("playwright").Page, versuche };
}

describe("gotoTutor24 — voruebergehende Netzfehler", () => {
  it(
    "wiederholt nach ERR_NETWORK_IO_SUSPENDED und laedt die Seite danach",
    async () => {
      const stub = makeGotoPage(["ERR_NETWORK_IO_SUSPENDED"]);

      // Vor dem Fix: wirft durch und beendet den Durchgang.
      await expect(gotoTutor24(stub.page, "https://www.tutor24.ch/de/jobs/search?page=9"))
        .resolves.toBeUndefined();

      expect(stub.versuche).toHaveLength(2);
      expect(stub.page.url()).toContain("page=9");
    },
    30_000
  );

  // Der Timeout-Zweig ist aelter als die Wiederholung und muss ihr vorausgehen:
  // wuerde er in die Kandidatenliste rutschen, wartete jede langsame Seite
  // zusaetzlich 3+10+30 s, obwohl sie laengst teilweise geladen ist.
  it("faehrt bei Timeout mit teilweise geladener Seite fort, ohne zu wiederholen", async () => {
    const stub = makeGotoPage(["Timeout 30000ms exceeded"], "https://www.tutor24.ch/de/jobs/123");

    await expect(
      gotoTutor24(stub.page, "https://www.tutor24.ch/de/jobs/456")
    ).resolves.toBeUndefined();

    expect(stub.versuche).toHaveLength(1);
  });

  it("wirft einen echten Fehler sofort durch, ohne zu wiederholen", async () => {
    const stub = makeGotoPage(["ERR_CERT_AUTHORITY_INVALID"]);

    await expect(gotoTutor24(stub.page, "https://www.tutor24.ch/de/jobs/search")).rejects.toThrow(
      "ERR_CERT_AUTHORITY_INVALID"
    );
    expect(stub.versuche).toHaveLength(1);
  });
});
