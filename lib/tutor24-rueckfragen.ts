/**
 * Rueckfragen per Telegram (11.11.): Die Automatik sendet "sichere" Erst-Nachrichten selbst; "unsichere"
 * stellt sie Omid als Telegram-Meldung mit Knoepfen (Senden / Ueberspringen / du / Sie).
 *
 * Sicher = fester Text (kein KI-Satz), Anrede erkannt (oder "unklar" mit neutralem festem Text, Schalter
 * sicherUnklar), Stufe erkannt, Deutsch, keine Markierung (Agentur, Nebenfach), Pruefung bestanden.
 * Schalter sicherKi / sicherEn (Standard aus) koennen KI-Saetze bzw. Englisch spaeter freigeben;
 * Franzoesisch bleibt immer Rueckfrage. Zaehler "in Folge freigegeben" pro Art fuer Omids Entscheid.
 *
 * Ablage tutor24-followup/rueckfragen.json (lokal). Hoechstens MAX_PRO_TAG Rueckfragen am Tag, der Rest
 * geht direkt in die Liste "markiert" auf /kurse. Offene verfallen um VERFALL_H Uhr → ebenfalls Liste.
 * "Ueberspringen" schreibt den Fall in ki_verbesserungen.md.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FOLLOWUP_DIR } from "./tutor24-followup-store";
import { MARKIERT_PATH, addMarkiert, type AnredeWahl } from "./tutor24-batch";
import type { FollowupSettings, ListingInfo } from "./tutor24-followup";

export const RUECKFRAGEN_PATH = join(FOLLOWUP_DIR, "rueckfragen.json");
export const KI_VERBESSERUNGEN_PATH = join(FOLLOWUP_DIR, "ki_verbesserungen.md");
export const MAX_PRO_TAG = 5;
/** Ab dieser Stunde (Zuerich) verfallen offene Rueckfragen des Tages */
export const VERFALL_H = 20;
/** Freigaben sammeln: so lange nach dem letzten Knopfdruck wartet der Sende-Lauf */
export const SAMMEL_MIN = 10;
/** Bis dahin stehen "Anrede unklar"-Nachrichten (als sicher gesendet) vollstaendig in der Abend-Zusammenfassung */
export const UNKLAR_ZEIGEN_BIS = "2026-11-25";

export type RueckfrageStatus = "offen" | "freigegeben" | "gesendet" | "uebersprungen" | "verfallen" | "fehler";
export type RueckfrageArt = "ki" | "en" | "unklar" | "andere";
export type Rueckfrage = {
  /** Inserat-ID */
  id: string;
  titel: string;
  stufe: string;
  link: string;
  sprache: "de" | "en" | "fr";
  anrede: AnredeWahl;
  /** Gruende, warum nicht sicher (fuer die Meldung) */
  grund: string;
  art: RueckfrageArt;
  text: string;
  kursId: string | null;
  hint: string | null;
  satz: string;
  info: ListingInfo;
  /** YYYY-MM-DD (Zuerich) des Stellens */
  tag: string;
  erstelltAm: string;
  status: RueckfrageStatus;
  /** Omid hat die Anrede per Knopf geaendert: zaehlt nicht als "unklar in Folge freigegeben" */
  anredeGeaendert?: boolean;
  /** Probe-Rueckfrage (Probemodus): Knoepfe zum Ausprobieren — zaehlt nirgends, wird nie gesendet, nie in Listen */
  probe?: boolean;
  /** letzter Knopfdruck (Sammeln der Freigaben) */
  aktionAm?: string;
  meldung?: string;
};
export type Folge = { ki: number; en: number; unklar: number };
type Store = { items: Rueckfrage[]; folge: Folge };
const EMPTY: Store = { items: [], folge: { ki: 0, en: 0, unklar: 0 } };

export function loadRueckfragen(path = RUECKFRAGEN_PATH): Store {
  try {
    if (!existsSync(path)) return structuredClone(EMPTY);
    const s = JSON.parse(readFileSync(path, "utf8")) as Partial<Store>;
    return { items: Array.isArray(s.items) ? s.items : [], folge: { ...EMPTY.folge, ...(s.folge ?? {}) } };
  } catch {
    return structuredClone(EMPTY);
  }
}
const save = (s: Store, path: string) => writeFileSync(path, JSON.stringify({ ...s, items: s.items.slice(-300) }, null, 1));

export const zurichDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });
const zurichHour = (d: Date) => Number(d.toLocaleTimeString("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", hour12: false }).slice(0, 2));

// ── Sicher oder Rueckfrage? ───────────────────────────────────────────────────

export type SicherInput = {
  sprache: "de" | "en" | "fr";
  wer: "schueler" | "eltern" | "unklar";
  /** ki | fest | ohne | fallback */
  satz: string;
  problem: string | null;
  agentur: string | null;
  nebenfach: string | null;
};
export type SicherSchalter = Pick<FollowupSettings, "sicherUnklar" | "sicherKi" | "sicherEn">;

/** Gruende, warum die Nachricht nicht von selbst gesendet wird; leer = sicher. */
export function unsicherGruende(i: SicherInput, s: SicherSchalter): string[] {
  const g: string[] = [];
  if (i.problem) g.push(`Prüfung nicht bestanden: ${i.problem}`);
  if (i.agentur) g.push(`Möglicherweise Agentur: ${i.agentur}`);
  if (i.nebenfach) g.push(`Mathe nur Nebenfach: ${i.nebenfach}`);
  if (i.sprache === "fr") g.push("Französisch");
  if (i.sprache === "en" && !s.sicherEn) g.push("Englisch");
  if (i.satz === "ki" && !s.sicherKi) g.push("KI-Satz");
  if (i.satz === "fallback") g.push("Ersatzsatz (alte Regel)");
  if (i.satz === "ohne") g.push("Stufe nicht erkannt");
  // "unklar" nur mit neutralem festem Text (Omid, 11.11.)
  if (i.wer === "unklar" && !(s.sicherUnklar && i.satz === "fest")) g.push("Anrede unklar");
  return g;
}

/** Welche Art fuer den Zaehler "in Folge freigegeben": die erste zutreffende von ki, en, unklar */
export function rueckfrageArt(i: SicherInput): RueckfrageArt {
  if (i.problem || i.agentur || i.nebenfach || i.sprache === "fr" || i.satz === "ohne" || i.satz === "fallback") return "andere";
  if (i.satz === "ki") return "ki";
  if (i.sprache === "en") return "en";
  if (i.wer === "unklar") return "unklar";
  return "andere";
}

// ── Stellen ───────────────────────────────────────────────────────────────────

export const heuteGestellt = (s: Store, tag: string) => s.items.filter((r) => r.tag === tag && !r.probe).length;

/**
 * Rueckfrage anlegen oder, wenn das Tageslimit erreicht ist, direkt in die Liste "markiert".
 * Liefert "gestellt" (Meldung schicken) oder "liste".
 */
export function rueckfrageAnlegen(r: Omit<Rueckfrage, "tag" | "erstelltAm" | "status">, now = new Date(), path = RUECKFRAGEN_PATH, markiertPath = MARKIERT_PATH): "gestellt" | "liste" | "schon" {
  const s = loadRueckfragen(path);
  const tag = zurichDay(now);
  if (s.items.some((x) => x.id === r.id && !x.probe && x.status !== "verfallen" && x.status !== "fehler")) return "schon";
  if (!r.probe && (heuteGestellt(s, tag) >= MAX_PRO_TAG || zurichHour(now) >= VERFALL_H)) {
    addMarkiert({ id: r.id, titel: r.titel, link: r.link, grund: `${r.grund} (ohne Rückfrage: ${heuteGestellt(s, tag) >= MAX_PRO_TAG ? `${MAX_PRO_TAG} am Tag erreicht` : `nach ${VERFALL_H} Uhr`})`, am: now.toISOString() }, markiertPath);
    return "liste";
  }
  s.items = s.items.filter((x) => x.id !== r.id);
  s.items.push({ ...r, tag, erstelltAm: now.toISOString(), status: "offen" });
  save(s, path);
  return "gestellt";
}

const ANREDE_LABEL: Record<AnredeWahl, string> = { du: "du", Tochter: "Eltern · Ihre Tochter", Sohn: "Eltern · Ihr Sohn", Kind: "Eltern · Ihr Kind", unklar: "Sie (neutral)" };

/** Telegram-Text der Rueckfrage (kein HTML: der Inserat-Titel ist fremder Text) */
export function rueckfrageText(r: Rueckfrage, nr: number, von = MAX_PRO_TAG): string {
  return (
    `${r.probe ? "🧪 PROBE · " : ""}❓ Rückfrage ${nr}/${von} · ${r.grund}\n` +
    `${r.titel} · Stufe: ${r.stufe || "–"} · Anrede: ${ANREDE_LABEL[r.anrede]}${r.sprache !== "de" ? ` · ${r.sprache === "en" ? "Englisch" : "Französisch"}` : ""}\n` +
    `${r.link}\n\n${r.text}`
  ).slice(0, 4000);
}

/** Knoepfe: Senden / Ueberspringen; bei Deutsch zusaetzlich du / Sie (Anrede umstellen) */
export function rueckfrageKnoepfe(r: Rueckfrage) {
  const rows = [[{ text: "✅ Senden", callback_data: `rf:send:${r.id}` }, { text: "⏭ Überspringen", callback_data: `rf:skip:${r.id}` }]];
  if (r.sprache === "de") rows.push([{ text: "Anrede: du", callback_data: `rf:du:${r.id}` }, { text: "Anrede: Sie", callback_data: `rf:sie:${r.id}` }]);
  return { inline_keyboard: rows };
}

/** "rf:send:123" → { aktion, id }; alles andere null (keine freien Eingaben) */
export function parseRueckfrageKnopf(data: string | undefined): { aktion: "send" | "skip" | "du" | "sie"; id: string } | null {
  const m = /^rf:(send|skip|du|sie):(\d{1,12})$/.exec(data ?? "");
  return m ? { aktion: m[1] as "send" | "skip" | "du" | "sie", id: m[2] } : null;
}

// ── Knoepfe anwenden ──────────────────────────────────────────────────────────

export function findeRueckfrage(id: string, path = RUECKFRAGEN_PATH): Rueckfrage | null {
  return loadRueckfragen(path).items.find((r) => r.id === id) ?? null;
}

function patch(id: string, f: (r: Rueckfrage, s: Store) => void, path: string): Rueckfrage | null {
  const s = loadRueckfragen(path);
  const r = s.items.find((x) => x.id === id);
  if (!r) return null;
  f(r, s);
  save(s, path);
  return r;
}

/** "Senden": freigeben; Zaehler der Art +1 (unklar nur ohne Anrede-Wechsel). null = unbekannt; sonst der Eintrag. */
export function freigeben(id: string, now = new Date(), path = RUECKFRAGEN_PATH): Rueckfrage | null {
  return patch(id, (r, s) => {
    if (r.status !== "offen" && r.status !== "verfallen") return;
    r.status = "freigegeben";
    r.aktionAm = now.toISOString();
    if (r.probe) return;
    if (r.art === "ki" || r.art === "en") s.folge[r.art]++;
    else if (r.art === "unklar" && !r.anredeGeaendert) s.folge.unklar++;
  }, path);
}

/** "Ueberspringen": Eintrag in ki_verbesserungen.md, Zaehler der Art auf 0 */
export function ueberspringen(id: string, now = new Date(), path = RUECKFRAGEN_PATH, mdPath = KI_VERBESSERUNGEN_PATH): Rueckfrage | null {
  return patch(id, (r, s) => {
    if (r.status === "gesendet") return;
    r.status = "uebersprungen";
    r.aktionAm = now.toISOString();
    if (r.probe) return; // Probe: weder Zaehler noch ki_verbesserungen.md
    if (r.art === "ki" || r.art === "en" || r.art === "unklar") s.folge[r.art] = 0;
    const satz = persoenlicherTeil(r.text);
    appendFileSync(
      mdPath,
      `\n## Übersprungen per Telegram, ${now.toLocaleDateString("de-CH", { timeZone: "Europe/Zurich" })}\n- Inserat: ${r.link} („${r.titel}“, ${r.stufe || "Stufe –"}, ${r.sprache})\n- Rückfrage wegen: ${r.grund}\n- Persönlicher Teil: ${satz}\n- Grund von Omid: (noch offen)\n`
    );
  }, path);
}

/** Anrede per Knopf gewechselt: neuer Text, Markierung fuer den Zaehler */
export function anredeSetzen(id: string, anrede: AnredeWahl, text: string, path = RUECKFRAGEN_PATH): Rueckfrage | null {
  return patch(id, (r) => {
    r.anrede = anrede;
    r.text = text;
    r.anredeGeaendert = true;
  }, path);
}

export function setzeStatus(id: string, status: RueckfrageStatus, meldung = "", path = RUECKFRAGEN_PATH): Rueckfrage | null {
  return patch(id, (r) => {
    r.status = status;
    r.meldung = meldung;
  }, path);
}

/** Der persoenliche Teil (2. Absatz) einer Erst-Nachricht, fuer ki_verbesserungen.md */
export function persoenlicherTeil(text: string): string {
  const abs = text.split(/\n\s*\n/);
  return (abs[2] ?? abs[1] ?? "").trim();
}

// ── Verfall und Sende-Lauf ────────────────────────────────────────────────────

/** Offene Rueckfragen von gestern oder von heute nach VERFALL_H → verfallen + Liste auf /kurse. Liefert die verfallenen. */
export function verfallenLassen(now = new Date(), path = RUECKFRAGEN_PATH, markiertPath = MARKIERT_PATH): Rueckfrage[] {
  const s = loadRueckfragen(path);
  const tag = zurichDay(now);
  const out: Rueckfrage[] = [];
  for (const r of s.items) {
    if (r.status !== "offen") continue;
    if (r.tag < tag || (r.tag === tag && zurichHour(now) >= VERFALL_H)) {
      r.status = "verfallen";
      if (r.probe) continue;
      addMarkiert({ id: r.id, titel: r.titel, link: r.link, grund: `Rückfrage unbeantwortet: ${r.grund}`, am: now.toISOString() }, markiertPath);
      out.push(r);
    }
  }
  if (out.length) save(s, path);
  return out;
}

export const freigegebene = (path = RUECKFRAGEN_PATH) => loadRueckfragen(path).items.filter((r) => r.status === "freigegeben" && !r.probe);

/** Freigaben gesammelt: SAMMEL_MIN nach dem letzten Knopfdruck darf der Sende-Lauf starten */
export function sendeLaufFaellig(now = new Date(), path = RUECKFRAGEN_PATH): boolean {
  const f = freigegebene(path);
  if (!f.length) return false;
  const last = Math.max(...f.map((r) => new Date(r.aktionAm ?? r.erstelltAm).getTime()));
  return now.getTime() - last >= SAMMEL_MIN * 60_000;
}

/** Zusammenfassung fuer den Abend: offen, freigegeben (warten), gesendet, uebersprungen, verfallen — heute */
export function tagesStand(tag: string, path = RUECKFRAGEN_PATH): Record<RueckfrageStatus, number> & { folge: Folge } {
  const s = loadRueckfragen(path);
  const n: Record<RueckfrageStatus, number> = { offen: 0, freigegeben: 0, gesendet: 0, uebersprungen: 0, verfallen: 0, fehler: 0 };
  for (const r of s.items) if (!r.probe && (r.tag === tag || r.status === "offen" || r.status === "freigegeben")) n[r.status]++;
  return { ...n, folge: s.folge };
}
