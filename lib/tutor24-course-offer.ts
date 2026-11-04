/**
 * Texte fuer tutor24: Erst-Nachricht UND Nachfassen aus denselben Bausteinen.
 *
 * Reine Logik ohne Browser und Datenbank: Kurswahl, Text in den Anredeformen (du, Eltern, neutral, Englisch),
 * Kursblock aus den Kursdaten (nie von der KI, wortgleich in beiden Nachrichten), gleicher Gruss,
 * gleiche Signatur, Pruefung vor dem Senden (CHECK_RULES).
 * Kurse kommen aus tutor24-followup/courses.json (Seite /kurse).
 */
import {
  analyzeListing,
  capacity,
  containsForbiddenContact,
  courseBlock,
  detectAddressee,
  findDuForm,
  formatSaturdays,
  hasFollowupMarker,
  isOfferLevel,
  pickCourse,
  type Addressee,
  type Course,
  type FollowupKind,
  type FollowupSettings,
  type LeadInfo,
  type ListingInfo,
  type LogRow,
  type OfferLevel,
  type Sprache,
} from "./tutor24-followup";

export type Analysis = ReturnType<typeof analyzeListing>;

// Kurswahl (pickCourse) liegt in ./tutor24-followup: dieselbe Regel fuer Erst-Nachricht und Nachfassen.
export { pickCourse, DEMAND_REASONS, type DemandReason, type Offer } from "./tutor24-followup";

// ── Anrede ────────────────────────────────────────────────────────────────────

/** Nominativ, Akkusativ, Dativ: "Ihre Tochter" / "Ihren Sohn" / "Ihrem Kind". */
const CHILD: Record<"Tochter" | "Sohn" | "Kind", { nom: string; akk: string; dat: string }> = {
  Tochter: { nom: "Ihre Tochter", akk: "Ihre Tochter", dat: "Ihrer Tochter" },
  Sohn: { nom: "Ihr Sohn", akk: "Ihren Sohn", dat: "Ihrem Sohn" },
  Kind: { nom: "Ihr Kind", akk: "Ihr Kind", dat: "Ihrem Kind" },
};

/** Welche Fassung: Eltern ohne genau ein genanntes Kind bekommen die neutrale; Englisch hat nur eine. */
export type Form = { typ: "du" } | { typ: "eltern"; nom: string; akk: string; dat: string } | { typ: "neutral" } | { typ: "en" };
export function formFor(ad: Addressee, sprache: string = "de"): Form {
  if (sprache === "en") return { typ: "en" };
  if (ad.wer === "schueler") return { typ: "du" };
  if (ad.wer === "eltern" && ad.kind) return { typ: "eltern", ...CHILD[ad.kind] };
  return { typ: "neutral" };
}

/** Fassung fuers Nachfassen: aus der Erst-Nachricht (Lead), sonst aus der Vorschau-Anrede (du / neutral). */
export function followupForm(lead: LeadInfo | undefined, previewAnrede: string): Form {
  if (lead?.quelle === "erstnachricht") {
    const kind = lead.kind === "Tochter" || lead.kind === "Sohn" || lead.kind === "Kind" ? lead.kind : null;
    return formFor({ wer: lead.wer as Addressee["wer"], anrede: lead.anrede === "du" ? "du" : "Sie", kind }, lead.sprache);
  }
  if (lead?.sprache === "en") return { typ: "en" };
  return previewAnrede === "du" ? { typ: "du" } : { typ: "neutral" };
}

const sprache = (f: Form): Sprache => (f.typ === "en" ? "en" : "de");
const isDu = (f: Form) => f.typ === "du";

/** Gruss und Signatur: in Erst-Nachricht und Nachfassen dieselben. */
export const greeting = (f: Form) => (f.typ === "en" ? "Hello" : isDu(f) ? "Hallo" : "Guten Tag");
export const signature = (f: Form) => (f.typ === "en" ? "Best regards\nOmid" : "Liebi Grüess\nOmid");

// ── Erst-Nachricht ────────────────────────────────────────────────────────────

const CREDENTIALS =
  "Ich unterrichte seit über 12 Jahren, habe an der ETH studiert und begleite aktuell mehr als 30 aktive Schüler, die meisten auf Gymi- oder Universitätsniveau. Entsprechend gut kenne ich die Anforderungen, typischen Fehler und relevanten Themen über alle Stufen hinweg.";
const LEHRMITTEL =
  "Für meinen Unterricht habe ich eigene Lehrmittel für die Gymivorbereitung, BM-Vorbereitung sowie verschiedene Gymi- und BM-Stufen entwickelt. Zusätzlich habe ich die Lernplattform Mathetogo programmiert (www.platform.mathetogo.xyz).";

type Parts = { intro: string; credentials: string; lehrmittel: string; plattform: string; meet: string; wichtig: string; wichtigKurz: string; kontakt: string; infos: string };

function parts(f: Form): Parts {
  if (f.typ === "en")
    return {
      intro: "I would be happy to help with mathematics and physics, either online or in Zurich, in German or English.",
      credentials:
        "I have been teaching for over 12 years, studied at ETH and currently teach more than 30 students, most of them at Gymnasium or university level. I know the requirements, typical mistakes and key topics at every level very well.",
      lehrmittel:
        "I have developed my own teaching materials for Gymnasium entrance exam preparation, BM preparation and various Gymnasium and BM levels. I also programmed the learning platform Mathetogo (www.platform.mathetogo.xyz).",
      plattform:
        "There you work with clearly structured content, solve targeted exercises, write down your solutions and receive personal feedback. Additional quizzes help to assess the current level realistically and make targeted progress.",
      meet: "Online lessons take place via Google Meet. I explain the material clearly and visually on the iPad, and after each lesson you receive the annotated notes so that everything can be reviewed calmly.",
      wichtig:
        "It matters to me that you not only understand the current material, but also learn how to approach mathematics in a sensible and lasting way. I also help with learning strategy, structure and motivation.",
      wichtigKurz: "It matters to me that you not only understand the current material, but learn to approach mathematics in a lasting way.",
      kontakt: "If you are interested, feel free to contact me on WhatsApp to arrange a lesson (078 693 68 98).",
      infos: "More information: www.mathetogo.xyz",
    };
  if (f.typ === "du")
    return {
      intro: "gerne unterstütze ich dich in Mathematik und der Physik, entweder online oder in Zürich, auf Deutsch oder Englisch.",
      credentials: CREDENTIALS,
      lehrmittel: LEHRMITTEL,
      plattform: "Dort arbeitest du mit klar strukturierten Inhalten, löst gezielte Aufgaben, hältst deinen Lösungsweg fest und erhältst persönliches Feedback. Ergänzende Quizzes helfen dir, deinen Lernstand realistisch einzuschätzen und gezielt Fortschritte zu machen.",
      meet: "Online-Lektionen finden über Google Meet statt. Ich erkläre den Stoff verständlich und visuell mit dem iPad, und nach jeder Lektion erhältst du die bearbeiteten Unterlagen, damit du alles nochmals in Ruhe nachvollziehen kannst.",
      wichtig: "Mir ist wichtig, dass du nicht nur den aktuellen Stoff verstehst, sondern auch lernst, wie man Mathematik sinnvoll und nachhaltig angeht. Dabei unterstütze ich dich auch in Bezug auf Lernstrategie, Struktur und Motivation.",
      wichtigKurz: "Mir ist wichtig, dass du nicht nur den aktuellen Stoff verstehst, sondern lernst, Mathematik nachhaltig anzugehen.",
      kontakt: "Wenn du deine Mathematikkenntnisse in einer ruhigen, unterstützenden Atmosphäre verbessern möchtest, melde dich gerne per WhatsApp für eine Terminvereinbarung (078 693 68 98).",
      infos: "Weitere Infos findest du hier: www.mathetogo.xyz",
    };
  if (f.typ === "eltern")
    return {
      intro: `gerne unterstütze ich ${f.akk} in Mathematik und Physik, entweder online oder in Zürich, auf Deutsch oder Englisch.`,
      credentials: CREDENTIALS,
      lehrmittel: LEHRMITTEL,
      plattform: `Dort arbeitet ${f.nom} mit klar strukturierten Inhalten, löst gezielte Aufgaben, hält den Lösungsweg fest und erhält persönliches Feedback. Ergänzende Quizzes helfen, den Lernstand realistisch einzuschätzen und gezielt Fortschritte zu machen.`,
      meet: `Online-Lektionen finden über Google Meet statt. Ich erkläre den Stoff verständlich und visuell mit dem iPad, und nach jeder Lektion erhält ${f.nom} die bearbeiteten Unterlagen, damit sich alles nochmals in Ruhe nachvollziehen lässt.`,
      wichtig: `Mir ist wichtig, dass ${f.nom} nicht nur den aktuellen Stoff versteht, sondern auch lernt, wie man Mathematik sinnvoll und nachhaltig angeht. Dabei unterstütze ich auch in Bezug auf Lernstrategie, Struktur und Motivation.`,
      wichtigKurz: `Mir ist wichtig, dass ${f.nom} nicht nur den aktuellen Stoff versteht, sondern lernt, Mathematik nachhaltig anzugehen.`,
      kontakt: "Wenn Sie Interesse haben, melden Sie sich gerne per WhatsApp für eine Terminvereinbarung (078 693 68 98).",
      infos: "Weitere Infos finden Sie hier: www.mathetogo.xyz",
    };
  return {
    intro: "gerne biete ich Nachhilfe in Mathematik und Physik an, entweder online oder in Zürich, auf Deutsch oder Englisch.",
    credentials: CREDENTIALS,
    lehrmittel: LEHRMITTEL,
    plattform: "Dort wird mit klar strukturierten Inhalten gearbeitet: gezielte Aufgaben lösen, den Lösungsweg festhalten und persönliches Feedback erhalten. Ergänzende Quizzes helfen, den Lernstand realistisch einzuschätzen und gezielt Fortschritte zu machen.",
    meet: "Online-Lektionen finden über Google Meet statt. Ich erkläre den Stoff verständlich und visuell mit dem iPad, und nach jeder Lektion gibt es die bearbeiteten Unterlagen, damit sich alles nochmals in Ruhe nachvollziehen lässt.",
    wichtig: "Mir ist wichtig, dass nicht nur der aktuelle Stoff verstanden wird, sondern dass man auch lernt, wie man Mathematik sinnvoll und nachhaltig angeht. Dabei unterstütze ich auch in Bezug auf Lernstrategie, Struktur und Motivation.",
    wichtigKurz: "Mir ist wichtig, dass nicht nur der aktuelle Stoff sitzt, sondern auch ein nachhaltiger Umgang mit Mathematik entsteht.",
    kontakt: "Wenn Sie Interesse haben, melden Sie sich gerne per WhatsApp für eine Terminvereinbarung (078 693 68 98).",
    infos: "Weitere Infos finden Sie hier: www.mathetogo.xyz",
  };
}

const dayMonth = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return m && d ? `${d}.${m}.` : iso;
};

const THEMA: Record<OfferLevel, string> = {
  matura: "die Maturavorbereitung",
  bm: "die BM-Vorbereitung",
  gymivorbereitung: "die Vorbereitung auf die Gymiprüfung",
  gymi: "den Stoff am Gymnasium",
  sek: "den Stoff der Sekundarstufe",
};
const THEMA_EN: Record<OfferLevel, string> = {
  matura: "Matura preparation",
  bm: "BM preparation",
  gymivorbereitung: "the Gymnasium entrance exam",
  gymi: "the Gymnasium curriculum",
  sek: "the secondary school curriculum",
};

/** Persoenlicher Satz ohne KI: Rueckfall, wenn die KI fehlt oder ihr Satz die Pruefung nicht besteht. */
export function fallbackSentence(a: Analysis, f: Form): string {
  if (f.typ === "en") {
    const topic = isOfferLevel(a.kategorie) ? THEMA_EN[a.kategorie] : "tutoring";
    return `Especially for ${topic}, it pays off to work specifically on typical exercises and the most important topics, and that is exactly how I structure my lessons.`;
  }
  const thema = isOfferLevel(a.kategorie) ? THEMA[a.kategorie] : "die Nachhilfe";
  const mit = f.typ === "du" ? " mit dir" : f.typ === "eltern" ? ` mit ${f.dat}` : "";
  return `Gerade für ${thema} lohnt es sich, gezielt an den typischen Aufgaben und den wichtigsten Themen zu arbeiten, und genau so baue ich die Lektionen${mit} auf.`;
}

export function buildFirstMessage(f: Form, personal: string, course: Course | null, privatePrice: number): string {
  const p = parts(f);
  return [
    `${greeting(f)},`,
    `${p.intro} ${p.credentials}`,
    personal.trim(),
    ...(course ? [courseBlock(course, privatePrice, sprache(f))] : []),
    `${p.lehrmittel} ${p.plattform}`,
    p.meet,
    course ? p.wichtigKurz : p.wichtig,
    p.kontakt,
    p.infos,
    signature(f),
  ].join("\n\n");
}

// ── Nachfassen ────────────────────────────────────────────────────────────────

const FACH_EN: Record<string, string> = { Mathe: "maths", Physik: "physics", Chemie: "chemistry" };

/**
 * Nachfass-Text aus denselben Bausteinen wie die Erst-Nachricht: gleicher Gruss, gleiche Signatur,
 * wortgleicher Kursblock. Wiederholt weder den persoenlichen Satz noch die Vorstellung und nimmt Bezug
 * auf die Erst-Nachricht, statt ein "neues Angebot" zu behaupten.
 */
export function buildFollowup(kind: FollowupKind, f: Form, name: string, c: Course, privatePrice: number): string {
  const hello = `${greeting(f)}${name.trim() ? ` ${name.trim()}` : ""},`;
  const block = courseBlock(c, privatePrice, sprache(f));
  const deadline = dayMonth(c.deadline);
  let body: string[];
  if (f.typ === "en") {
    const fach = FACH_EN[c.fach] ?? c.fach;
    const ref = `I got in touch with you a while ago about your request for ${fach} tutoring.`;
    const close = 'Shall I reserve a place for you? A short "Yes" here in the chat is enough, and I will send you all the details. Payment is only due once the course is confirmed.';
    body =
      kind === "erinnerung"
        ? [`${ref} In that message I also mentioned the ${c.name.trim()}. There are still places available; registration closes on ${deadline}.`, close]
        : kind === "geaendert"
          ? [`${ref} In that message I also mentioned the ${c.name.trim()}. Some details have changed since then, here is the current information:`, block, close]
          : kind === "neuer_durchgang"
            ? [`${ref} The course from my first message is no longer open, but there is a new run:`, block, close]
            : kind === "frage"
              ? [
                  `${ref} In case you are still looking: I now offer affordable ${fach} courses in small groups (max. ${capacity(c)} participants) for different levels, from Sek to Gymnasium entrance exam preparation, Matura and BM.`,
                  "So that I can send you the right course: which level and year is it exactly (e.g. 2nd year of Sek or 1st year of Kurzgymi)?",
                  "A short answer here in the chat is enough, and I will send you all the information.",
                ]
              : [`${ref} In case you are still looking, there is now a more affordable option:`, block, close];
  } else {
    const du = isDu(f);
    const ref = `ich hatte mich vor einiger Zeit auf ${du ? "deine" : "Ihre"} Anfrage für ${c.fach}-Nachhilfe gemeldet.`;
    const suchen = du ? "Falls du noch suchst" : "Falls Sie noch suchen";
    const dir = du ? "dir" : "Ihnen";
    const reservieren = du
      ? "Soll ich dir einen Platz reservieren?"
      : f.typ === "eltern"
        ? `Soll ich für ${f.akk} einen Platz reservieren?`
        : "Soll ich einen Platz reservieren?";
    const close = `${reservieren} Ein kurzes „Ja“ hier im Chat reicht, dann schicke ich ${dir} alle Details. Bezahlt wird erst, wenn der Kurs sicher stattfindet.`;
    const erwaehnt = `Dabei hatte ich auch den ${c.name.trim()} erwähnt.`;
    body =
      kind === "erinnerung"
        ? [`${ref} ${erwaehnt} Es hat noch freie Plätze, Anmeldeschluss ist der ${deadline}.`, close]
        : kind === "geaendert"
          ? [`${ref} ${erwaehnt} Inzwischen haben sich einige Angaben geändert, hier die aktuellen:`, block, close]
          : kind === "neuer_durchgang"
            ? [`${ref} Der Kurs aus meiner ersten Nachricht ist inzwischen nicht mehr offen, es gibt aber einen neuen Durchgang:`, block, close]
            : kind === "frage"
              ? [
                  `${ref} ${suchen}: Ich biete neu günstige ${c.fach}-Kurse in kleinen Gruppen an (maximal ${capacity(c)} Teilnehmende), für verschiedene Stufen, von der Sek über die Gymi-Vorbereitung bis zur Matura und BM.`,
                  `Damit ich ${dir} den passenden Kurs schicken kann: Welche Stufe und welche Klasse ist es genau (z.B. 2. Sek oder 1. Jahr Kurzgymi)?`,
                  `Eine kurze Antwort hier im Chat reicht, dann schicke ich ${dir} alle Informationen.`,
                ]
              : [`${ref} ${suchen}, gibt es jetzt eine günstigere Möglichkeit:`, block, close];
  }
  return [hello, ...body, signature(f)].join("\n\n").replace(/ß/g, "ss");
}

// ── Pruefung ──────────────────────────────────────────────────────────────────

/**
 * Die zwei Pruefregeln, ausdruecklich:
 * - Erst-Nachricht: darf WhatsApp-Nummer und Links (mathetogo.xyz) enthalten — so steht es im festen Text.
 * - Nachfassen: keine Telefonnummer, kein Link, keine E-Mail; muss sich auf die Erst-Nachricht beziehen.
 * Beide: gleiche Anrede durchgehend, kein Platzhalter, gleicher Gruss, Signatur am Schluss,
 * Kursblock wortgleich aus den Kursdaten.
 */
export const CHECK_RULES = {
  erst: { kontaktErlaubt: true, bezugAufErstNachricht: false },
  nachfassen: { kontaktErlaubt: false, bezugAufErstNachricht: true },
} as const;

const SIE_FORM = new RegExp("(?<!\\p{L})(Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer)(?!\\p{L})", "u");
const CHILD_NOUN = new RegExp("(?<!\\p{L})(Ihr(?:e|en|em|er)?) (Kind|Kinder|Sohn|Tochter)(?!\\p{L})", "gu");

/** Pruefung des persoenlichen KI-Satzes; null = in Ordnung. */
export function sentenceProblem(s: string, f: Form): string | null {
  const t = s.trim();
  if (!t) return "leer";
  if (t.split(/\s+/).length > 45) return "zu lang";
  if (/https?:|www\.|@|\d{3} ?\d{3}/.test(t)) return "Link oder Nummer";
  if (/\b(ETH|12 Jahre|12 years|Plattform|platform|Mathetogo|Google Meet|Gruppe|group|Kurs|course|CHF|Preis|price)\b/i.test(t)) return "wiederholt festen Text oder Kurs";
  // Der feste Text davor beginnt schon mit "gerne unterstütze ich …" / "I would be happy to help".
  if (/^(gerne|ich|i would|i'd)\b|unterstütze ich|happy to help/i.test(t)) return "wiederholt den Anfang";
  return anredeProblem(t, f);
}

function anredeProblem(text: string, f: Form): string | null {
  if (f.typ === "en") return null;
  if (f.typ === "du") {
    const sie = text.match(SIE_FORM)?.[0];
    if (sie) return `du-Nachricht enthält „${sie}“`;
    return null;
  }
  const du = findDuForm(text);
  if (du) return `Sie-Nachricht enthält „${du}“`;
  const nouns = Array.from(text.matchAll(CHILD_NOUN)).map((m) => m[2]);
  if (f.typ === "neutral" && nouns.length) return `neutrale Nachricht nennt „${nouns[0]}“`;
  if (f.typ === "eltern") {
    const own = f.nom.split(" ")[1];
    const other = nouns.find((n) => n !== own);
    if (other) return `nennt „${other}“, im Inserat steht „${own}“`;
  }
  return null;
}

/**
 * Fertige Nachricht vor dem Senden; null = in Ordnung. art waehlt die Regel aus CHECK_RULES.
 * course: dessen Kursblock muss wortgleich drinstehen (null = Nachricht ohne Kursblock).
 */
export function messageCheck(art: keyof typeof CHECK_RULES, text: string, f: Form, course: Course | null, privatePrice: number): string | null {
  const rule = CHECK_RULES[art];
  if (/\{[a-zäöü]+\}/.test(text)) return "nicht ersetzter Platzhalter";
  if (!rule.kontaktErlaubt && containsForbiddenContact(text)) return "enthält Link, E-Mail oder Telefonnummer (im Nachfassen nicht erlaubt)";
  if (rule.bezugAufErstNachricht && !hasFollowupMarker(text)) return "Bezug auf die Erst-Nachricht fehlt";
  if (!text.startsWith(greeting(f))) return `beginnt nicht mit „${greeting(f)}“`;
  if (!text.endsWith(signature(f).replace(/ß/g, "ss"))) return "Signatur fehlt";
  const anrede = anredeProblem(text, f);
  if (anrede) return anrede;
  if (course) {
    if (!text.includes(courseBlock(course, privatePrice, sprache(f)))) return "Kursblock nicht wortgleich aus den Kursdaten";
    if (!text.includes(`CHF ${course.pricePerLesson * course.lessons}`) || !text.includes(formatSaturdays(course.saturdays).split(" ")[0]))
      return "Kursblock unvollständig";
  }
  return null;
}

export const firstMessageProblem = (text: string, f: Form, course: Course | null, privatePrice: number) =>
  messageCheck("erst", text, f, course, privatePrice);

/** Nachfass-Text samt Pruefung — derselbe fuer Tab, API und Sende-Lauf. */
export function followupMessage(kind: FollowupKind, f: Form, name: string, course: Course, privatePrice: number) {
  const text = buildFollowup(kind, f, name, course, privatePrice);
  const withBlock = kind !== "erinnerung" && kind !== "frage";
  const anrede: "du" | "Sie" = f.typ === "du" ? "du" : "Sie";
  return { text, anrede, problem: messageCheck("nachfassen", text, f, withBlock ? course : null, privatePrice) };
}

// ── Planung ───────────────────────────────────────────────────────────────────

/** Alles in einem Schritt, fuer Automation und Probelauf gleich. spracheListing: de | en (sonst de). */
export function planFirstMessage(
  info: ListingInfo,
  courses: Course[],
  settings: FollowupSettings,
  log: Array<Partial<LogRow>>,
  now = new Date(),
  spracheListing: string = "de"
) {
  const analysis = analyzeListing(info);
  const addressee = detectAddressee(info.description);
  const form = formFor(addressee, spracheListing);
  const offer = pickCourse(analysis, courses, settings, log, now);
  return { analysis, addressee, form, offer, course: offer.kind === "kurs" ? offer.course : null, privatePrice: settings.privatePricePerLesson };
}

/** Text zusammensetzen; besteht er die Pruefung mit Kurs nicht, ohne Kurs, sonst mit Rueckfall-Satz. */
export function assembleFirstMessage(plan: ReturnType<typeof planFirstMessage>, personal: string | null) {
  const fallback = fallbackSentence(plan.analysis, plan.form);
  const kiOk = personal && !sentenceProblem(personal, plan.form);
  const sentence = kiOk ? personal! : fallback;
  for (const course of plan.course ? [plan.course, null] : [null]) {
    for (const s of kiOk ? [sentence, fallback] : [fallback]) {
      const text = buildFirstMessage(plan.form, s, course, plan.privatePrice);
      if (!firstMessageProblem(text, plan.form, course, plan.privatePrice))
        return { text, course, satz: s === fallback ? "fallback" : "ki", problem: null as string | null };
    }
  }
  const text = buildFirstMessage(plan.form, fallback, null, plan.privatePrice);
  return { text, course: null, satz: "fallback", problem: firstMessageProblem(text, plan.form, null, plan.privatePrice) };
}
