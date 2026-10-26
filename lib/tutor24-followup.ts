/**
 * Regeln und Texte fuer das Nachfassen mit dem Gruppenkurs-Angebot.
 * Bewusst ohne Node- und Playwright-Abhaengigkeiten: die Live-Vorschau im
 * Browser (components/Tutor24Followup.tsx) benutzt dieselben Funktionen.
 */

export type Anrede = "Sie" | "du";

/** Stufen, fuer die es ein Angebot gibt. */
export const OFFER_LEVELS = ["gymivorbereitung", "gymi", "matura", "bm", "sek"] as const;
export type OfferLevel = (typeof OFFER_LEVELS)[number];
export type LevelCategory = OfferLevel | "ausgeschlossen" | "unklar";

export const LEVEL_LABEL: Record<LevelCategory, string> = {
  gymivorbereitung: "Gymi-Vorbereitung",
  gymi: "Gymnasium",
  matura: "Matura",
  bm: "Berufsmatura",
  sek: "Sekundarschule",
  ausgeschlossen: "Ausgeschlossen",
  unklar: "Unklar",
};

export const isOfferLevel = (c: string): c is OfferLevel => (OFFER_LEVELS as readonly string[]).includes(c);

const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_AGE_DAYS = 3;
export const MAX_AGE_DAYS = 8 * 7;
export const MAX_SENDS_PER_DAY = 25;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, mär: 2, apr: 3, may: 4, mai: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, okt: 9, nov: 10, dec: 11, dez: 11,
};

/** tutor24 schreibt "25 Oct 26, 09:37" bzw. "Do 22 Okt 26"; Uhrzeit optional. Letztes Vorkommen gewinnt. */
export function parseTutor24Date(text: string): Date | null {
  const re = /(\d{1,2})\.? ([A-Za-zä]{3})[a-z]*\.? (\d{2,4})(?:,? (\d{1,2}):(\d{2}))?/g;
  let last: Date | null = null;
  for (const m of Array.from(text.matchAll(re))) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month === undefined) continue;
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    last = new Date(year, month, Number(m[1]), Number(m[4] ?? 12), Number(m[5] ?? 0));
  }
  return last;
}

export function ageDays(date: Date, now: Date): number {
  return (now.getTime() - date.getTime()) / DAY_MS;
}

export function isMathSubject(subjects: string): boolean {
  return /mathe/i.test(subjects);
}

// ── Stufen-Klassifizierung ────────────────────────────────────────────────────

export type ListingInfo = {
  /** Titel des Inserats */
  title: string;
  /** Feld "Fach" */
  fach: string;
  /** Feld "Schulstufe" */
  schulstufe: string;
  /** Freitext "Zusaetzliche Informationen" */
  description: string;
};

export type Classification = { category: LevelCategory; begruendung: string };

/** Fundstelle mit etwas Kontext, damit die Begruendung in der Vorschau lesbar ist. */
function snippet(source: string, re: RegExp): string | null {
  const m = re.exec(source);
  if (!m) return null;
  const from = Math.max(0, m.index - 35);
  const to = Math.min(source.length, m.index + m[0].length + 35);
  return `${from > 0 ? "…" : ""}${source.slice(from, to).replace(/\s+/g, " ").trim()}${to < source.length ? "…" : ""}`;
}

/**
 * Genau eine Kategorie pro Inserat. Die Reihenfolge der Regeln ist die Logik:
 * die spezifischere gewinnt (BM vor Matura, Gymi-Ziel vor Primar/Sek, Matura vor Gymi).
 */
export function classifyListing(info: ListingInfo): Classification {
  if (!isMathSubject(info.fach)) return { category: "ausgeschlossen", begruendung: `Fach: ${info.fach || "—"}` };

  const stufe = info.schulstufe.toLowerCase();
  const text = `${info.title}\n${info.description}`;
  const field = `Schulstufe: ${info.schulstufe}`;
  const rules: Array<{ category: LevelCategory; re: RegExp; onField?: boolean }> = [
    { category: "ausgeschlossen", re: /erwachsen/i },
    { category: "bm", re: /berufsmatur|\bbms\b|\bbm\b|\bbm-|lehre mit (der )?bm|bm[- ]?aufnahme/i },
    {
      category: "gymivorbereitung",
      re: /aufnahmepr[üu]fung|\bzap\b|gymi-?pr[üu]fung|(ins|ans|aufs) (gymi|gymnasium|kanti|langgymi|kurzgymi)|vorbereitung (auf|f[üu]r) (das |die |den )?(gymi|gymnasium|kanti|lang|kurz)|(lang|kurz)zeit-?gymi(nasium)?[- ]?(pr[üu]fung|vorbereitung)/i,
    },
    { category: "ausgeschlossen", re: /universit|hochschule|\beth\b|\buzh\b|studium|studiere/i, onField: true },
    { category: "ausgeschlossen", re: /studentin an der|student an der|ich studiere/i },
    { category: "matura", re: /matura|maturit[äa]t|matur\b|maturpr[üu]fung|maturjahr|letzte[sn]? (gymi|gymnasium)[- ]?jahr/i },
    { category: "gymi", re: /gymnasium|\bgymi\b|kantonsschule|\bkanti\b|probezeit|untergymnasium|unterstufe/i },
    { category: "sek", re: /sekundar|\bsek\b|\d\.\s?sek|oberstufe|bezirksschule|realschule/i },
    { category: "ausgeschlossen", re: /primar|\b[1-6]\.\s?klasse\b/i },
  ];

  for (const rule of rules) {
    // Hochschul-Regel nur auf das Stufen-Feld: im Freitext ist "Studium" oft nur ein Ziel.
    const inField = rule.re.test(stufe) ? field : null;
    const hit = rule.onField ? inField : (snippet(text, rule.re) ?? inField);
    if (hit) return { category: rule.category, begruendung: hit };
  }
  return { category: "unklar", begruendung: info.schulstufe ? field : "keine Stufe erkennbar" };
}

/** "du" nur, wenn das Inserat klar vom Schueler selbst stammt; sonst immer "Sie". */
export function detectAnrede(description: string): Anrede {
  const d = description.toLowerCase();
  const parent = /\b(mein(e|en)?|unser(e|en)?) (sohn|söhne|tochter|töchter|kind|kinder)\b/;
  if (parent.test(d)) return "Sie";
  const self = /\b(ich suche|ich bin \d{2}|ich bin in der|ich brauche|ich gehe|ich besuche|meine (prüfung|matura|bm)|bin \d{2} jahre)\b/;
  const age = d.match(/\bich bin (\d{2})\b|\b(\d{2}) jahre alt\b/);
  const ageNum = age ? Number(age[1] ?? age[2]) : null;
  if (ageNum !== null && ageNum < 16) return "Sie";
  return self.test(d) ? "du" : "Sie";
}

// ── Einstellungen und Nachrichtentext ─────────────────────────────────────────

export type LevelSettings = {
  enabled: boolean;
  /** ISO-Datum "YYYY-MM-DD" */
  startDate: string;
  /** vier Samstage, ISO */
  saturdays: [string, string, string, string];
  /** z.B. "9:30–11:10 Uhr" */
  time: string;
  pricePerLesson: number;
  lessons: number;
  mode: "online" | "vor Ort";
  /** Sie-Form mit {vorname} {daten} {uhrzeit} {preis} {total} {ort} {start} */
  template: string;
};

export type FollowupSettings = Record<OfferLevel, LevelSettings>;

export const PLACEHOLDERS = ["{vorname}", "{daten}", "{uhrzeit}", "{preis}", "{total}", "{ort}", "{start}"] as const;

const INTRO =
  "Ich hatte mich vor einiger Zeit auf Ihre Anfrage für Mathe-Nachhilfe gemeldet. Falls Sie noch suchen, habe ich ein neues, deutlich günstigeres Angebot:";
const CLOSING =
  'Soll ich einen Platz reservieren? Ein kurzes "Ja" hier im Chat reicht, dann schicke ich alle Details. Die Gruppe startet ab 3 Anmeldungen.\n\nLiebe Grüsse\nOmid';
const SCHEDULE = "Maximal 6 Teilnehmende, an 4 Samstagen ({daten}), jeweils {uhrzeit}, {ort}.";
const EXPERT = "sehr erfahrenen Mathe-Lehrer (über 12 Jahre Erfahrung, Schwerpunkt Gymi und Matura), aber zu CHF {preis} pro Lektion statt CHF 89 im Einzelunterricht.";

const GYMI_SEK_TEMPLATE = [
  "Hallo {vorname}",
  INTRO,
  `Ende November starte ich eine kleine Mathe-Gruppe für Gymi- und Sek-Schülerinnen und -Schüler. ${SCHEDULE}`,
  `Ihr Kind lernt bei einem ${EXPERT} Dazu kommt Zugang zu meiner Übungsplattform: Ihr Kind übt zwischen den Terminen, und ich sehe genau, wo es steht.`,
  CLOSING,
].join("\n\n");

const examTemplate = (exam: string) =>
  [
    "Hallo {vorname}",
    INTRO,
    `Ende November starte ich eine kleine Mathe-Gruppe zur Vorbereitung auf die ${exam}. ${SCHEDULE}`,
    `Unterricht bei einem ${EXPERT} Dazu kommt Zugang zu meiner Übungsplattform: Üben zwischen den Terminen, und ich sehe genau, wo jemand steht.`,
    CLOSING,
  ].join("\n\n");

const DEFAULT_TEMPLATES: Record<OfferLevel, string> = {
  gymivorbereitung: [
    "Hallo {vorname}",
    INTRO,
    `Ende November starte ich eine kleine Mathe-Gruppe zur Vorbereitung auf die Gymi-Aufnahmeprüfung. ${SCHEDULE}`,
    "Ihr Kind lernt bei einem sehr erfahrenen Mathe-Lehrer (über 12 Jahre Erfahrung mit Gymi-Prüfung, Gymnasium und Matura), aber zu CHF {preis} pro Lektion statt CHF 89 im Einzelunterricht. Dazu kommt Zugang zu meiner Übungsplattform: Ihr Kind übt zwischen den Terminen typische Prüfungsaufgaben, und ich sehe genau, wo es steht.",
    CLOSING,
  ].join("\n\n"),
  gymi: GYMI_SEK_TEMPLATE,
  sek: GYMI_SEK_TEMPLATE,
  matura: examTemplate("Matura"),
  bm: examTemplate("Berufsmatura (BM)"),
};

export function defaultSettings(): FollowupSettings {
  const base = (level: OfferLevel): LevelSettings => ({
    enabled: false,
    startDate: "2026-11-28",
    saturdays: ["2026-11-28", "2026-12-05", "2026-12-12", "2026-12-19"],
    time: "9:30–11:10 Uhr",
    pricePerLesson: 45,
    lessons: 8,
    mode: "online",
    template: DEFAULT_TEMPLATES[level],
  });
  return Object.fromEntries(OFFER_LEVELS.map((l) => [l, base(l)])) as FollowupSettings;
}

/** Gespeicherte Einstellungen auf Vollstaendigkeit bringen (neue Felder, fehlende Stufen). */
export function mergeSettings(saved: Partial<Record<OfferLevel, Partial<LevelSettings>>> | null | undefined): FollowupSettings {
  const d = defaultSettings();
  for (const l of OFFER_LEVELS) d[l] = { ...d[l], ...(saved?.[l] ?? {}) } as LevelSettings;
  return d;
}

/** "2026-11-28" → "28.11." */
function dayMonth(iso: string): string {
  const [, m, day] = iso.split("-").map(Number);
  return m && day ? `${day}.${m}.` : iso;
}

export function formatSaturdays(dates: string[]): string {
  const parts = dates.filter(Boolean).map(dayMonth);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} und ${parts[parts.length - 1]}` : parts.join("");
}

/**
 * Sie → du fuer die Saetze der Vorlagen. Bleibt danach noch eine Sie-Form uebrig
 * (eigener Text), gilt die du-Form als nicht ableitbar.
 */
const DU_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bIhre Anfrage\b/g, "deine Anfrage"],
  [/\bFalls Sie noch suchen\b/g, "Falls du noch suchst"],
  [/\bIhr Kind lernt\b/g, "Du lernst"],
  [/\bIhr Kind übt\b/g, "Du übst"],
  [/\bwo es steht\b/g, "wo du stehst"],
  [/\bwo jemand steht\b/g, "wo du stehst"],
];
const SIE_LEFT = /\b(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen|Ihr Kind)\b/;

export function toDuForm(sieText: string): { text: string; ok: boolean } {
  let t = sieText;
  for (const [re, rep] of DU_REPLACEMENTS) t = t.replace(re, rep);
  return { text: t, ok: !SIE_LEFT.test(t) };
}

export type Rendered = { text: string; anrede: Anrede; warning?: string };

/** Fertige Nachricht aus den AKTUELLEN Einstellungen. */
export function renderMessage(s: LevelSettings, firstName: string, wantAnrede: Anrede): Rendered {
  const values: Record<string, string> = {
    "{vorname}": firstName.trim(),
    "{daten}": formatSaturdays(s.saturdays),
    "{uhrzeit}": s.time.trim(),
    "{preis}": String(s.pricePerLesson),
    "{total}": String(s.pricePerLesson * s.lessons),
    "{ort}": s.mode,
    "{start}": dayMonth(s.startDate),
  };
  let text = s.template;
  for (const [k, v] of Object.entries(values)) text = text.split(k).join(v);
  // Ohne Vorname: "Hallo" ohne Leerzeichen dahinter.
  text = text.replace(/[ \t]+\n/g, "\n").replace(/ß/g, "ss").trim();
  if (wantAnrede === "Sie") return { text, anrede: "Sie" };
  const du = toDuForm(text);
  return du.ok
    ? { text: du.text, anrede: "du" }
    : { text, anrede: "Sie", warning: "du-Form nicht ableitbar (eigener Text) — Sie-Form verwendet" };
}

/** Sicherheitsnetz fuer die Regel "keine Telefonnummern, Links, E-Mails". */
export function containsForbiddenContact(text: string): boolean {
  return /https?:\/\/|www\.|@|\b\d{3}[ ./-]?\d{3}[ ./-]?\d{2}[ ./-]?\d{2}\b/.test(text);
}

/** Pruefung beim Speichern: was falsch ist, als Liste von Meldungen. */
export function validateSettings(s: FollowupSettings): string[] {
  const errors: string[] = [];
  for (const l of OFFER_LEVELS) {
    const v = s[l];
    const name = LEVEL_LABEL[l];
    if (containsForbiddenContact(v.template)) errors.push(`${name}: Text enthält Link, E-Mail oder Telefonnummer.`);
    if (!v.template.trim()) errors.push(`${name}: Text ist leer.`);
    const unknown = v.template.match(/\{[a-zäöü]+\}/g)?.filter((p) => !(PLACEHOLDERS as readonly string[]).includes(p));
    if (unknown?.length) errors.push(`${name}: unbekannter Platzhalter ${unknown.join(", ")}.`);
    if (!(v.pricePerLesson > 0) || !(v.lessons > 0)) errors.push(`${name}: Preis und Anzahl Lektionen müssen > 0 sein.`);
    if (v.saturdays.length !== 4 || v.saturdays.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) errors.push(`${name}: bitte vier Samstage angeben.`);
  }
  return errors;
}

// ── CSV (Semikolon + BOM, damit Excel mit Schweizer Einstellungen es direkt oeffnet) ──

export const PREVIEW_COLS = [
  "status", "conversation_id", "link", "name", "kategorie", "begruendung", "stufe", "fach",
  "letzte_nachricht", "anrede", "grund", "nachricht",
] as const;
export const LOG_COLS = ["conversation_id", "zeitstempel", "variante", "status"] as const;

export type PreviewRow = Record<(typeof PREVIEW_COLS)[number], string>;

export function toCsv(rows: Record<string, string>[], columns: readonly string[]): string {
  const esc = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return "﻿" + [columns.join(";"), ...rows.map((r) => columns.map((c) => esc(r[c] ?? "")).join(";"))].join("\r\n") + "\r\n";
}

export function parseCsv(text: string): Record<string, string>[] {
  const src = text.replace(/^﻿/, "");
  const sep = src.split(/\r?\n/, 1)[0].includes(";") ? ";" : ",";
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) records.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((f) => f !== "")) records.push(row); }
  if (records.length === 0) return [];
  const [header, ...data] = records;
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}
