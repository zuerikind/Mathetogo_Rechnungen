import { describe, expect, it, vi } from "vitest";
import { fetchAllPages, DEFAULT_MAX_PAGES } from "./calendar-pagination";

type Evt = { id: string };

/** Baut eine Seitenkette aus Bloecken. */
function pager(pages: Evt[][], syncTokenOnLast?: string) {
  return vi.fn(async (pageToken: string | undefined) => {
    const index = pageToken ? Number(pageToken) : 0;
    const last = index === pages.length - 1;
    return {
      items: pages[index],
      nextPageToken: last ? null : String(index + 1),
      nextSyncToken: last ? syncTokenOnLast ?? null : null,
    };
  });
}

describe("Pagination", () => {
  it("liest eine einzelne Seite und meldet sie als vollstaendig", async () => {
    const res = await fetchAllPages<Evt>(pager([[{ id: "a" }, { id: "b" }]]));
    expect(res.items.map((e) => e.id)).toEqual(["a", "b"]);
    expect(res.complete).toBe(true);
    expect(res.pages).toBe(1);
  });

  it("liest mehrere Seiten und haengt sie in Reihenfolge aneinander", async () => {
    const fetchPage = pager([
      [{ id: "a" }, { id: "b" }],
      [{ id: "c" }],
      [{ id: "d" }, { id: "e" }],
    ]);
    const res = await fetchAllPages<Evt>(fetchPage);
    expect(res.items.map((e) => e.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(res.complete).toBe(true);
    expect(res.pages).toBe(3);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    // Erste Seite ohne Token, danach jeweils der gemeldete Token.
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([undefined, "1", "2"]);
  });

  it("entdoppelt Termine, die beim Blaettern auf zwei Seiten erscheinen", async () => {
    const fetchPage = pager([
      [{ id: "a" }, { id: "b" }],
      [{ id: "b" }, { id: "c" }],
    ]);
    const res = await fetchAllPages<Evt>(fetchPage, { keyOf: (e) => e.id });
    expect(res.items.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
});

/**
 * Blaettern ist nicht atomar. Wer waehrend des Laufs einen Termin absagt,
 * bringt dieselbe Event-ID zweimal — einmal alt und aktiv, einmal neu und
 * cancelled. Behielte man die erste Fassung, bliebe die Absage unbemerkt und
 * die Lektion stuende weiter auf der Rechnung.
 */
describe("Entdoppelung: die neuere Fassung gewinnt", () => {
  type Versioniert = { id: string; status: string; updated: string | null };

  const seiten = (pages: Versioniert[][]) =>
    vi.fn(async (pageToken: string | undefined) => {
      const i = pageToken ? Number(pageToken) : 0;
      return {
        items: pages[i],
        nextPageToken: i === pages.length - 1 ? null : String(i + 1),
      };
    });

  const lauf = (pages: Versioniert[][]) =>
    fetchAllPages<Versioniert>(seiten(pages), {
      keyOf: (e) => e.id,
      versionOf: (e) => e.updated,
    });

  it("aeltere aktive Fassung auf Seite 1, neuere cancelled auf Seite 2 → cancelled gewinnt", async () => {
    const res = await lauf([
      [{ id: "evt-1", status: "confirmed", updated: "2026-09-02T08:00:00.000Z" }],
      [{ id: "evt-1", status: "cancelled", updated: "2026-09-02T09:30:00.000Z" }],
    ]);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].status).toBe("cancelled");
    expect(res.items[0].updated).toBe("2026-09-02T09:30:00.000Z");
  });

  it("die Reihenfolge entscheidet nicht: neuere cancelled zuerst, aeltere aktiv danach", async () => {
    const res = await lauf([
      [{ id: "evt-1", status: "cancelled", updated: "2026-09-02T09:30:00.000Z" }],
      [{ id: "evt-1", status: "confirmed", updated: "2026-09-02T08:00:00.000Z" }],
    ]);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].status).toBe("cancelled");
  });

  it("umgekehrt genauso: wurde der Termin wiederhergestellt, gewinnt die aktive Fassung", async () => {
    const res = await lauf([
      [{ id: "evt-1", status: "cancelled", updated: "2026-09-02T08:00:00.000Z" }],
      [{ id: "evt-1", status: "confirmed", updated: "2026-09-02T09:30:00.000Z" }],
    ]);
    expect(res.items[0].status).toBe("confirmed");
  });

  it("die neuere Fassung behaelt den Platz der aelteren", async () => {
    const res = await lauf([
      [
        { id: "a", status: "confirmed", updated: "2026-09-02T08:00:00.000Z" },
        { id: "evt-1", status: "confirmed", updated: "2026-09-02T08:00:00.000Z" },
        { id: "z", status: "confirmed", updated: "2026-09-02T08:00:00.000Z" },
      ],
      [{ id: "evt-1", status: "cancelled", updated: "2026-09-02T09:30:00.000Z" }],
    ]);
    expect(res.items.map((e) => e.id)).toEqual(["a", "evt-1", "z"]);
    expect(res.items[1].status).toBe("cancelled");
  });

  it("Gleichstand zaehlt nicht als neuer — die erste Fassung bleibt", async () => {
    const res = await lauf([
      [{ id: "evt-1", status: "confirmed", updated: "2026-09-02T08:00:00.000Z" }],
      [{ id: "evt-1", status: "cancelled", updated: "2026-09-02T08:00:00.000Z" }],
    ]);
    expect(res.items[0].status).toBe("confirmed");
  });

  it("ohne Zeitstempel auf der zweiten Fassung bleibt die erste stehen", async () => {
    const res = await lauf([
      [{ id: "evt-1", status: "confirmed", updated: "2026-09-02T08:00:00.000Z" }],
      [{ id: "evt-1", status: "cancelled", updated: null }],
    ]);
    expect(res.items[0].status).toBe("confirmed");
  });

  it("hatte die erste keinen Zeitstempel und die zweite schon, gewinnt die zweite", async () => {
    const res = await lauf([
      [{ id: "evt-1", status: "confirmed", updated: null }],
      [{ id: "evt-1", status: "cancelled", updated: "2026-09-02T09:30:00.000Z" }],
    ]);
    expect(res.items[0].status).toBe("cancelled");
  });

  it("unbrauchbare Zeitstempel zaehlen als keine Angabe", async () => {
    const res = await lauf([
      [{ id: "evt-1", status: "confirmed", updated: "2026-09-02T08:00:00.000Z" }],
      [{ id: "evt-1", status: "cancelled", updated: "voelliger Unsinn" }],
    ]);
    expect(res.items[0].status).toBe("confirmed");
  });

  it("ohne versionOf bleibt es bei der ersten Fassung", async () => {
    const res = await fetchAllPages<Versioniert>(
      seiten([
        [{ id: "evt-1", status: "confirmed", updated: "2026-09-02T08:00:00.000Z" }],
        [{ id: "evt-1", status: "cancelled", updated: "2026-09-02T09:30:00.000Z" }],
      ]),
      { keyOf: (e) => e.id }
    );
    expect(res.items).toHaveLength(1);
    expect(res.items[0].status).toBe("confirmed");
  });

  it("drei Fassungen ueber drei Seiten: die neueste gewinnt, egal wo sie steht", async () => {
    const res = await lauf([
      [{ id: "evt-1", status: "confirmed", updated: "2026-09-02T08:00:00.000Z" }],
      [{ id: "evt-1", status: "cancelled", updated: "2026-09-02T11:00:00.000Z" }],
      [{ id: "evt-1", status: "confirmed", updated: "2026-09-02T09:30:00.000Z" }],
    ]);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].status).toBe("cancelled");
    expect(res.items[0].updated).toBe("2026-09-02T11:00:00.000Z");
  });
});

describe("Pagination — Randfaelle", () => {

  it("reicht Googles nextSyncToken durch", async () => {
    const res = await fetchAllPages<Evt>(pager([[{ id: "a" }], [{ id: "b" }]], "tok-1"));
    expect(res.nextSyncToken).toBe("tok-1");
  });

  it("gibt es kein Token, ist es null — kein erfundener Wert", async () => {
    const res = await fetchAllPages<Evt>(pager([[{ id: "a" }]]));
    expect(res.nextSyncToken).toBeNull();
  });

  /**
   * Der gefaehrliche Fall. Bricht die Kette ab, ist die Liste unvollstaendig —
   * und "nicht in der Liste" darf dann NICHT "im Kalender geloescht" heissen.
   */
  it("meldet complete: false, wenn die Obergrenze greift", async () => {
    const endlos = vi.fn(async (pageToken: string | undefined) => ({
      items: [{ id: `e-${pageToken ?? "0"}` }],
      nextPageToken: String(Number(pageToken ?? "0") + 1),
    }));
    const res = await fetchAllPages<Evt>(endlos, { maxPages: 3 });
    expect(res.complete).toBe(false);
    expect(res.pages).toBe(3);
    expect(res.items).toHaveLength(3);
  });

  it("die Voreinstellung deckelt ebenfalls", async () => {
    const endlos = vi.fn(async (pageToken: string | undefined) => ({
      items: [{ id: `e-${pageToken ?? "0"}` }],
      nextPageToken: String(Number(pageToken ?? "0") + 1),
    }));
    const res = await fetchAllPages<Evt>(endlos);
    expect(res.pages).toBe(DEFAULT_MAX_PAGES);
    expect(res.complete).toBe(false);
  });

  it("eine leere Antwort ist vollstaendig, nicht kaputt", async () => {
    const res = await fetchAllPages<Evt>(pager([[]]));
    expect(res).toMatchObject({ items: [], complete: true, pages: 1 });
  });

  it("Eintraege ohne Schluessel werden behalten statt verworfen", async () => {
    const fetchPage = vi.fn(async () => ({
      items: [{ id: "a" }, { id: "" }] as Evt[],
      nextPageToken: null,
    }));
    const res = await fetchAllPages<Evt>(fetchPage, { keyOf: (e) => e.id || null });
    expect(res.items).toHaveLength(2);
  });
});
