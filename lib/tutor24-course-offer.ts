/**
 * Erst-Nachricht auf tutor24 mit passendem Gruppenkurs.
 *
 * Reine Logik ohne Browser und Datenbank: Kurswahl, Text in drei Anredeformen,
 * Kursblock aus den Kursdaten (nie von der KI), Pruefung vor dem Senden.
 * Kurse kommen aus tutor24-followup/courses.json (Seite /kurse).
 */
import {
  PRIVATE_PRICE_PER_LESSON,
  analyzeListing,
  capacity,
  courseExclusion,
  courseStats,
  detectAddressee,
  findDuForm,
  formatSaturdays,
  isOfferLevel,
  splitList,
  type Addressee,
  type Course,
  type FollowupSettings,
  type ListingInfo,
  type LogRow,
  type OfferLevel,
} from "./tutor24-followup";

export type Analysis = ReturnType<typeof analyzeListing>;

export const DEMAND_REASONS = ["kein_kurs", "anmeldeschluss_vorbei", "ausgebucht", "nur_vor_ort", "kurs_vorhanden_unsicher"] as const;
export type DemandReason = (typeof DEMAND_REASONS)[number];

export type Offer =
  | { kind: "kurs"; course: Course }
  /** Stufe erkannt, aber kein Kurs angeboten: wird in course_demand erfasst. */
  | { kind: "nachfrage"; grund: DemandReason; kursId: string | null; fach: string }
  | { kind: "nichts"; grund: string };

const isoToday = (now: Date) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** Warum ein Kurs fuer dieses Inserat nicht geht; null = geht. */
function blockReason(c: Course, a: Analysis, log: Array<Partial<LogRow>>, now: Date): DemandReason | null {
  if (c.deadline < isoToday(now)) return "anmeldeschluss_vorbei";
  if (courseStats(c, log, now).zusagen >= capacity(c)) return "ausgebucht";
  if (c.mode === "online" && a.ort === "vor Ort") return "nur_vor_ort";
  return null;
}

// Wenn mehrere Kurse in Frage kommen: der Grund, der einem Angebot am naechsten ist.
const REASON_RANK: DemandReason[] = ["nur_vor_ort", "ausgebucht", "anmeldeschluss_vorbei", "kein_kurs"];

export function pickCourse(
  info: ListingInfo,
  a: Analysis,
  courses: Course[],
  settings: FollowupSettings,
  log: Array<Partial<LogRow>>,
  now = new Date()
): Offer {
  if (!isOfferLevel(a.kategorie)) return { kind: "nichts", grund: `stufe_${a.kategorie}` };
  if (!a.kursgruppe || a.kursgruppe === "offen" || a.sicherheit === "tief") return { kind: "nichts", grund: "stufe_ohne_jahr" };
  const excl = courseExclusion(info);
  if (excl) return { kind: "nichts", grund: `ausschluss_${excl}` };
  const subjects = splitList(a.faecher).filter((f) => settings.mySubjects.includes(f));
  if (!subjects.length) return { kind: "nichts", grund: "fach_nicht_meins" };

  // Pausierte Kurse zaehlen als "kein Kurs": nur aktive werden angeboten.
  let best: { grund: DemandReason; kursId: string | null; fach: string } = { grund: "kein_kurs", kursId: null, fach: subjects[0] };
  for (const fach of subjects) {
    for (const c of courses.filter((x) => x.active && x.fach === fach && x.gruppe === a.kursgruppe)) {
      const why = blockReason(c, a, log, now);
      if (!why) {
        if (a.sicherheit === "hoch") return { kind: "kurs", course: c };
        return { kind: "nachfrage", grund: "kurs_vorhanden_unsicher", kursId: c.id, fach };
      }
      if (REASON_RANK.indexOf(why) < REASON_RANK.indexOf(best.grund)) best = { grund: why, kursId: c.id, fach };
    }
  }
  return { kind: "nachfrage", ...best };
}

// ── Text ──────────────────────────────────────────────────────────────────────

/** Nominativ, Akkusativ, Dativ: "Ihre Tochter" / "Ihren Sohn" / "Ihrem Kind". */
const CHILD: Record<"Tochter" | "Sohn" | "Kind", { nom: string; akk: string; dat: string }> = {
  Tochter: { nom: "Ihre Tochter", akk: "Ihre Tochter", dat: "Ihrer Tochter" },
  Sohn: { nom: "Ihr Sohn", akk: "Ihren Sohn", dat: "Ihrem Sohn" },
  Kind: { nom: "Ihr Kind", akk: "Ihr Kind", dat: "Ihrem Kind" },
};

/** Welche der drei Fassungen: Eltern ohne genau ein genanntes Kind bekommen die neutrale. */
export type Form = { typ: "du" } | { typ: "eltern"; nom: string; akk: string; dat: string } | { typ: "neutral" };
export function formFor(ad: Addressee): Form {
  if (ad.wer === "schueler") return { typ: "du" };
  if (ad.wer === "eltern" && ad.kind) return { typ: "eltern", ...CHILD[ad.kind] };
  return { typ: "neutral" };
}

const CREDENTIALS =
  "Ich unterrichte seit über 12 Jahren, habe an der ETH studiert und begleite aktuell mehr als 30 aktive Schüler, die meisten auf Gymi- oder Universitätsniveau. Entsprechend gut kenne ich die Anforderungen, typischen Fehler und relevanten Themen über alle Stufen hinweg.";
const LEHRMITTEL =
  "Für meinen Unterricht habe ich eigene Lehrmittel für die Gymivorbereitung, BM-Vorbereitung sowie verschiedene Gymi- und BM-Stufen entwickelt. Zusätzlich habe ich die Lernplattform Mathetogo programmiert (www.platform.mathetogo.xyz).";

type Parts = { gruss: string; intro: string; plattform: string; meet: string; wichtig: string; wichtigKurz: string; kontakt: string; infos: string };

function parts(f: Form): Parts {
  if (f.typ === "du")
    return {
      gruss: "Hallo",
      intro: "gerne unterstütze ich dich in Mathematik und der Physik, entweder online oder in Zürich, auf Deutsch oder Englisch.",
      plattform: "Dort arbeitest du mit klar strukturierten Inhalten, löst gezielte Aufgaben, hältst deinen Lösungsweg fest und erhältst persönliches Feedback. Ergänzende Quizzes helfen dir, deinen Lernstand realistisch einzuschätzen und gezielt Fortschritte zu machen.",
      meet: "Online-Lektionen finden über Google Meet statt. Ich erkläre den Stoff verständlich und visuell mit dem iPad, und nach jeder Lektion erhältst du die bearbeiteten Unterlagen, damit du alles nochmals in Ruhe nachvollziehen kannst.",
      wichtig: "Mir ist wichtig, dass du nicht nur den aktuellen Stoff verstehst, sondern auch lernst, wie man Mathematik sinnvoll und nachhaltig angeht. Dabei unterstütze ich dich auch in Bezug auf Lernstrategie, Struktur und Motivation.",
      wichtigKurz: "Mir ist wichtig, dass du nicht nur den aktuellen Stoff verstehst, sondern lernst, Mathematik nachhaltig anzugehen.",
      kontakt: "Wenn du deine Mathematikkenntnisse in einer ruhigen, unterstützenden Atmosphäre verbessern möchtest, melde dich gerne per WhatsApp für eine Terminvereinbarung (078 693 68 98).",
      infos: "Weitere Infos findest du hier: www.mathetogo.xyz",
    };
  if (f.typ === "eltern")
    return {
      gruss: "Guten Tag",
      intro: `gerne unterstütze ich ${f.akk} in Mathematik und Physik, entweder online oder in Zürich, auf Deutsch oder Englisch.`,
      plattform: `Dort arbeitet ${f.nom} mit klar strukturierten Inhalten, löst gezielte Aufgaben, hält den Lösungsweg fest und erhält persönliches Feedback. Ergänzende Quizzes helfen, den Lernstand realistisch einzuschätzen und gezielt Fortschritte zu machen.`,
      meet: `Online-Lektionen finden über Google Meet statt. Ich erkläre den Stoff verständlich und visuell mit dem iPad, und nach jeder Lektion erhält ${f.nom} die bearbeiteten Unterlagen, damit sich alles nochmals in Ruhe nachvollziehen lässt.`,
      wichtig: `Mir ist wichtig, dass ${f.nom} nicht nur den aktuellen Stoff versteht, sondern auch lernt, wie man Mathematik sinnvoll und nachhaltig angeht. Dabei unterstütze ich auch in Bezug auf Lernstrategie, Struktur und Motivation.`,
      wichtigKurz: `Mir ist wichtig, dass ${f.nom} nicht nur den aktuellen Stoff versteht, sondern lernt, Mathematik nachhaltig anzugehen.`,
      kontakt: "Wenn Sie Interesse haben, melden Sie sich gerne per WhatsApp für eine Terminvereinbarung (078 693 68 98).",
      infos: "Weitere Infos finden Sie hier: www.mathetogo.xyz",
    };
  return {
    gruss: "Guten Tag",
    intro: "gerne biete ich Nachhilfe in Mathematik und Physik an, entweder online oder in Zürich, auf Deutsch oder Englisch.",
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

/** Kursblock nur aus den Kursdaten. Ohne du/Sie: passt in alle drei Fassungen. */
export function courseBlock(c: Course): string {
  const ort = c.mode === "online" ? "online" : `vor Ort${c.place.trim() ? ` (${c.place.trim()})` : ""}`;
  return (
    `Neben dem Einzelunterricht biete ich zurzeit einen ${c.name.trim()} in einer kleinen Gruppe an (maximal ${capacity(c)} Teilnehmende): ` +
    `an ${c.saturdays.length} Samstagen (${formatSaturdays(c.saturdays)}), jeweils ${c.time.trim()}, ${ort}. ` +
    `Die ${c.lessons} Lektionen kosten zusammen CHF ${c.pricePerLesson * c.lessons}, also CHF ${c.pricePerLesson} pro Lektion statt CHF ${PRIVATE_PRICE_PER_LESSON} im Einzelunterricht. ` +
    `Anmeldeschluss ist der ${dayMonth(c.deadline)}, der Kurs findet ab ${c.minParticipants} Anmeldungen statt.`
  );
}

const THEMA: Record<OfferLevel, string> = {
  matura: "die Maturavorbereitung",
  bm: "die BM-Vorbereitung",
  gymivorbereitung: "die Vorbereitung auf die Gymiprüfung",
  gymi: "den Stoff am Gymnasium",
  sek: "den Stoff der Sekundarstufe",
};

/** Persoenlicher Satz ohne KI: Rueckfall, wenn die KI fehlt oder ihr Satz die Pruefung nicht besteht. */
export function fallbackSentence(a: Analysis, f: Form): string {
  const thema = isOfferLevel(a.kategorie) ? THEMA[a.kategorie] : "die Nachhilfe";
  const mit = f.typ === "du" ? " mit dir" : f.typ === "eltern" ? ` mit ${f.dat}` : "";
  return `Gerade für ${thema} lohnt es sich, gezielt an den typischen Aufgaben und den wichtigsten Themen zu arbeiten, und genau so baue ich die Lektionen${mit} auf.`;
}

export function buildFirstMessage(f: Form, personal: string, course: Course | null): string {
  const p = parts(f);
  return [
    `${p.gruss},`,
    `${p.intro} ${CREDENTIALS}`,
    personal.trim(),
    ...(course ? [courseBlock(course)] : []),
    `${LEHRMITTEL} ${p.plattform}`,
    p.meet,
    course ? p.wichtigKurz : p.wichtig,
    p.kontakt,
    p.infos,
    "Liebi Grüess\nOmid",
  ].join("\n\n");
}

// ── Pruefung ──────────────────────────────────────────────────────────────────

const SIE_FORM = new RegExp("(?<!\\p{L})(Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer)(?!\\p{L})", "u");
const CHILD_NOUN = new RegExp("(?<!\\p{L})(Ihr(?:e|en|em|er)?) (Kind|Kinder|Sohn|Tochter)(?!\\p{L})", "gu");

/** Pruefung des persoenlichen KI-Satzes; null = in Ordnung. */
export function sentenceProblem(s: string, f: Form): string | null {
  const t = s.trim();
  if (!t) return "leer";
  if (t.split(/\s+/).length > 45) return "zu lang";
  if (/https?:|www\.|@|\d{3} ?\d{3}/.test(t)) return "Link oder Nummer";
  if (/\b(ETH|12 Jahre|Plattform|Mathetogo|Google Meet|Gruppe|Kurs|CHF|Preis)\b/i.test(t)) return "wiederholt festen Text oder Kurs";
  // Der feste Text davor beginnt schon mit "gerne unterstütze ich …".
  if (/^(gerne|ich)\b|unterstütze ich/i.test(t)) return "wiederholt den Anfang";
  return anredeProblem(t, f);
}

function anredeProblem(text: string, f: Form): string | null {
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

/** Fertige Nachricht vor dem Senden; null = in Ordnung. */
export function firstMessageProblem(text: string, f: Form, course: Course | null): string | null {
  if (/\{[a-zäöü]+\}/.test(text)) return "nicht ersetzter Platzhalter";
  const anrede = anredeProblem(text, f);
  if (anrede) return anrede;
  if (course) {
    for (const must of [`CHF ${course.pricePerLesson * course.lessons}`, formatSaturdays(course.saturdays), `Anmeldeschluss ist der ${dayMonth(course.deadline)}`])
      if (!text.includes(must)) return `Kursblock unvollständig („${must}“ fehlt)`;
  }
  return null;
}

/** Alles in einem Schritt, fuer Automation und Probelauf gleich. */
export function planFirstMessage(
  info: ListingInfo,
  courses: Course[],
  settings: FollowupSettings,
  log: Array<Partial<LogRow>>,
  now = new Date()
) {
  const analysis = analyzeListing(info);
  const addressee = detectAddressee(info.description);
  const form = formFor(addressee);
  const offer = pickCourse(info, analysis, courses, settings, log, now);
  return { analysis, addressee, form, offer, course: offer.kind === "kurs" ? offer.course : null };
}

/** Text zusammensetzen; besteht er die Pruefung mit Kurs nicht, ohne Kurs, sonst mit Rueckfall-Satz. */
export function assembleFirstMessage(plan: ReturnType<typeof planFirstMessage>, personal: string | null) {
  const fallback = fallbackSentence(plan.analysis, plan.form);
  const kiOk = personal && !sentenceProblem(personal, plan.form);
  const sentence = kiOk ? personal! : fallback;
  for (const course of plan.course ? [plan.course, null] : [null]) {
    for (const s of kiOk ? [sentence, fallback] : [fallback]) {
      const text = buildFirstMessage(plan.form, s, course);
      if (!firstMessageProblem(text, plan.form, course))
        return { text, course, satz: s === fallback ? "fallback" : "ki", problem: null as string | null };
    }
  }
  const text = buildFirstMessage(plan.form, fallback, null);
  return { text, course: null, satz: "fallback", problem: firstMessageProblem(text, plan.form, null) };
}
