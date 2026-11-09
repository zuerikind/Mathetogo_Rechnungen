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
  courseName,
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
export const CHILD_FORMS = CHILD;

/** Welche Fassung: Eltern ohne genau ein genanntes Kind bekommen die neutrale; Englisch hat nur eine. */
/** "fr": nur Nachfassen (die franzoesische Erst-Nachricht schreibt weiter die KI, in der vous-Form). */
export type Form = { typ: "du" } | { typ: "eltern"; nom: string; akk: string; dat: string } | { typ: "neutral" } | { typ: "en" } | { typ: "fr" };
export function formFor(ad: Addressee, sprache: string = "de"): Form {
  if (sprache === "en") return { typ: "en" };
  if (ad.wer === "schueler") return { typ: "du" };
  if (ad.wer === "eltern" && ad.kind) return { typ: "eltern", ...CHILD[ad.kind] };
  return { typ: "neutral" };
}

/** Fassung fuers Nachfassen: aus der Erst-Nachricht (Lead), sonst aus der Vorschau-Anrede (du / neutral). */
export function followupForm(lead: LeadInfo | undefined, previewAnrede: string): Form {
  if (lead?.sprache === "fr") return { typ: "fr" };
  if (lead?.quelle === "erstnachricht") {
    const kind = lead.kind === "Tochter" || lead.kind === "Sohn" || lead.kind === "Kind" ? lead.kind : null;
    return formFor({ wer: lead.wer as Addressee["wer"], anrede: lead.anrede === "du" ? "du" : "Sie", kind }, lead.sprache);
  }
  if (lead?.sprache === "en") return { typ: "en" };
  // Anrede wie in der ersten Nachricht an die Person (gespeichert); die Vorschau-Analyse nur, wenn nichts gespeichert ist.
  const anrede = lead?.anrede || previewAnrede;
  return anrede === "du" ? { typ: "du" } : { typ: "neutral" };
}

const sprache = (f: Form): Sprache => (f.typ === "en" ? "en" : "de");
const isDu = (f: Form) => f.typ === "du";

/** Gruss und Signatur: in Erst-Nachricht und Nachfassen dieselben. */
export const greeting = (f: Form) => (f.typ === "en" ? "Hello" : f.typ === "fr" ? "Bonjour" : isDu(f) ? "Hallo" : "Guten Tag");
export const signature = (f: Form) =>
  f.typ === "en" ? "Best regards\nOmid" : f.typ === "fr" ? "Meilleures salutations\nOmid" : "Liebi Grüess\nOmid";

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
  // Franzoesisch (seit 9.11. fester Text statt KI-Uebersetzung der alten du-Vorlage): vous-Form, gross nach "Bonjour,".
  if (f.typ === "fr")
    return {
      intro: "Je serais ravi de vous aider en mathématiques et en physique, en ligne ou à Zurich, en allemand ou en anglais.",
      credentials:
        "J'enseigne depuis plus de 12 ans, j'ai étudié à l'ETH et j'accompagne actuellement plus de 30 élèves, la plupart au niveau du gymnase ou de l'université. Je connais donc bien les exigences, les erreurs typiques et les thèmes importants à tous les niveaux.",
      lehrmittel:
        "Pour mes cours, j'ai développé mon propre matériel pédagogique pour la préparation à l'examen d'entrée au gymnase, la préparation à la maturité professionnelle (BM) ainsi que pour différents niveaux du gymnase et de la BM. J'ai également programmé la plateforme d'apprentissage Mathetogo (www.platform.mathetogo.xyz).",
      plattform:
        "On y travaille avec des contenus clairement structurés : exercices ciblés, démarche de résolution notée et retour personnalisé. Des quiz complémentaires permettent d'évaluer le niveau de manière réaliste et de progresser de façon ciblée.",
      meet: "Les cours en ligne ont lieu via Google Meet. J'explique la matière de manière claire et visuelle sur l'iPad, et après chaque leçon, vous recevez les notes annotées afin de pouvoir tout revoir tranquillement.",
      wichtig:
        "Il me tient à cœur que la matière actuelle soit bien comprise et que l'on apprenne à aborder les mathématiques de manière réfléchie et durable. J'aide également pour la méthode de travail, l'organisation et la motivation.",
      wichtigKurz: "Il me tient à cœur que la matière actuelle soit bien comprise et que l'on apprenne à aborder les mathématiques de manière durable.",
      kontakt: "Pour convenir d'une leçon, vous pouvez me contacter par WhatsApp (078 693 68 98).",
      infos: "Plus d'informations : www.mathetogo.xyz",
    };
  if (f.typ === "du")
    return {
      intro: "gerne unterstütze ich dich in Mathematik und Physik, entweder online oder in Zürich, auf Deutsch oder Englisch.",
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
      wichtig: `Mir ist wichtig, dass ${f.nom} nicht nur den aktuellen Stoff versteht, sondern auch lernt, wie man Mathematik sinnvoll und nachhaltig angeht. Dabei unterstütze ich ${f.akk} auch bei Lernstrategie, Struktur und Motivation.`,
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
    wichtig: "Mir ist wichtig, dass nicht nur der aktuelle Stoff verstanden wird, sondern auch ein sinnvoller und nachhaltiger Umgang mit Mathematik entsteht. Dabei helfe ich auch bei Lernstrategie, Struktur und Motivation.",
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
  if (f.typ === "fr")
    return "Il vaut la peine de travailler de manière ciblée sur les exercices typiques et les thèmes essentiels, et c'est exactement ainsi que je construis mes leçons.";
  const thema = isOfferLevel(a.kategorie) ? THEMA[a.kategorie] : "die Nachhilfe";
  const mit = f.typ === "du" ? " mit dir" : f.typ === "eltern" ? ` mit ${f.dat}` : "";
  return `Gerade für ${thema} lohnt es sich, gezielt an den typischen Aufgaben und den wichtigsten Themen zu arbeiten, und genau so baue ich die Lektionen${mit} auf.`;
}

// ── Kurs-Hinweis (Academigo) ──────────────────────────────────────────────────

/**
 * Fester Absatz statt Kursblock, wenn kein passender Kurs offen ist (Schalter "Kurs-Hinweis", Entscheid 6.11.).
 * Nie von der KI. Die Website steht nur als Hinweis auf Academigo — kein "dort anmelden / dort finden".
 */
export function courseHint(f: Form, preisAb: number): string {
  const head = "Neben dem Einzelunterricht biete ich über meine Kursplattform Academigo (www.academigo.xyz) auch Kurse in kleinen Gruppen an, ab CHF {preisAb} pro Lektion. Ein Kurs findet jeweils statt, sobald genügend Anmeldungen für eine Stufe zusammenkommen.";
  const text =
    f.typ === "en"
      ? "In addition to private lessons, I also offer small-group courses through my course platform Academigo (www.academigo.xyz), starting at CHF {preisAb} per lesson. A course takes place once enough students have signed up for a given level. If you are interested, just let me know. I will check whether a suitable course is running or planned and get back to you."
      : f.typ === "fr"
        ? "En plus des cours particuliers, je propose également des cours en petits groupes via ma plateforme de cours Academigo (www.academigo.xyz), à partir de CHF {preisAb} par leçon. Un cours a lieu dès que le nombre d'inscriptions est suffisant pour un niveau. Si cela vous intéresse, n'hésitez pas à me le faire savoir. Je vérifierai si un cours adapté est en cours ou prévu, et je reviendrai vers vous."
        : f.typ === "du"
          ? `${head} Wenn du Interesse hast, gib mir kurz Bescheid. Ich prüfe dann, ob ein passender Kurs läuft oder geplant ist, und melde mich bei dir.`
          : f.typ === "eltern"
            ? `${head} Falls das für ${f.akk} interessant ist, geben Sie mir gerne kurz Bescheid. Ich prüfe dann, ob ein passender Kurs läuft oder geplant ist, und melde mich bei Ihnen.`
            : `${head} Bei Interesse geben Sie mir gerne kurz Bescheid. Ich prüfe dann, ob ein passender Kurs läuft oder geplant ist, und melde mich bei Ihnen.`;
  return text.replace("{preisAb}", String(preisAb));
}

/** Hinweis fuer alle ausser Erwachsene ohne BM-Bezug (BM1, BM2, Berufsmatura bekommen ihn auch als Erwachsene). */
export function hintExcluded(info: ListingInfo, kategorie: string): boolean {
  const t = `${info.schulstufe}\n${info.title}\n${info.description}`;
  if (!/erwachsen/i.test(t)) return false;
  const bm = kategorie === "bm" || new RegExp("(?<!\\p{L})bm ?[12]?(?!\\p{L})|berufsmatur", "iu").test(t);
  return !bm;
}

/** Was der Hinweis nie sagen darf: Kurse auf der Website finden oder sich dort anmelden; Website ohne http(s). */
const HINT_FORBIDDEN = [
  /https?:\/\/(www\.)?academigo/i,
  /academigo[^.\n]*\b(anmelden|buchen|finden|einschreiben|sign up|register|book|find|inscri\w*|réserv\w*|trouve\w*)\b/i,
  /(auf|unter|über) (der|meiner) (website|webseite|seite)[^.\n]*\b(anmelden|buchen|finden)\b/i,
];

/** Fuer den franzoesischen KI-Text: Hinweis als eigener Absatz vor dem Gruss am Ende. */
export function insertHintBeforeClosing(text: string, hint: string): string {
  const paras = text.trim().split(/\n\s*\n/);
  if (paras.length < 2) return `${text.trim()}\n\n${hint}`;
  // Letzter Absatz = Gruss + Name ("Meilleures salutations\nOmid"); kurzer vorletzter Gruss ("Cordialement,") ebenfalls davor.
  let at = paras.length - 1;
  if (at > 1 && /^[^\n.!?]{1,30},$/.test(paras[at - 1].trim())) at--;
  paras.splice(at, 0, hint);
  return paras.join("\n\n");
}

export function buildFirstMessage(f: Form, personal: string, course: Course | null, privatePrice: number, hint: string | null = null): string {
  const p = parts(f);
  return [
    `${greeting(f)},`,
    `${p.intro} ${p.credentials}`,
    personal.trim(),
    ...(course ? [courseBlock(course, privatePrice, sprache(f))] : hint ? [hint] : []),
    `${p.lehrmittel} ${p.plattform}`,
    p.meet,
    course || hint ? p.wichtigKurz : p.wichtig,
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
export function buildFollowup(kind: FollowupKind, f: Form, name: string, course: Course | null, privatePrice: number): string {
  // Name nur in der du-Fassung: bei Eltern/unklar ist der Kontoname oft das Kind ("Guten Tag Alen, … für Ihren Sohn").
  // Englisch/Franzoesisch kennen die Unterscheidung nicht → ohne Name, wie die Erst-Nachricht.
  const hello = `${greeting(f)}${f.typ === "du" && name.trim() ? ` ${name.trim()}` : ""},`;
  // Franzoesisch (und jede Art ohne Kurs): einfaches Nachfassen, vous-Form wie die Erst-Nachricht.
  if (f.typ === "fr" || kind === "einfach" || !course) {
    const body =
      f.typ === "fr"
        ? "Je vous avais contacté il y a quelque temps au sujet de votre demande de cours particuliers en mathématiques et en physique. Si vous cherchez toujours, je serais ravi de vous aider. Une courte réponse ici dans le chat suffit."
        : f.typ === "en"
          ? "I got in touch with you a while ago about your request for tutoring. In case you are still looking, I would be happy to help. A short answer here in the chat is enough."
          : `ich hatte mich vor einiger Zeit auf ${isDu(f) ? "deine" : "Ihre"} Anfrage für Nachhilfe gemeldet. ${isDu(f) ? "Falls du noch suchst" : "Falls Sie noch suchen"}, helfe ich gerne weiter. Eine kurze Antwort hier im Chat reicht.`;
    return [hello, body, signature(f)].join("\n\n");
  }
  const c = course;
  const block = courseBlock(c, privatePrice, sprache(f));
  // "14.11." endet schon mit Punkt und schliesst den Satz ab (kein "14.11..").
  const deadline = dayMonth(c.deadline).replace(/([^.])$/, "$1.");
  let body: string[];
  if (f.typ === "en") {
    const fach = FACH_EN[c.fach] ?? c.fach;
    const ref = `I got in touch with you a while ago about your request for ${fach} tutoring.`;
    const close = 'Shall I reserve a place for you? A short "Yes" here in the chat is enough, and I will send you all the details. Payment is only due once the course is confirmed.';
    body =
      kind === "erinnerung"
        ? [`${ref} In that message I also mentioned the ${courseName(c, "en")}. There are still places available; registration closes on ${deadline}`, close]
        : kind === "geaendert"
          ? [`${ref} In that message I also mentioned the ${courseName(c, "en")}. Some details have changed since then, here is the current information:`, block, close]
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
        ? [`${ref} ${erwaehnt} Es hat noch freie Plätze, Anmeldeschluss ist der ${deadline}`, close]
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
/**
 * Ziele, die der Satz nur nennen darf, wenn das Inserat sie nennt (sonst erfindet die KI z.B. "Matura" bei Sek-Inseraten).
 * satz: woran der Satz das Ziel nennt; inserat: woran das Inserat es nennt.
 */
const GOALS: Array<{ name: string; satz: RegExp; inserat: RegExp }> = [
  { name: "Matura", satz: /matur/i, inserat: /matur/i },
  { name: "BM", satz: new RegExp("(?<!\\p{L})bm(?!\\p{L})|berufsmatur", "iu"), inserat: new RegExp("(?<!\\p{L})bms?\\d?(?!\\p{L})|berufsmatur", "iu") },
  { name: "Gymiprüfung", satz: /gymipr|aufnahmepr|entrance exam/i, inserat: /gymipr|aufnahmepr|\bzap\b|entrance exam|(ins|ans|aufs) (gymi|gymnasium|kanti|langgymi|kurzgymi)|kanti-?pr/i },
  { name: "Probezeit", satz: /probezeit|probation/i, inserat: /probezeit|probation/i },
];

const re = (s: string) => new RegExp(s, "u");
/** Falsche Fälle bei "Ihr Kind / Ihr Sohn / Ihre Tochter" (z. B. KI: "übe mit Ihr Kind"). */
const WRONG_CHILD_CASE = [
  re("(?<!\\p{L})(mit|bei|von|zu|nach|aus|seit|gegenüber) (Ihr|Ihre|Ihren) (Kind|Sohn|Tochter)(?!\\p{L})"),
  re("(?<!\\p{L})(Ihr Tochter|Ihre (Sohn|Kind)|Ihren (Tochter|Kind)|Ihrem Tochter|Ihrer (Sohn|Kind))(?!\\p{L})"),
  re("(?<!\\p{L})(für|um|ohne|gegen|durch) (Ihr Sohn|Ihrem (Sohn|Kind)|Ihrer Tochter)(?!\\p{L})"),
];
const OTHER_SUBJECT = new RegExp(
  "(?<!\\p{L})(deutsch\\p{L}*|französisch\\p{L}*|englisch\\p{L}*|Latein|Chemie|Biologie|English|German|French|allemand|anglais|français|linguistique\\p{L}*)(?!\\p{L})",
  "iu"
);
const PLURAL_STUDENTS = new RegExp("(?<!\\p{L})(Schüler(innen)?|Lernenden|students|élèves)(?!\\p{L})", "iu");
/** deutsche Woerter und Schulbegriffe in einem englischen/franzoesischen Satz */
const FOREIGN_GERMAN = new RegExp(
  "(?<!\\p{L})(der|die|das|und|ich|ist|wird|wenn|wir|mit|für|Primarschule|Primarklasse|Sekundarstufe|Sekundarschule|Oberstufe|Bezirksschule|Bezirkschule)(?!\\p{L})",
  "iu"
);
const PLACEHOLDER = re("\\[|\\]|\\{|\\}|undefined|(?<!\\p{L})null(?!\\p{L})|NaN|TODO|KI-SATZ");

/**
 * Rechtschreib- und Formfehler, die nie rausgehen duerfen (fester Text, KI-Satz, Kursdaten); null = in Ordnung.
 * fr: Leerzeichen vor : ; ? ! ist dort richtig.
 */
export function formProblem(text: string, lang: "de" | "en" | "fr" = "de"): string | null {
  if (/ß/.test(text)) return "„ß“ statt „ss“";
  if (/[^\S\n]{2,}/.test(text)) return "doppeltes Leerzeichen";
  if (/[ \t]+\n|\n[ \t]+\S/.test(text)) return "Leerzeichen am Zeilenanfang oder -ende";
  if (/\n{3,}/.test(text)) return "leerer Absatz";
  if ((text.match(/\(/g)?.length ?? 0) !== (text.match(/\)/g)?.length ?? 0)) return "Klammer nicht geschlossen";
  if (re("\\d\\.\\p{Lu}\\p{Ll}").test(text)) return "fehlendes Leerzeichen nach Satzzeichen";
  // ".," bleibt erlaubt: "Anmeldeschluss ist der 14.11., der Kurs …"
  if (/(?<!\.)\.\.(?!\.)|,,|,\.|!!|\?\?/.test(text)) return "doppelte Satzzeichen";
  if ((lang === "fr" ? / [.,]/ : / [.,;:!?]/).test(text)) return "Leerzeichen vor Satzzeichen";
  // "Stoff.Ich" / "Stoff,ich": fehlendes Leerzeichen (Links wie www.mathetogo.xyz und Daten 21.11. bleiben erlaubt)
  if (re("\\p{Ll}{2}[.!?,;]\\p{Lu}").test(text) || re("\\p{L}{2},\\p{L}").test(text)) return "fehlendes Leerzeichen nach Satzzeichen";
  const dbl = text.match(new RegExp("(?<!\\p{L})(\\p{L}{2,})\\s+\\1(?!\\p{L})", "iu"));
  if (dbl && !/^(die|das|der|sie|que|nous|vous)$/i.test(dbl[1])) return `doppeltes Wort „${dbl[1]}“`;
  if (PLACEHOLDER.test(text)) return "leerer oder nicht ersetzter Platzhalter";
  if (/Hallo zusammen|Bonjour à tous|Hello everyone/i.test(text)) return "Gruss an mehrere („Hallo zusammen“)";
  if (lang === "de") {
    const wrong = WRONG_CHILD_CASE.map((r) => text.match(r)?.[0]).find(Boolean);
    if (wrong) return `falscher Fall: „${wrong.trim()}“`;
  }
  return null;
}

/** Pruefung des persoenlichen KI-Satzes; null = in Ordnung. inserat: Titel, Stufe und Text (fuer erfundene Ziele). */
export function sentenceProblem(s: string, f: Form, inserat?: string): string | null {
  const t = s.trim();
  if (!t) return "leer";
  if (!/[.!?]$/.test(t)) return "Satz endet ohne Punkt";
  const form = formProblem(t, f.typ === "en" ? "en" : f.typ === "fr" ? "fr" : "de");
  if (form) return form;
  if (t.split(/\s+/).length > 45) return "zu lang";
  if (/https?:|www\.|@|\d{3} ?\d{3}/.test(t)) return "Link oder Nummer";
  if (/\b(ETH|12 Jahre|12 years|Plattform|platform|Mathetogo|Google Meet|Gruppe|group|Kurs|course|CHF|Preis|price)\b/i.test(t)) return "wiederholt festen Text oder Kurs";
  // Der feste Text davor beginnt schon mit "gerne unterstütze ich …" / "I would be happy to help".
  if (/^(gerne|ich|i would|i'd|je serais|je suis ravi)\b|unterstütze ich|happy to help|ravi de vous aider/i.test(t)) return "wiederholt den Anfang";
  // 9.11.: "compétences linguistiques en allemand", "erkläre … in Englisch"; nur Mathematik/Physik
  if (OTHER_SUBJECT.test(t)) return "nennt ein anderes Fach oder eine Sprache";
  // Einzelunterricht: nicht "mit den Schülern" / "I help students"
  if (PLURAL_STUDENTS.test(t)) return "spricht von Schülern/Lernenden statt von dieser Person";
  if ((f.typ === "en" || f.typ === "fr") && FOREIGN_GERMAN.test(t)) return "Satz nicht in der Sprache der Nachricht";
  if (inserat !== undefined) {
    const invented = GOALS.find((g) => g.satz.test(t) && !g.inserat.test(inserat));
    if (invented) return `nennt „${invented.name}“, das Inserat aber nicht`;
  }
  return anredeProblem(t, f);
}

/** Text des Inserats fuer die Ziel-Pruefung. */
export const listingText = (l: { title: string; schulstufe: string; description: string }) => `${l.title}\n${l.schulstufe}\n${l.description}`;

function anredeProblem(text: string, f: Form): string | null {
  // Englisch/Franzoesisch: keine du/Sie-Pruefung (franzoesisch "du" ist ein Artikel).
  if (f.typ === "en" || f.typ === "fr") return null;
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
  const form = formProblem(text, f.typ === "en" ? "en" : f.typ === "fr" ? "fr" : "de");
  if (form) return form;
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

/** Erst-Nachricht: allgemeine Pruefung, dazu der Kurs-Hinweis wortgleich in der Sprache der Nachricht. */
export function firstMessageProblem(text: string, f: Form, course: Course | null, privatePrice: number, hint: string | null = null) {
  if (hint !== null) {
    if (!text.includes(hint)) return "Kurs-Hinweis nicht wortgleich";
    if (course) return "Kursblock und Kurs-Hinweis zusammen";
  }
  const bad = HINT_FORBIDDEN.find((re) => re.test(text));
  if (bad) return "deutet an, dass man die Kurse auf der Website findet oder sich dort anmeldet";
  return messageCheck("erst", text, f, course, privatePrice);
}

/** Nachfass-Text samt Pruefung — derselbe fuer Tab, API und Sende-Lauf. */
export function followupMessage(kind: FollowupKind, f: Form, name: string, course: Course | null, privatePrice: number) {
  const text = buildFollowup(kind, f, name, course, privatePrice);
  const withBlock = kind !== "erinnerung" && kind !== "frage" && kind !== "einfach" && f.typ !== "fr";
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
  spracheListing: string = "de",
  /** Batch-Vorschau: Anrede von Hand umgestellt */
  anredeOverride?: Addressee
) {
  const analysis = analyzeListing(info);
  const addressee = anredeOverride ?? detectAddressee(info.description);
  // Franzoesisch: eigene Form (vous), fester Text wie de/en (seit 9.11.).
  const form: Form = spracheListing === "fr" ? { typ: "fr" } : formFor(addressee, spracheListing);
  const offer = pickCourse(analysis, courses, settings, log, now);
  // Schalter "Kursblock": nur dann ein konkreter Kurs (bisherige Ausschluesse in pickCourse). Franzoesisch: nie.
  // Englisch ohne englischen Kursnamen: Hinweis statt eines deutschen Kursnamens im englischen Text.
  const course =
    settings.newFirstMessage && offer.kind === "kurs" && form.typ !== "fr" && !(form.typ === "en" && !offer.course.nameEn?.trim()) ? offer.course : null;
  // Schalter "Kurs-Hinweis": ohne Kursblock, fuer alle ausser Erwachsene ohne BM-Bezug.
  const hint = settings.kursHinweis && !hintExcluded(info, analysis.kategorie) ? courseHint(form, settings.kursPreisAb) : null;
  return {
    analysis, addressee, form, offer, course, hint,
    privatePrice: settings.privatePricePerLesson, inserat: listingText(info),
  };
}

/**
 * Text zusammensetzen: mit Kursblock, sonst (ohne Kurs) mit Hinweis; jeweils KI-Satz, sonst Rueckfall-Satz.
 * problem != null: auch der Rueckfall besteht die Pruefung nicht (dann alter Text, lib/tutor24.ts).
 */
export function assembleFirstMessage(plan: ReturnType<typeof planFirstMessage>, personal: string | null) {
  const fallback = fallbackSentence(plan.analysis, plan.form);
  const kiOk = personal && !sentenceProblem(personal, plan.form, plan.inserat);
  const sentence = kiOk ? personal! : fallback;
  const variants: Array<{ course: Course | null; hint: string | null }> = plan.course
    ? [{ course: plan.course, hint: null }, { course: null, hint: plan.hint }]
    : [{ course: null, hint: plan.hint }];
  for (const v of variants) {
    for (const s of kiOk ? [sentence, fallback] : [fallback]) {
      const text = buildFirstMessage(plan.form, s, v.course, plan.privatePrice, v.hint);
      if (!firstMessageProblem(text, plan.form, v.course, plan.privatePrice, v.hint))
        return { text, course: v.course, hint: v.hint, satz: s === fallback ? "fallback" : "ki", problem: null as string | null };
    }
  }
  const last = variants[variants.length - 1];
  const text = buildFirstMessage(plan.form, fallback, null, plan.privatePrice, last.hint);
  return { text, course: null, hint: last.hint, satz: "fallback", problem: firstMessageProblem(text, plan.form, null, plan.privatePrice, last.hint) };
}

// ── Vorschau und Pruefung beim Speichern (/kurse) ─────────────────────────────

export type PreviewArt = "erst" | "nachfassen";
export type PreviewWer = "du" | "eltern" | "unklar" | "en";

const GROUP_LEVEL: Record<string, OfferLevel> = {
  matura: "matura", bm: "bm", zap_lang: "gymivorbereitung", zap_kurz: "gymivorbereitung",
  gymi_unter: "gymi", gymi_mittel: "gymi", sek1: "sek", sek2: "sek", sek3: "sek",
};

const previewForm = (wer: PreviewWer): Form =>
  wer === "du" ? { typ: "du" } : wer === "eltern" ? { typ: "eltern", ...CHILD.Tochter } : wer === "en" ? { typ: "en" } : { typ: "neutral" };

/**
 * Nachricht, wie sie mit diesem Kurs rausginge — auch fuer einen ungespeicherten Entwurf.
 * Erst-Nachricht mit dem Ersatzsatz als Beispiel fuer den persoenlichen Satz (der echte kommt aus dem Inserat).
 * Eltern-Beispiel: "Ihre Tochter".
 */
export function previewMessage(c: Course, privatePrice: number, art: PreviewArt, wer: PreviewWer) {
  const f = previewForm(wer);
  if (art === "nachfassen") {
    const m = followupMessage(c.gruppe === "offen" ? "frage" : "angebot", f, "Lea", c, privatePrice);
    return { text: m.text, problem: m.problem };
  }
  if (c.gruppe === "offen") return { text: "Die Kursgruppe „Stufe offen“ erscheint nicht in der Erst-Nachricht, nur im Nachfassen.", problem: null };
  const kategorie = GROUP_LEVEL[c.gruppe] ?? "sek";
  const satz = fallbackSentence({ kategorie } as Analysis, f);
  const text = buildFirstMessage(f, satz, c, privatePrice);
  return { text, problem: firstMessageProblem(text, f, c, privatePrice) };
}

export type FieldIssue = { field: string; msg: string };

/** "9:30–11:10 Uhr" oder "09:30-11:10": Start und Ende als Minuten; null = falsches Format. */
export function parseTimeRange(t: string): { start: number; end: number } | null {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})(\s*Uhr)?$/);
  if (!m) return null;
  const [h1, m1, h2, m2] = [m[1], m[2], m[3], m[4]].map(Number);
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
  return { start: h1 * 60 + m1, end: h2 * 60 + m2 };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const wholeIn = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;

/**
 * Pruefung eines Kurses beim Speichern auf /kurse: errors verhindern das Speichern, warnings nur anzeigen.
 * field = Formularfeld, bei dem die Meldung steht ("vorschau" = Nachrichtentext besteht CHECK_RULES nicht).
 */
export function checkCourse(c: Course, all: Course[], privatePrice: number, now = new Date()): { errors: FieldIssue[]; warnings: FieldIssue[] } {
  const errors: FieldIssue[] = [];
  const warnings: FieldIssue[] = [];
  const err = (field: string, msg: string) => errors.push({ field, msg });
  if (!c.name.trim()) err("name", "Name fehlt.");
  if (containsForbiddenContact(c.name)) err("name", "Kein Link, keine E-Mail, keine Telefonnummer im Namen.");
  if (containsForbiddenContact(c.nameEn ?? "")) err("nameEn", "Kein Link, keine E-Mail, keine Telefonnummer im Namen.");
  if (!c.fach.trim()) err("fach", "Fach fehlt.");

  if (c.gruppe !== "offen") {
    if (containsForbiddenContact(c.place)) err("place", "Kein Link, keine E-Mail, keine Telefonnummer im Ort.");
    if (c.mode === "vor Ort" && !c.place.trim()) err("place", "Bei „vor Ort“ bitte den Ort angeben.");
    const dates = c.saturdays;
    if (dates.length !== 4 || dates.some((d) => !ISO_DAY.test(d))) err("saturdays", "Bitte vier Termine angeben.");
    else {
      if (dates.some((d, i) => i > 0 && d <= dates[i - 1])) err("saturdays", "Die Termine sind nicht in der richtigen Reihenfolge.");
      const today = isoOf(now);
      if (dates.some((d) => d < today)) warnings.push({ field: "saturdays", msg: "Ein Termin liegt in der Vergangenheit." });
    }
    if (!ISO_DAY.test(c.deadline)) err("deadline", "Anmeldeschluss fehlt.");
    else if (ISO_DAY.test(dates[0] ?? "") && c.deadline >= dates[0]) err("deadline", "Der Anmeldeschluss muss vor dem ersten Termin liegen.");
    const time = parseTimeRange(c.time);
    if (!time) err("time", "Uhrzeit im Format HH:MM–HH:MM, z.B. 9:30–11:10.");
    else if (time.end <= time.start) err("time", "Das Ende muss nach dem Beginn liegen.");
    if (!wholeIn(c.pricePerLesson, 1, 500)) err("pricePerLesson", "Preis pro Lektion: ganze Zahl zwischen 1 und 500.");
    if (!wholeIn(c.lessons, 1, 40)) err("lessons", "Lektionen: ganze Zahl zwischen 1 und 40.");
    if (!wholeIn(capacity(c), 1, 30)) err("maxParticipants", "Plätze: ganze Zahl zwischen 1 und 30.");
    if (!wholeIn(c.minParticipants, 1, 30)) err("minParticipants", "Min. Teilnehmende: ganze Zahl zwischen 1 und 30.");
    else if (c.minParticipants > capacity(c)) err("minParticipants", "Min. Teilnehmende darf nicht grösser als die Plätze sein.");

    // Ueberschneidung mit einem anderen aktiven Kurs: gleicher Samstag, Uhrzeiten ueberlappen.
    if (time) {
      for (const o of all) {
        if (o.id === c.id || !o.active || o.gruppe === "offen") continue;
        const ot = parseTimeRange(o.time);
        const same = o.saturdays.filter((d) => c.saturdays.includes(d));
        if (ot && same.length && ot.start < time.end && time.start < ot.end)
          warnings.push({ field: "time", msg: `Überschneidet sich mit „${o.name}“ (${same.map((d) => d.slice(8, 10) + "." + d.slice(5, 7) + ".").join(", ")}).` });
      }
    }
  }

  // Nachrichtentext: alle Fassungen muessen die normale Pruefung vor dem Senden bestehen (CHECK_RULES).
  if (!errors.length) {
    const forms: PreviewWer[] = ["du", "eltern", "unklar", "en"];
    for (const art of ["erst", "nachfassen"] as const) {
      for (const wer of forms) {
        const p = previewMessage(c, privatePrice, art, wer);
        if (p.problem) {
          err("vorschau", `${art === "erst" ? "Erst-Nachricht" : "Nachfassen"} (${wer}): ${p.problem}`);
          break;
        }
      }
    }
  }
  return { errors, warnings };
}
