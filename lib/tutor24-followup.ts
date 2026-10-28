/**
 * Regeln und Texte fuer das Nachfassen mit Gruppenkursen.
 * Bewusst ohne Node- und Playwright-Abhaengigkeiten: die Live-Vorschau im
 * Browser (components/Tutor24Followup.tsx) benutzt dieselben Funktionen.
 * Alles regelbasiert und lokal — Inseratstexte gehen an keinen externen Dienst.
 */

export type Anrede = "Sie" | "du";

/** Stufen, fuer die es Kurse geben kann. */
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
/** Mehr gleichzeitig aktive Kurse verteilen die Anmeldungen zu duenn. */
export const MAX_ACTIVE_COURSES = 3;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, mär: 2, apr: 3, may: 4, mai: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, okt: 9, nov: 10, dec: 11, dez: 11,
};
const DATE_RE = /(\d{1,2})\.? ([A-Za-zä]{3})[a-z]*\.? (\d{2,4})(?:,? (\d{1,2}):(\d{2}))?/g;

/** tutor24 schreibt "25 Oct 26, 09:37" bzw. "Do 22 Okt 26"; Uhrzeit optional. Letztes Vorkommen gewinnt. */
export function parseTutor24Date(text: string): Date | null {
  let last: Date | null = null;
  for (const m of Array.from(text.matchAll(DATE_RE))) {
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

// ── Inserat ───────────────────────────────────────────────────────────────────

export type ListingInfo = {
  /** Titel des Inserats */
  title: string;
  /** Feld "Fach" */
  fach: string;
  /** Feld "Schulstufe" */
  schulstufe: string;
  /** Freitext "Zusaetzliche Informationen" */
  description: string;
  /** Feld "Ort", falls die Seite eines hat */
  ort?: string;
};

/** Fundstelle mit etwas Kontext, damit die Begruendung in der Vorschau lesbar ist. */
function snippet(source: string, re: RegExp): string | null {
  const m = re.exec(source);
  if (!m) return null;
  const from = Math.max(0, m.index - 35);
  const to = Math.min(source.length, m.index + m[0].length + 35);
  return `${from > 0 ? "…" : ""}${source.slice(from, to).replace(/\s+/g, " ").trim()}${to < source.length ? "…" : ""}`;
}

/** "zweiten Jahr" → "2. Jahr", damit die Zahl-Regeln greifen. */
function normalize(text: string): string {
  const words: Record<string, string> = { erst: "1", zweit: "2", dritt: "3", viert: "4", "fünft": "5", sechst: "6" };
  return text
    .toLowerCase()
    .replace(/\b(erst|zweit|dritt|viert|fünft|sechst)(e|en|er|es)\b/g, (_m, w: string) => `${words[w]}.`);
}

// ── Faecher ───────────────────────────────────────────────────────────────────

export const SUBJECTS = [
  "Mathe", "Physik", "Chemie", "Biologie", "Deutsch", "Französisch", "Englisch",
  "Italienisch", "Spanisch", "Latein", "Informatik", "Wirtschaft",
] as const;
export type Subject = (typeof SUBJECTS)[number];

// Deutsch, Englisch, Franzoesisch auch auf Englisch/Franzoesisch: die Inserate sind oft mehrsprachig.
const SUBJECT_RE: Record<Subject, RegExp> = {
  Mathe: /\bmath|algebra|geometrie|analysis|stochastik/,
  Physik: /physi[kc]/,
  Chemie: /chemi/,
  Biologie: /biologi|\bbio\b/,
  Deutsch: /deutsch|\bgerman\b|allemand/,
  Französisch: /franz|french|fran[çc]ais/,
  Englisch: /englisch|english|anglais/,
  Italienisch: /italienisch|italian/,
  Spanisch: /spanisch|spanish/,
  Latein: /latein|latin/,
  Informatik: /informatik|programmier|computer science/,
  Wirtschaft: /wirtschaft|rechnungswesen|buchhaltung|\bw&r\b/,
};

/** Alle genannten Faecher, in der Reihenfolge ihrer ersten Nennung (Fach-Feld zuerst). */
export function extractSubjects(info: ListingInfo): string[] {
  // "auf Deutsch" / "Schweizerdeutsch" ist die Unterrichtssprache, kein Fach.
  const text = `${info.fach}\n${info.title}\n${info.description}`
    .toLowerCase()
    .replace(/(auf|in) (hoch|schweizer)?deutsch|(schweizer|hoch)deutsch|deutschsprachig|in english|auf englisch/g, " ");
  const found = SUBJECTS.map((s) => ({ s, i: text.search(SUBJECT_RE[s]) }))
    .filter((x) => x.i > -1)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s as string);
  // Unbekanntes Fach: Feld uebernehmen, damit die Zeile nicht leer bleibt.
  return found.length ? found : info.fach.trim() ? [info.fach.trim()] : [];
}

export const joinList = (xs: string[]) => xs.join(", ");
export const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

// ── Stufen-Klassifizierung ────────────────────────────────────────────────────

export type Classification = { category: LevelCategory; begruendung: string };

/**
 * Genau eine Kategorie pro Inserat, unabhaengig vom Fach (das prueft die Kurszuordnung).
 * Die Reihenfolge der Regeln ist die Logik: die spezifischere gewinnt
 * (BM vor Matura, Gymi-Ziel vor Primar/Sek, Matura vor Gymi).
 */
export function classifyListing(info: ListingInfo): Classification {
  const stufe = info.schulstufe.toLowerCase();
  const text = `${info.title}\n${info.description}`;
  const field = `Schulstufe: ${info.schulstufe}`;
  const rules: Array<{ category: LevelCategory; re: RegExp; onField?: boolean; when?: RegExp }> = [
    { category: "ausgeschlossen", re: /erwachsen/i },
    { category: "bm", re: /berufsmatur|\bbms\b|\bbm\b|\bbm-|lehre mit (der )?bm|bm[- ]?aufnahme/i },
    {
      category: "gymivorbereitung",
      re: /aufnahmepr[üu]fung|\bzap\b|gymi-?pr[üu]fung|(ins|ans|aufs) (gymi|gymnasium|kanti|langgymi|kurzgymi)|vorbereitung (auf|f[üu]r) (das |die |den )?(gymi|gymnasium|kanti|lang|kurz)|(lang|kurz)zeit-?gymi(nasium)?[- ]?(pr[üu]fung|vorbereitung)/i,
    },
    // Primar-/Sek-Schueler mit Gymi im Text wollen dorthin ("spaeter die Kantonsschule besuchen").
    { category: "gymivorbereitung", re: /gymi|gymnasium|\bkanti\b|kantonsschule/i, when: /primar|sekundar/ },
    // Primarschueler mit Sek im Text wollen dorthin ("Sekundarschul-Pruefung") — Primarstufe biete ich nicht an.
    { category: "ausgeschlossen", re: /sekundar|\bsek\b/i, when: /primar/ },
    { category: "ausgeschlossen", re: /universit|hochschule|\beth\b|\buzh\b|studium|studiere/i, onField: true },
    { category: "ausgeschlossen", re: /studentin an der|student an der|ich studiere/i },
    { category: "matura", re: /matura|maturit[äa]t|matur\b|maturpr[üu]fung|maturjahr|letzte[sn]? (gymi|gymnasium)[- ]?jahr/i },
    { category: "gymi", re: /gymnasium|\bgymi\b|kantonsschule|\bkanti\b|probezeit|untergymnasium|unterstufe/i },
    { category: "sek", re: /sekundar|\bsek\b|\d\.\s?sek|oberstufe|bezirksschule|realschule/i },
    { category: "ausgeschlossen", re: /primar|\b[1-6]\.\s?klasse\b/i },
  ];

  for (const rule of rules) {
    if (rule.when && !rule.when.test(stufe)) continue;
    // Hochschul-Regel nur auf das Stufen-Feld: im Freitext ist "Studium" oft nur ein Ziel.
    const inField = !rule.when && rule.re.test(stufe) ? field : null;
    const hit = rule.onField ? inField : (snippet(text, rule.re) ?? inField);
    if (hit) return { category: rule.category, begruendung: hit };
  }
  return { category: "unklar", begruendung: info.schulstufe ? field : "keine Stufe erkennbar" };
}

// ── Klasse, Kursgruppe ────────────────────────────────────────────────────────

export type Grade = {
  /** Schuljahr ab der 1. Primar: Sek 2 → 8 */
  klasse: number | null;
  /** Jahr im Gymnasium, Langzeit-Zaehlung: 1. Kurzgymi = 3 */
  gymiJahr: number | null;
  /** true = Kurzgymi, false = Langgymi, null = nicht genannt */
  kurz: boolean | null;
};

// "6. Klasse Gymiprüfung" ist kein Gymi-Jahr: Pruefung/Vorbereitung direkt dahinter ausschliessen.
const GYMI = "(?:lang|kurz)?(?:zeit)?-?(?:gymi|gymnasium|gymnasiums|kanti|kantonsschule)(?![- ]?(?:pr[üu]fung|vorbereitung))";

export function extractGrade(info: ListingInfo): Grade {
  const t = normalize(`${info.schulstufe}\n${info.title}\n${info.description}`);
  const kurz = /kurzgymi|kurzzeit/.test(t) ? true : /langgymi|langzeit|untergymi/.test(t) ? false : null;
  const num = (re: RegExp) => {
    const m = t.match(re);
    return m ? Number(m[1]) : null;
  };

  // "2. Gymi", "2. Klasse am Gymi", "2. Jahr des Kurzzeitgymnasiums", "Gymi 2", "Y3 Gymi"
  let gymi =
    num(new RegExp(`\\b(\\d{1,2})\\.\\s?(?:klasse|jahr|gymi-?jahr)?\\s?(?:des|der|im|am|an der|in der|vom)?\\s?${GYMI}`)) ??
    num(new RegExp(`\\b(?:gymi|gymnasium|kanti)\\s?(\\d)\\b`)) ??
    num(new RegExp(`\\b(?:y|year )(\\d)\\s?${GYMI}`));
  let klasse: number | null = null;
  if (gymi !== null && gymi >= 7) {
    // "9. Klasse am Gymi" zaehlt Schuljahre.
    klasse = gymi;
    gymi = gymi - 6;
  } else if (gymi !== null && kurz) gymi += 2;
  if (gymi === null && /letzte[nsm]? (gymi-?)?jahr|maturajahr|maturaklasse/.test(t) && /gymi|gymnasium|kanti|matur/.test(t)) gymi = 6;
  if (gymi !== null && !(gymi >= 1 && gymi <= 6)) gymi = null;

  const sek = num(/\b([1-3])\.\s?(?:klasse\s)?(?:der\s)?(?:sek|sekundar|oberstufe)/) ?? num(/\bsek\s?([1-3])\b/);
  if (klasse === null && sek !== null) klasse = 6 + sek;
  if (klasse === null) {
    const k = num(/\b(\d{1,2})\.\s?klasse/);
    if (k !== null && k >= 1 && k <= 12) klasse = k;
  }
  if (klasse === null && gymi !== null) klasse = 6 + gymi;
  return { klasse, gymiJahr: gymi, kurz };
}

export const COURSE_GROUPS = [
  "sek1", "sek2", "sek3", "zap_lang", "zap_kurz", "gymi_unter", "gymi_mittel", "matura", "bm", "offen",
] as const;
export type CourseGroup = (typeof COURSE_GROUPS)[number];

export const GROUP_LABEL: Record<CourseGroup, string> = {
  sek1: "Sek 1. Jahr",
  sek2: "Sek 2. Jahr",
  sek3: "Sek 3. Jahr",
  zap_lang: "Gymi-Vorbereitung Langgymi (ZAP)",
  zap_kurz: "Gymi-Vorbereitung Kurzgymi (ZAP)",
  gymi_unter: "Gymi Unterstufe (1.–2. Jahr)",
  gymi_mittel: "Gymi Mittelstufe (3.–4. Jahr)",
  matura: "Matura",
  bm: "Berufsmatura",
  offen: "Stufe offen (nachfragen)",
};

/** Kurzform fuer Kursnamen: "Mathe-Repetitionskurs 2. Sek". */
const GROUP_SHORT: Record<CourseGroup, string> = {
  sek1: "1. Sek", sek2: "2. Sek", sek3: "3. Sek",
  zap_lang: "für die Langgymi-Prüfung", zap_kurz: "für die Kurzgymi-Prüfung",
  gymi_unter: "Gymi Unterstufe", gymi_mittel: "Gymi Mittelstufe",
  matura: "für die Matura", bm: "für die Berufsmatura", offen: "",
};

export const isCourseGroup = (g: string): g is CourseGroup => (COURSE_GROUPS as readonly string[]).includes(g);

/** hoch = Stufe und Jahr stehen im Inserat; mittel = abgeleitet; tief = Jahr unbekannt ("offen"). */
export type Sicherheit = "hoch" | "mittel" | "tief";

export function courseGroup(category: LevelCategory, g: Grade, info: ListingInfo): { gruppe: CourseGroup | null; sicherheit: Sicherheit } {
  const t = normalize(`${info.schulstufe}\n${info.title}\n${info.description}`);
  const hit = (gruppe: CourseGroup, sicherheit: Sicherheit = "hoch") => ({ gruppe, sicherheit });
  // Stufe passt, Jahr fehlt: "offen" — dort fragt die Nachricht nach der genauen Stufe.
  const none = { gruppe: "offen" as const, sicherheit: "tief" as const };
  switch (category) {
    case "bm": return hit("bm");
    case "matura": return hit("matura");
    case "sek":
      return g.klasse === 7 ? hit("sek1") : g.klasse === 8 ? hit("sek2") : g.klasse === 9 ? hit("sek3") : none;
    case "gymivorbereitung":
      if (g.kurz !== null) return hit(g.kurz ? "zap_kurz" : "zap_lang");
      if (g.klasse !== null) return g.klasse <= 6 ? hit("zap_lang") : hit("zap_kurz");
      if (/primar/.test(t)) return hit("zap_lang", "mittel");
      if (/sekundar|\bsek\b/.test(t)) return hit("zap_kurz", "mittel");
      return none;
    case "gymi":
      if (g.gymiJahr !== null)
        return g.gymiJahr <= 2 ? hit("gymi_unter") : g.gymiJahr <= 4 ? hit("gymi_mittel") : hit("matura", g.gymiJahr === 6 ? "hoch" : "mittel");
      if (/untergymi|unterstufe/.test(t)) return hit("gymi_unter");
      // Probezeit ohne Jahr: im Langgymi das 1., im Kurzgymi das 3. Jahr.
      if (/probezeit/.test(t)) return hit(g.kurz ? "gymi_mittel" : "gymi_unter", "mittel");
      return none;
    default:
      return none;
  }
}

// ── Ort, Zeitwunsch, Anlass ───────────────────────────────────────────────────

export type OrtMode = "online" | "vor Ort" | "beides" | "unbekannt";

// ponytail: kurze Staedteliste; reicht fuer die Region Zuerich, sonst greift die PLZ-Regel.
const CITIES = [
  "Zürich", "Winterthur", "Uster", "Dübendorf", "Wädenswil", "Horgen", "Thalwil", "Kloten", "Dietikon",
  "Schlieren", "Wetzikon", "Bülach", "Meilen", "Küsnacht", "Adliswil", "Baden", "Aarau", "Zug", "Luzern",
  "Basel", "Bern", "St. Gallen", "Rapperswil", "Opfikon", "Wallisellen", "Regensdorf", "Volketswil", "Stäfa",
];

export function extractOrt(info: ListingInfo): { ort: OrtMode; ortsname: string } {
  const t = info.description.toLowerCase();
  const online = /online|zoom|\bteams\b|skype|per video|videocall|video-call|fernunterricht|remote/.test(t);
  const vorOrt = /vor ort|bei uns|zu hause|zuhause|daheim|pers[öo]nlich|präsenz|in person|in der n[äa]he|at our home|at home/.test(t);
  const both = /beides|egal ob|sowohl .{0,20}als auch|online oder (vor ort|pers|bei)|(vor ort|pers[öo]nlich|zuhause) oder online/.test(t);
  const ort: OrtMode = both || (online && vorOrt) ? "beides" : online ? "online" : vorOrt ? "vor Ort" : "unbekannt";
  const plz = info.description.match(/\b[1-9]\d{3} ([A-ZÄÖÜ][a-zäöüé]+(?:[ -][A-ZÄÖÜ][a-zäöüé]+)?)/);
  const city = CITIES.find((c) => new RegExp(`\\b${c.replace(".", "\\.")}\\b`).test(`${info.title} ${info.description}`));
  return { ort, ortsname: (info.ort ?? "").trim() || plz?.[1] || city || "" };
}

const DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const DAYTIMES: Array<[RegExp, string]> = [
  [/wochenende|weekend/, "Wochenende"],
  [/\bmorgens|am morgen|vormittag/, "Vormittag"],
  [/\bmittags|über mittag|mittagspause/, "Mittag"],
  [/nachmittag/, "Nachmittag"],
  [/\babends?\b|am abend|feierabend/, "Abend"],
  [/nach der schule/, "nach der Schule"],
];

/** Wochentage und Tageszeiten, falls genannt; leer = keine Angabe. */
export function extractZeitwunsch(info: ListingInfo): string[] {
  const t = info.description.toLowerCase();
  const out = DAYS.filter((d) => new RegExp(`\\b${d.toLowerCase()}s?\\b`).test(t));
  for (const [re, label] of DAYTIMES) if (re.test(t)) out.push(label);
  const from = t.match(/\bab (\d{1,2})(?:[:.](\d{2}))? ?uhr/);
  if (from) out.push(`ab ${from[1]}${from[2] ? `:${from[2]}` : ""} Uhr`);
  return out;
}

const ANLASS: Array<[RegExp, string]> = [
  [/aufnahmepr[üu]fung|\bzap\b|gymi-?pr[üu]fung|bm-?aufnahme/, "Aufnahmeprüfung"],
  [/probezeit|provisorisch/, "Probezeit"],
  [/matur(a|it[äa]t)?-?pr[üu]fung|abschlusspr[üu]fung|schlusspr[üu]fung|\blap\b|bm-?pr[üu]fung|(die )?matura (schreiben|ablegen|bestehen)|schreibe .{0,30}matura/, "Abschlussprüfung"],
  [/pr[üu]fung|\btests?\b|klausur|\bexam/, "Prüfung"],
  [/promotion|ungen[üu]gend|schlechte note|note[n]? (verbessern|aufbessern)|zeugnis/, "Noten verbessern"],
  [/l[üu]cken|grundlagen|repetier|aufholen|nachholen|verst[äa]ndnis|m[üu]he|schwierigkeit|f[äa]llt .{0,20}schwer|unterst[üu]tzung|struggl/, "Lücken allgemein"],
];

export function extractAnlass(info: ListingInfo): string {
  const t = `${info.title}\n${info.description}`.toLowerCase();
  return ANLASS.find(([re]) => re.test(t))?.[1] ?? "unbekannt";
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

/** Alles, was der Probelauf pro Inserat in die CSV schreibt (nur kurze Werte, kein Inseratstext). */
export function analyzeListing(info: ListingInfo) {
  const c = classifyListing(info);
  const grade = extractGrade(info);
  const group = isOfferLevel(c.category) ? courseGroup(c.category, grade, info) : { gruppe: null, sicherheit: "tief" as const };
  return {
    kategorie: c.category,
    begruendung: c.begruendung,
    faecher: joinList(extractSubjects(info)),
    klasse: grade.klasse === null ? "" : String(grade.klasse),
    gymi_jahr: grade.gymiJahr === null ? "" : String(grade.gymiJahr),
    kursgruppe: group.gruppe ?? "",
    sicherheit: group.sicherheit,
    ...extractOrt(info),
    zeitwunsch: joinList(extractZeitwunsch(info)),
    anlass: extractAnlass(info),
    anrede: detectAnrede(info.description),
  };
}

// ── Einstellungen ─────────────────────────────────────────────────────────────

export type FollowupSettings = {
  /** Nur diese Faecher zaehlen fuer Kurse und Vorschlaege. */
  mySubjects: string[];
  /** "Kurs empfohlen" ab so vielen Kandidaten mit Sicherheit "hoch" */
  recommendMin: number;
  /** Probelauf: Inseratseite nur oeffnen, wenn die Konversationsseite nicht reicht (needsListing). Standard aus. */
  listingOnDemand: boolean;
};

export function mergeSettings(saved: Partial<FollowupSettings> | null | undefined): FollowupSettings {
  return {
    mySubjects: Array.isArray(saved?.mySubjects) ? saved.mySubjects.map(String) : ["Mathe", "Physik"],
    recommendMin: Number(saved?.recommendMin) >= 1 ? Math.floor(Number(saved?.recommendMin)) : 20,
    listingOnDemand: saved?.listingOnDemand === true,
  };
}

// ── Inserat nur bei Bedarf ────────────────────────────────────────────────────

const labelled = (text: string, label: string) => text.match(new RegExp(`(?:^|\\n)${label}\\n([^\\n]+)`))?.[1]?.trim() ?? "";

/**
 * Was die Konversationsseite selbst ueber das Inserat zeigt (Kopfbereich ohne Nachrichten),
 * in derselben Form wie die Inseratseite. Fach/Schulstufe nur, wenn die Seite sie beschriftet.
 */
export function listingFromConversation(header: string): ListingInfo {
  return {
    title: "",
    fach: labelled(header, "Fach"),
    schulstufe: labelled(header, "Schulstufe"),
    description: header,
    ort: header.match(/\b[1-9]\d{3} [A-ZÄÖÜ][^\n]*/)?.[0]?.trim() ?? "",
  };
}

/**
 * Grund, warum die Inseratseite trotzdem geoeffnet werden muss; null = Konversationsseite reicht.
 * Widerspruch: Schulstufen-Feld und Freitext ergeben verschiedene Stufen.
 */
export function needsListing(a: ReturnType<typeof analyzeListing>, info: ListingInfo): string | null {
  if (a.kategorie === "unklar") return "Stufe unklar";
  if (!a.faecher) return "kein Fach";
  if (a.sicherheit !== "hoch") return `Sicherheit ${a.sicherheit}`;
  const byField = classifyListing({ ...info, title: "", description: "" }).category;
  const byText = classifyListing({ ...info, schulstufe: "" }).category;
  if (byField !== "unklar" && byText !== "unklar" && byField !== byText) return `Widerspruch ${byField}/${byText}`;
  return null;
}

/** Felder, die der Vergleichsmodus (--compare) zwischen beiden Varianten gegenueberstellt. */
export const COMPARE_FIELDS = ["kategorie", "faecher", "klasse", "gymi_jahr", "kursgruppe", "sicherheit", "anrede", "anlass", "ort"] as const;

export function compareAnalyses(
  convo: ReturnType<typeof analyzeListing>,
  full: ReturnType<typeof analyzeListing>
): Array<{ feld: string; nur_konversation: string; mit_inserat: string }> {
  return COMPARE_FIELDS.filter((f) => convo[f] !== full[f]).map((f) => ({ feld: f, nur_konversation: convo[f], mit_inserat: full[f] }));
}

// ── Konversationsliste (Zwischenspeicher, Aktivitaet) ─────────────────────────

export type ListSender = "ich" | "gegenseite" | "system" | "unbekannt";
export type ListEntry = {
  id: string;
  name: string;
  /** ISO-Datum der letzten Aktivitaet laut Liste, "" = nicht lesbar */
  date: string;
  lastSender: ListSender;
  unread: number;
  /** Pruefsumme des Nachrichten-Ausschnitts: aendert sich mit jeder neuen Nachricht (auch am selben Tag) */
  sig: string;
  link: string;
};
export type ListCache = Record<string, ListEntry>;

// Eigene Texte: die Erst-Nachricht ("… unterstütze ich dich in …") und das Nachfassen (FOLLOWUP_MARKER).
const MINE_RE = /unterst[üu]tze ich dich|ich unterrichte seit|ich hatte mich vor einiger zeit/i;
const REJECTED_RE = /nicht an ihrer bewerbung interessiert/i;

/**
 * Letzter Absender aus dem Listen-Ausschnitt. Nur positive Belege: Ungelesen kommt nie von mir,
 * die Absage ist ein fester Systemtext, "ich" nur mit meinem eigenen Wortlaut. Sonst "unbekannt".
 */
export function listSender(snippet: string, unread: number): ListSender {
  if (REJECTED_RE.test(snippet)) return "system";
  if (unread > 0) return "gegenseite";
  if (MINE_RE.test(snippet)) return "ich";
  return "unbekannt";
}

export function snippetSig(s: string): string {
  let h = 0;
  for (const ch of s.replace(/\s+/g, " ").trim()) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

/** Neue Aktivitaet seit dem letzten Lauf: Datum, letzter Absender oder Ausschnitt anders. */
export function entryChanged(prev: ListEntry | undefined, cur: ListEntry): boolean {
  return !prev || prev.date !== cur.date || prev.lastSender !== cur.lastSender || prev.sig !== cur.sig;
}

/**
 * Weiterscrollen noetig? null = ja, sonst der Grund zum Aufhoeren.
 * Die Liste ist nach letzter Aktivitaet sortiert: steht ein ganzer nachgeladener Block
 * unveraendert im Zwischenspeicher, ist auch alles darunter unveraendert.
 */
export function scrollStop(batch: ListEntry[], cache: ListCache, now: Date, maxAgeDays?: number): string | null {
  if (batch.length === 0) return "Ende der Liste";
  const oldest = batch[batch.length - 1].date;
  if (maxAgeDays !== undefined && oldest && ageDays(new Date(oldest), now) > maxAgeDays) return `älter als ${maxAgeDays} Tage`;
  if (batch.every((e) => !entryChanged(cache[e.id], e))) return "Rest unverändert im Zwischenspeicher";
  return null;
}

/** "Antworten pruefen": nur oeffnen, wenn die Liste Aktivitaet der Gegenseite zeigt oder nichts Sicheres. */
export function hasNewActivity(e: ListEntry | undefined): boolean {
  return !e || e.lastSender !== "ich" || e.unread > 0;
}

/** Probelauf: aus der Liste sicher uebersprungen, ohne die Konversation zu oeffnen. */
export function listSkipReason(e: ListEntry): string | null {
  if (e.lastSender === "system") return "abgelehnt";
  // Ungelesen ist nie von mir: Gegenseite oder Systemmeldung — beides wird nicht angeschrieben.
  if (e.lastSender === "gegenseite") return "ungelesene_nachricht";
  return null;
}

// ── Kurse und Nachrichtentext ─────────────────────────────────────────────────

export type Course = {
  id: string;
  name: string;
  fach: string;
  gruppe: CourseGroup;
  /** Nur aktive Kurse werden zugeordnet und gesendet. */
  active: boolean;
  /** vier Samstage, ISO */
  saturdays: [string, string, string, string];
  /** z.B. "9:30–11:10 Uhr" */
  time: string;
  pricePerLesson: number;
  lessons: number;
  mode: "online" | "vor Ort";
  /** bei "vor Ort", z.B. "Zürich Oerlikon" */
  place: string;
  /** ISO */
  deadline: string;
  minParticipants: number;
  /** Sie-Form mit den PLACEHOLDERS */
  template: string;
};

/** Mein Preis im Einzelunterricht, Vergleich fuer {einzeltotal}. */
export const PRIVATE_PRICE_PER_LESSON = 89;

export const PLACEHOLDERS = [
  "{vorname}", "{kursname}", "{fach}", "{daten}", "{uhrzeit}", "{ort}", "{preis}", "{total}", "{lektionen}", "{einzeltotal}", "{anmeldeschluss}",
] as const;

export const DEFAULT_TEMPLATE = [
  "Hallo {vorname}",
  "Ich hatte mich vor einiger Zeit auf Ihre Anfrage für {fach}-Nachhilfe gemeldet. Falls Sie noch suchen, habe ich ein neues, deutlich günstigeres Angebot:",
  "Ich starte einen {kursname} in einer kleinen Gruppe (maximal 6 Teilnehmende), an 4 Samstagen ({daten}), jeweils {uhrzeit}, {ort}.",
  "Ihr Kind lernt bei einem sehr erfahrenen Lehrer (über 12 Jahre Erfahrung, Schwerpunkt Gymi und Matura). Der ganze Kurs mit {lektionen} Lektionen kostet CHF {total}, also CHF {preis} pro Lektion. Dieselben {lektionen} Lektionen im Einzelunterricht kosten bei mir CHF {einzeltotal}. Dazu kommt Zugang zu meiner Übungsplattform: Ihr Kind übt zwischen den Terminen, und ich sehe genau, wo es steht.",
  'Soll ich einen Platz reservieren? Ein kurzes "Ja" hier im Chat reicht, dann schicke ich alle Details. Der Kurs findet ab 3 Anmeldungen statt; bezahlt wird erst, wenn er sicher stattfindet.',
  "Liebe Grüsse\nOmid",
].join("\n\n");

/**
 * BM: Anfragen schreiben oft die Lernenden selbst (Lehre mit BM), oft auch Eltern —
 * darum ohne "Ihr Kind", in der Ich-Form; Pruefungsfokus statt "Gymi und Matura".
 */
export const BM_TEMPLATE = [
  "Hallo {vorname}",
  "Ich hatte mich vor einiger Zeit auf Ihre Anfrage für {fach}-Nachhilfe gemeldet. Falls Sie noch suchen, habe ich ein neues, deutlich günstigeres Angebot:",
  "Ich starte einen {kursname} in einer kleinen Gruppe (maximal 6 Teilnehmende), an 4 Samstagen ({daten}), jeweils {uhrzeit}, {ort}. Wir arbeiten gezielt auf die BM-Prüfungen hin und lösen typische Prüfungsaufgaben.",
  "Ich unterrichte seit über 12 Jahren. Der ganze Kurs mit {lektionen} Lektionen kostet CHF {total}, also CHF {preis} pro Lektion. Dieselben {lektionen} Lektionen im Einzelunterricht kosten bei mir CHF {einzeltotal}. Dazu kommt Zugang zu meiner Übungsplattform: Zwischen den Terminen wird online weitergeübt, und ich sehe genau, wo es noch hakt.",
  'Soll ich einen Platz reservieren? Ein kurzes "Ja" hier im Chat reicht, dann schicke ich alle Details. Der Kurs findet ab 3 Anmeldungen statt; bezahlt wird erst, wenn er sicher stattfindet.',
  "Liebe Grüsse\nOmid",
].join("\n\n");

/** Fuer die Kursgruppe "offen": kein Kursangebot, sondern die Frage nach der genauen Stufe. */
export const INQUIRY_TEMPLATE = [
  "Hallo {vorname}",
  "Ich hatte mich vor einiger Zeit auf Ihre Anfrage für {fach}-Nachhilfe gemeldet. Falls Sie noch suchen: Ich biete neu günstige {fach}-Kurse in kleinen Gruppen an (maximal 6 Teilnehmende), für verschiedene Stufen, von der Sek über die Gymi-Vorbereitung bis zur Matura und BM.",
  "Damit ich Ihnen den passenden Kurs schicken kann: Welche Stufe und welche Klasse ist es genau (z.B. 2. Sek oder 1. Jahr Kurzgymi)?",
  "Eine kurze Antwort hier im Chat reicht, dann schicke ich Ihnen alle Informationen.",
  "Liebe Grüsse\nOmid",
].join("\n\n");

/** Erkennt unsere Nachfass-Nachricht in einer Konversation (Senden-Bestaetigung, Antworten). */
export const FOLLOWUP_MARKER = "Ich hatte mich vor einiger Zeit";

const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function suggestCourseName(fach: string, gruppe: CourseGroup): string {
  if (gruppe === "offen") return `${fach}: Stufe nachfragen`;
  const kind = gruppe.startsWith("zap") || gruppe === "matura" || gruppe === "bm" ? "Vorbereitungskurs" : "Repetitionskurs";
  return `${fach}-${kind} ${GROUP_SHORT[gruppe]}`;
}

/** Neuer Kurs, inaktiv: Start am ersten Samstag in fruehestens drei Wochen, Anmeldeschluss eine Woche davor. */
export function newCourse(fach: string, gruppe: CourseGroup, now = new Date()): Course {
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 21);
  first.setDate(first.getDate() + ((6 - first.getDay() + 7) % 7));
  const sat = (w: number) => isoDate(new Date(first.getFullYear(), first.getMonth(), first.getDate() + 7 * w));
  return {
    id: `${fach}-${gruppe}-${now.getTime().toString(36)}`.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
    name: suggestCourseName(fach, gruppe),
    fach,
    gruppe,
    active: false,
    saturdays: [sat(0), sat(1), sat(2), sat(3)],
    time: "9:30–11:10 Uhr",
    pricePerLesson: 55,
    lessons: 8,
    mode: "online",
    place: "",
    deadline: sat(-1),
    minParticipants: 3,
    template: gruppe === "offen" ? INQUIRY_TEMPLATE : gruppe === "bm" ? BM_TEMPLATE : DEFAULT_TEMPLATE,
  };
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
 * Sie → du fuer die Saetze der Vorlage. Bleibt danach noch eine Sie-Form uebrig
 * (eigener Text), gilt die du-Form als nicht ableitbar.
 */
const DU_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bIhre Anfrage\b/g, "deine Anfrage"],
  [/\bFalls Sie noch suchen\b/g, "Falls du noch suchst"],
  [/\bIhr Kind lernt\b/g, "Du lernst"],
  [/\bIhr Kind übt\b/g, "Du übst"],
  [/\bwo es steht\b/g, "wo du stehst"],
  [/\bwo jemand steht\b/g, "wo du stehst"],
  [/\bich Ihnen\b/g, "ich dir"],
];
const SIE_LEFT = /\b(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen|Ihr Kind)\b/;

export function toDuForm(sieText: string): { text: string; ok: boolean } {
  let t = sieText;
  for (const [re, rep] of DU_REPLACEMENTS) t = t.replace(re, rep);
  return { text: t, ok: !SIE_LEFT.test(t) };
}

export type Rendered = { text: string; anrede: Anrede; warning?: string };

/** Fertige Nachricht aus dem AKTUELLEN Kurs. */
export function renderMessage(c: Course, firstName: string, wantAnrede: Anrede): Rendered {
  const values: Record<string, string> = {
    "{vorname}": firstName.trim(),
    "{kursname}": c.name.trim(),
    "{fach}": c.fach,
    "{daten}": formatSaturdays(c.saturdays),
    "{uhrzeit}": c.time.trim(),
    "{ort}": c.mode === "online" ? "online" : `vor Ort${c.place.trim() ? ` (${c.place.trim()})` : ""}`,
    "{preis}": String(c.pricePerLesson),
    "{total}": String(c.pricePerLesson * c.lessons),
    "{lektionen}": String(c.lessons),
    "{einzeltotal}": String(PRIVATE_PRICE_PER_LESSON * c.lessons),
    "{anmeldeschluss}": dayMonth(c.deadline),
  };
  let text = c.template;
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

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Pruefung beim Speichern: was falsch ist, als Liste von Meldungen. */
export function validateCourses(courses: Course[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const c of courses) {
    const name = c.name.trim() || "Kurs ohne Namen";
    if (!c.name.trim()) errors.push(`${name}: Name fehlt.`);
    if (ids.has(c.id)) errors.push(`${name}: doppelte Kurs-ID.`);
    ids.add(c.id);
    if (!isCourseGroup(c.gruppe)) errors.push(`${name}: unbekannte Kursgruppe.`);
    if (!c.fach.trim()) errors.push(`${name}: Fach fehlt.`);
    if (containsForbiddenContact(`${c.template}\n${c.name}\n${c.place}`)) errors.push(`${name}: Text enthält Link, E-Mail oder Telefonnummer.`);
    if (!c.template.trim()) errors.push(`${name}: Text ist leer.`);
    const unknown = c.template.match(/\{[a-zäöü]+\}/g)?.filter((p) => !(PLACEHOLDERS as readonly string[]).includes(p));
    if (unknown?.length) errors.push(`${name}: unbekannter Platzhalter ${unknown.join(", ")}.`);
    // Ohne den Satz erkennt der naechste Lauf das Nachfassen nicht und koennte doppelt schreiben.
    if (!c.template.includes(FOLLOWUP_MARKER)) errors.push(`${name}: Text muss „${FOLLOWUP_MARKER}“ enthalten.`);
    // Stufe nachfragen: keine Termine, kein Preis.
    if (c.gruppe === "offen") continue;
    if (!(c.pricePerLesson > 0) || !(c.lessons > 0)) errors.push(`${name}: Preis und Anzahl Lektionen müssen > 0 sein.`);
    if (!(c.minParticipants >= 1)) errors.push(`${name}: Mindestteilnehmerzahl muss ≥ 1 sein.`);
    if (c.saturdays.length !== 4 || c.saturdays.some((d) => !ISO.test(d))) errors.push(`${name}: bitte vier Termine angeben.`);
    if (!ISO.test(c.deadline)) errors.push(`${name}: Anmeldeschluss fehlt.`);
  }
  return errors;
}

// ── CSV (Semikolon + BOM, damit Excel mit Schweizer Einstellungen es direkt oeffnet) ──

export const PREVIEW_COLS = [
  "status", "conversation_id", "link", "name", "kategorie", "begruendung", "stufe", "fach",
  "faecher", "klasse", "gymi_jahr", "kursgruppe", "sicherheit", "ort", "ortsname", "zeitwunsch", "anlass",
  "letzte_nachricht", "anrede", "grund", "quelle", "kurs", "nachricht",
] as const;
export const LOG_COLS = [
  "conversation_id", "name", "zeitstempel", "kurs", "variante", "status",
  "geantwortet", "antwort_datum", "antwort", "markierung",
] as const;

export type PreviewRow = Record<(typeof PREVIEW_COLS)[number], string>;
export type LogRow = Record<(typeof LOG_COLS)[number], string>;
export const MARKS = ["offen", "Zusage", "Absage", "Frage"] as const;

// ── Zuordnung und effektiver Status ───────────────────────────────────────────

/** Ein Kursangebot pro Konversation: das zuerst genannte meiner Faecher, fuer das ein aktiver Kurs passt. */
export function assignCourse(
  row: Pick<PreviewRow, "faecher" | "kursgruppe">,
  courses: Course[],
  settings: FollowupSettings
): Course | null {
  for (const fach of splitList(row.faecher)) {
    if (!settings.mySubjects.includes(fach)) continue;
    const c = courses.find((x) => x.active && x.fach === fach && x.gruppe === row.kursgruppe);
    if (c) return c;
  }
  return null;
}

export type Effective = { send: boolean; label: string; course: Course | null };

/** Was mit einer Zeile passiert. Gesendet wird nur bei send = true. */
export function effectiveStatus(
  row: PreviewRow | Omit<PreviewRow, "nachricht">,
  courses: Course[],
  settings: FollowupSettings,
  logged: Set<string> = new Set()
): Effective {
  const no = (label: string): Effective => ({ send: false, label, course: null });
  if (logged.has(row.conversation_id)) return no("bereits nachgefasst");
  if (row.grund) return no(row.grund);
  if (!isOfferLevel(row.kategorie)) return no(`ausgeschlossen: Stufe (${row.kategorie || "?"})`);
  if (!splitList(row.faecher).some((f) => settings.mySubjects.includes(f))) return no("ausgeschlossen: Fach");
  if (!row.kursgruppe) return no("keine Kursgruppe");
  const course = assignCourse(row, courses, settings);
  if (!course) return no("kein Kurs");
  if (row.status.trim().toLowerCase() !== "send") return { send: false, label: "skip", course };
  return { send: true, label: "wird gesendet", course };
}

// ── Nachfrage-Uebersicht ──────────────────────────────────────────────────────

export type DemandRow = {
  fach: string;
  gruppe: CourseGroup;
  count: number;
  online: number;
  hoch: number;
  anlass: string;
  zeit: string;
  recommended: boolean;
};

const top = (counts: Record<string, number>, n: number) =>
  Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

/**
 * Kandidaten je Fach × Kursgruppe. Wer mehrere meiner Faecher nennt, zaehlt
 * bei jedem mit: die Uebersicht misst Nachfrage, nicht Zuordnung.
 */
export function demandOverview(rows: Array<Omit<PreviewRow, "nachricht">>, settings: FollowupSettings): DemandRow[] {
  const acc = new Map<string, { fach: string; gruppe: CourseGroup; count: number; online: number; hoch: number; anlass: Record<string, number>; zeit: Record<string, number> }>();
  for (const r of rows) {
    if (r.grund || r.status !== "send" || !isOfferLevel(r.kategorie) || !isCourseGroup(r.kursgruppe)) continue;
    for (const fach of splitList(r.faecher).filter((f) => settings.mySubjects.includes(f))) {
      const key = `${fach}|${r.kursgruppe}`;
      const a = acc.get(key) ?? { fach, gruppe: r.kursgruppe, count: 0, online: 0, hoch: 0, anlass: {}, zeit: {} };
      a.count++;
      if (r.ort === "online" || r.ort === "beides") a.online++;
      if (r.sicherheit === "hoch") a.hoch++;
      if (r.anlass && r.anlass !== "unbekannt") a.anlass[r.anlass] = (a.anlass[r.anlass] ?? 0) + 1;
      for (const z of splitList(r.zeitwunsch)) a.zeit[z] = (a.zeit[z] ?? 0) + 1;
      acc.set(key, a);
    }
  }
  return Array.from(acc.values())
    .map((a) => ({
      fach: a.fach,
      gruppe: a.gruppe,
      count: a.count,
      online: a.online,
      hoch: a.hoch,
      anlass: top(a.anlass, 1)[0] ?? "—",
      zeit: top(a.zeit, 2).join(", ") || "—",
      recommended: a.hoch >= settings.recommendMin,
    }))
    .sort((a, b) => b.count - a.count || b.hoch - a.hoch);
}

// ── Antworten und Kurs-Uebersicht ─────────────────────────────────────────────

export type Bubble = { kind: "mine" | "theirs"; text: string };

/**
 * Erste Antwort nach meinem Nachfassen: nach der letzten eigenen Nachricht mit
 * FOLLOWUP_MARKER, sonst (eigener Text ohne Marker) nach dem Sendezeitpunkt.
 */
export function findReply(bubbles: Bubble[], sentAt: Date): { date: Date | null; text: string } | null {
  let start = -1;
  for (let i = 0; i < bubbles.length; i++) if (bubbles[i].kind === "mine" && bubbles[i].text.includes(FOLLOWUP_MARKER)) start = i;
  const after = bubbles.filter((b, i) => {
    if (b.kind !== "theirs") return false;
    if (start > -1) return i > start;
    const d = parseTutor24Date(b.text);
    return !!d && d.getTime() >= sentAt.getTime() - 60_000;
  });
  if (!after.length) return null;
  const first = after[0];
  return { date: parseTutor24Date(first.text), text: first.text.replace(DATE_RE, "").replace(/\s+/g, " ").trim().slice(0, 200) };
}

export type CourseStats = {
  angeschrieben: number;
  geantwortet: number;
  zusagen: number;
  quote: number;
  tageBisSchluss: number;
  ampel: "gruen" | "gelb" | "rot";
};

export function courseStats(c: Course, log: Array<Partial<LogRow>>, now = new Date()): CourseStats {
  const mine = log.filter((r) => r.kurs === c.id);
  const geantwortet = mine.filter((r) => r.geantwortet === "ja").length;
  const zusagen = mine.filter((r) => r.markierung === "Zusage").length;
  const [y, m, d] = c.deadline.split("-").map(Number);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    angeschrieben: mine.length,
    geantwortet,
    zusagen,
    quote: mine.length ? geantwortet / mine.length : 0,
    tageBisSchluss: Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / DAY_MS),
    ampel: zusagen >= c.minParticipants ? "gruen" : zusagen > 0 ? "gelb" : "rot",
  };
}

// ── CSV-Hilfen ────────────────────────────────────────────────────────────────

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
