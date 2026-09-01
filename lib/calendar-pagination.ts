/**
 * Vollstaendigkeit der Kalenderabfrage — die Voraussetzung fuer alles andere.
 *
 * Der Sync hat bisher genau eine Seite mit `maxResults: 500` geholt. Solange
 * das reicht, faellt nichts auf. Reicht es nicht, ist der Schaden still und
 * gross: alles ab Termin 501 fehlt in der Antwort, und der Sync deutet
 * "fehlt" als "im Kalender geloescht". Mit der Soft-Stornierung wuerde daraus
 * ein automatischer Storno echter Lektionen.
 *
 * Deshalb liefert dieses Modul nicht nur alle Seiten, sondern auch die Aussage,
 * OB es alle waren (`complete`). Nur ein vollstaendiger Lauf darf Abwesenheit
 * als Absage werten — bei `complete: false` bleibt jede fehlende Lektion
 * unangetastet und wird nur gemeldet.
 *
 * Rein und ohne googleapis: `fetchPage` ist hereingereicht, damit die Schleife
 * ohne Netz pruefbar ist.
 */

/** Sicherheitsnetz gegen eine endlose Seitenkette (fehlerhafter Server, Schleife). */
export const DEFAULT_MAX_PAGES = 20;

export type PageResult<T> = {
  items: T[];
  nextPageToken?: string | null;
  /** Googles Token fuer den naechsten inkrementellen Lauf, falls angeboten. */
  nextSyncToken?: string | null;
};

export type PagedFetch<T> = {
  items: T[];
  /**
   * true = die Seitenkette wurde bis zum Ende gelesen.
   *
   * false = die Obergrenze hat gegriffen. Dann ist die Liste unvollstaendig und
   * darf NICHT als "das ist alles, was es im Kalender gibt" gelesen werden.
   */
  complete: boolean;
  nextSyncToken: string | null;
  pages: number;
};

/** Zeitstempel einer Fassung, vergleichbar gemacht; null = keine Angabe. */
function versionOf(value: Date | number | string | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Alle Seiten holen, bis Google keinen `nextPageToken` mehr liefert.
 *
 * Doppelte Eintraege werden ueber `keyOf` zusammengefuehrt: das Blaettern ist
 * nicht atomar, und wer waehrend des Laufs einen Termin aendert, bringt
 * dieselbe Event-ID auf zwei Seiten.
 *
 * Welche Fassung gewinnt, ist dabei keine Geschmacksfrage. Der gefaehrliche
 * Fall: Seite 1 enthaelt den Termin noch aktiv, waehrend des Blaetterns wird er
 * abgesagt, Seite 2 liefert ihn mit `status: "cancelled"`. Wer die erste
 * Fassung behaelt, uebersieht die Absage — und stellt eine Lektion in Rechnung,
 * die es nicht mehr gibt. Deshalb gewinnt immer die Fassung mit dem NEUESTEN
 * `updated`-Zeitstempel, unabhaengig davon, auf welcher Seite sie stand.
 *
 * Ohne `versionOf` (oder ohne Zeitstempel auf beiden Seiten) bleibt es bei der
 * ersten Fassung: ohne Vergleichsmassstab ist "spaeter gesehen" kein Beleg fuer
 * "neuer", und eine willkuerliche Vertauschung waere schlechter als eine
 * feste Regel. Gleichstand zaehlt nicht als neuer.
 */
export async function fetchAllPages<T>(
  fetchPage: (pageToken: string | undefined) => Promise<PageResult<T>>,
  opts?: {
    maxPages?: number;
    keyOf?: (item: T) => string | null | undefined;
    /** Googles `updated` der Fassung — entscheidet, welche beim Entdoppeln gewinnt. */
    versionOf?: (item: T) => Date | number | string | null | undefined;
  }
): Promise<PagedFetch<T>> {
  const maxPages = opts?.maxPages ?? DEFAULT_MAX_PAGES;
  const keyOf = opts?.keyOf;
  const readVersion = opts?.versionOf;

  const items: T[] = [];
  /** Schluessel → Platz in `items`, damit die neuere Fassung die aeltere ersetzt. */
  const platzVon = new Map<string, number>();
  let pageToken: string | undefined = undefined;
  let nextSyncToken: string | null = null;
  let pages = 0;

  for (;;) {
    const page: PageResult<T> = await fetchPage(pageToken);
    pages += 1;
    for (const item of page.items) {
      if (!keyOf) {
        items.push(item);
        continue;
      }
      const key = keyOf(item);
      // Ohne Schluessel kann nicht entdoppelt werden — dann lieber behalten:
      // ein Termin zu viel faellt auf, ein fehlender nicht.
      if (key == null) {
        items.push(item);
        continue;
      }
      const platz = platzVon.get(key);
      if (platz === undefined) {
        platzVon.set(key, items.length);
        items.push(item);
        continue;
      }
      if (!readVersion) continue;
      const neu = versionOf(readVersion(item));
      const alt = versionOf(readVersion(items[platz]));
      // Nur echt neuer ersetzt. Fehlt dem Neuling der Zeitstempel, bleibt die
      // bekannte Fassung stehen; hat die bekannte keinen und der Neuling schon,
      // gewinnt der Neuling — irgendeine Angabe schlaegt keine.
      if (neu === null) continue;
      if (alt === null || neu > alt) items[platz] = item;
    }
    if (page.nextSyncToken) nextSyncToken = page.nextSyncToken;

    const next = page.nextPageToken;
    if (!next) return { items, complete: true, nextSyncToken, pages };
    if (pages >= maxPages) {
      // Bewusst kein Wurf: der Abgleich der gelesenen Termine ist weiterhin
      // richtig und nuetzlich. Nur die Umkehrung ("was fehlt, ist geloescht")
      // ist es nicht mehr, und genau das sagt `complete: false`.
      return { items, complete: false, nextSyncToken, pages };
    }
    pageToken = next;
  }
}
