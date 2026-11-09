/**
 * Tutor24 outreach — original KI-Prompt (Nachhilfe an Schüler-Gesuche).
 * Unabhängig von Academigo; nicht ändern ohne Absicht.
 */

import type { ListingProfile } from "./tutor24-messaging";
import { CHILD_FORMS, VERBOTEN_IM_SATZ, detailImInserat, nurStufe, listingText, sentenceProblem, type Form } from "./tutor24-course-offer";

/** Fixed intro — always before {{LEVEL_INSERT}}; do not personalize this block. */
export const TUTOR24_CREDENTIALS_BLOCK = `gerne unterstütze ich dich in Mathematik und der Physik, entweder online oder in Zürich, auf Deutsch oder Englisch. Ich unterrichte seit über 12 Jahren, habe an der ETH studiert und begleite aktuell mehr als 30 aktive Schüler, die meisten auf Gymi- oder Universitätsniveau. Entsprechend gut kenne ich die Anforderungen, typischen Fehler und relevanten Themen über alle Stufen hinweg.`;

export const TUTOR24_MESSAGE_TEMPLATE = `Hallo zusammen,

${TUTOR24_CREDENTIALS_BLOCK}

{{LEVEL_INSERT}}

Für meinen Unterricht habe ich eigene Lehrmittel für die Gymivorbereitung, BM-Vorbereitung sowie verschiedene Gymi- und BM-Stufen entwickelt. Zusätzlich habe ich die Lernplattform Mathetogo programmiert (www.platform.mathetogo.xyz). Dort arbeitest du mit klar strukturierten Inhalten, löst gezielte Aufgaben, hältst deinen Lösungsweg fest und erhältst persönliches Feedback. Ergänzende Quizzes helfen dir, deinen Lernstand realistisch einzuschätzen und gezielt Fortschritte zu machen.

Online-Lektionen finden über Google Meet statt. Ich erkläre den Stoff verständlich und visuell mit dem iPad, und nach jeder Lektion erhältst du die bearbeiteten Unterlagen, damit du alles nochmals in Ruhe nachvollziehen kannst.

Mir ist wichtig, dass du nicht nur den aktuellen Stoff verstehst, sondern auch lernst, wie man Mathematik sinnvoll und nachhaltig angeht. Dabei unterstütze ich dich auch in Bezug auf Lernstrategie, Struktur und Motivation.

Wenn du deine Mathematikkenntnisse in einer ruhigen, unterstützenden Atmosphäre verbessern möchtest, melde dich gerne per WhatsApp für eine Terminvereinbarung (078 693 68 98).

Weitere Infos findest du hier: www.mathetogo.xyz

Liebi Grüess
Omid`;

const FALLBACK_PARAGRAPH =
  "Gerne helfe ich dir dabei, den Stoff strukturiert zu erarbeiten und gezielt die relevanten Themen zu festigen.";

const LANG_LABEL: Record<ListingProfile["language"], string> = {
  de: "Deutsch",
  en: "English",
  fr: "French",
};

const SITE_BOILERPLATE_RE =
  /je schneller sie sich bewerben|ihre chancen auf den job|umso höher sind ihre chancen/i;

function isSiteBoilerplate(text: string): boolean {
  return SITE_BOILERPLATE_RE.test(text);
}

function profileContextForAi(profile: ListingProfile): string {
  const body = profile.bodyText.trim();
  const title = profile.pageTitle.trim();
  if (!body || isSiteBoilerplate(body)) return title;
  return `${title}\n${body}`;
}

const GERMAN_MESSAGE_MARKERS = [
  /^Hallo zusammen/m,
  /gerne unterstütze ich dich in Mathematik/i,
  /Liebi Grüess/i,
  /Für meinen Unterricht habe ich eigene Lehrmittel/i,
];

function stillLooksGerman(message: string): boolean {
  return GERMAN_MESSAGE_MARKERS.some((re) => re.test(message));
}

function parseMessageJson(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { message?: unknown };
    return typeof parsed.message === "string" ? parsed.message.trim() : null;
  } catch {
    const block = raw.match(/\{[\s\S]*\}/);
    if (!block) return null;
    try {
      const parsed = JSON.parse(block[0]) as { message?: unknown };
      return typeof parsed.message === "string" ? parsed.message.trim() : null;
    } catch {
      return null;
    }
  }
}

function buildFallbackMessage(): string {
  return TUTOR24_MESSAGE_TEMPLATE.replace("{{LEVEL_INSERT}}", `${FALLBACK_PARAGRAPH}\n\n`);
}

async function translateFullMessage(
  client: import("openai").default,
  message: string,
  targetLang: "en" | "fr"
): Promise<string> {
  const targetLabel = LANG_LABEL[targetLang];
  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 2000,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content:
          `You translate tutoring outreach messages into ${targetLabel}. ` +
          `Preserve meaning, structure, facts, URLs, phone number 078 693 68 98, and tone. ` +
          `Output only the translated message — no preamble.`,
      },
      { role: "user", content: message },
    ],
  });
  return resp.choices[0]?.message?.content?.trim() ?? message;
}

/**
 * Nur der persoenliche Satz fuer die deutsche Erst-Nachricht (lib/tutor24-course-offer.ts).
 * Der Rest der Nachricht ist fester Text; der Aufrufer prueft den Satz und faellt sonst zurueck.
 * null = kein Schluessel oder Fehler.
 */
export async function generatePersonalSentence(
  listing: { title: string; schulstufe: string; description: string },
  anrede: "du" | "eltern" | "neutral" | "en",
  childNom: string | null,
  pushLog: (s: string) => void,
  /** zweiter Versuch: der abgelehnte Satz und der konkrete Grund aus sentenceProblem */
  retry?: { satz: string; grund: string }
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  // Gute Satzanfaenge pro Anrede: der Satz folgt auf "gerne unterstütze ich …" und darf nicht mit Ich/Gerne beginnen.
  const starts =
    anrede === "en"
      ? `"Since you [what the listing says], …", "For [the exam or level named in the listing], …", "Especially with [the topic from the listing], …"`
      : anrede === "du"
        ? `"Da du [was im Inserat steht], …", "Für [die Prüfung oder Stufe aus dem Inserat] …", "Gerade bei [dem Thema aus dem Inserat] …"`
        : anrede === "eltern"
          ? `"Da ${childNom} [was im Inserat steht], …", "Für [die Prüfung oder Stufe aus dem Inserat] …", "Gerade bei [dem Thema aus dem Inserat] …"`
          : `"Für [die Prüfung oder Stufe aus dem Inserat] …", "Gerade bei [dem Thema aus dem Inserat] …", "Mit gezielten Übungen zu [dem Stoff aus dem Inserat] …"`;
  const rule =
    anrede === "en"
      ? `Write in English and address the reader as "you". Do not mention a son or daughter.`
      : anrede === "du"
      ? `Address the student directly with "du" (informal). Never use "Sie".`
      : anrede === "eltern"
        ? `The parent wrote the listing. Use formal "Sie" and refer to the child exactly as "${childNom}". Never use "du".`
        : `It is unclear who wrote it. Use formal "Sie" but do NOT address or mention a child, son or daughter. Never use "du". Prefer impersonal phrasing.`;
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 200,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `You are Omid, a math and physics tutor in Switzerland. Write ONE or two sentences in ${anrede === "en" ? "English" : 'Swiss standard German (use "ss", never "ß")'}, max 40 words, ` +
            `that show you read this tutoring request and how you help with Mathematik and/or Physik specifically. ${rule} ` +
            `If a concrete goal is named in the listing (Matura, BM, Gymiprüfung, Probezeit, a test), name it. ` +
            `NEVER name a goal, exam or school level that is not in the listing (no Matura, BM or Gymiprüfung unless the listing says so). ` +
            `Do NOT mention: ETH, years of experience, number of students, platform, Google Meet, group courses, prices, the city, other subjects. ` +
            (anrede === "en"
              ? `The message before your sentence already says "I would be happy to help with mathematics and physics": do NOT start with "I" and do NOT repeat "happy to help". `
              : `The message before your sentence already says "gerne unterstütze ich ... in Mathematik und Physik": do NOT start with "Ich" or "Gerne" and do NOT repeat "unterstütze ich". `) +
            `Good ways to start (replace the [brackets] with what the listing actually says): ${starts} ` +
            `No em dashes, no marketing fluff. Respond as JSON: {"satz":"..."}`,
        },
        {
          role: "user",
          content: `Titel: ${listing.title}\nSchulstufe: ${listing.schulstufe}\nBeschreibung: ${listing.description.slice(0, 600)}`,
        },
        ...(retry
          ? [
              { role: "assistant" as const, content: JSON.stringify({ satz: retry.satz }) },
              {
                role: "user" as const,
                content: `This sentence was rejected: ${retry.grund}. Write a new one that fixes exactly this, following all rules above. Start like one of these: ${starts}`,
              },
            ]
          : []),
      ],
    });
    const raw = resp.choices[0]?.message?.content ?? "";
    const satz = (JSON.parse(raw) as { satz?: unknown }).satz;
    return typeof satz === "string" ? satz.replace(/ß/g, "ss").trim() : null;
  } catch (err) {
    pushLog(`⚠ OpenAI (persönlicher Satz): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Stilbeispiele fuer v2 (ganze Saetze, je mit dem, was im Beispiel-Inserat stand). Pro Aufruf 3 zufaellige:
 * wechselnde Anfaenge, ohne die starren [Klammer]-Vorlagen (die erzwangen "Bei der Primarschule", "Bis zur 5. Klasse").
 */
function examplePool(f: Form): string[] {
  const k = f.typ === "eltern" ? f : { nom: "Ihr Kind", akk: "Ihr Kind", dat: "Ihrem Kind" };
  const pool =
    f.typ === "en"
      ? [
          `(listing: fractions, 6th grade) "Fractions in 6th grade get much easier once the basics sit, so that is where I start."`,
          `(listing: Probezeit at the Gymnasium) "For the Probezeit at the Gymnasium, I go through the current topics with you and check what the next test will ask."`,
          `(listing: only "math help, secondary school") "At secondary school, I work through the current material step by step."`,
          `(listing: exam in March) "Until the exam in March, I plan the lessons so that every topic is covered once more."`,
        ]
      : f.typ === "fr"
        ? [
            `(annonce : fractions, 6e année) "Pour les fractions en 6e année, je reprends d'abord les bases et nous avançons pas à pas."`,
            `(annonce : examen d'entrée au gymnase) "Pour l'examen d'entrée au gymnase, je travaille les exercices typiques de mathématiques."`,
            `(annonce : seulement "aide en maths, secondaire") "Au secondaire, j'explique la matière actuelle en petites étapes claires."`,
          ]
        : f.typ === "du"
          ? [
              `(Inserat: Bruchrechnen, 6. Klasse) "Beim Bruchrechnen setze ich bei den Grundlagen an und übe mit dir Schritt für Schritt."`,
              `(Inserat: ZAP im März) "Für die ZAP im März gehe ich mit dir die typischen Prüfungsaufgaben durch."`,
              `(Inserat: Probezeit am Gymnasium) "Für einen guten Start in der Probezeit schauen wir gemeinsam auf die nächsten Prüfungen."`,
              `(Inserat: nur "Mathe-Hilfe, Sek") "Den aktuellen Sek-Stoff erkläre ich dir in kleinen, klaren Schritten."`,
              `(Inserat: Lücken seit der Oberstufe) "Deine Lücken aus der Oberstufe schliessen wir der Reihe nach, damit der neue Stoff wieder Sinn ergibt."`,
            ]
          : f.typ === "eltern"
            ? [
                `(Inserat: Bruchrechnen, 6. Klasse) "Beim Bruchrechnen setze ich bei den Grundlagen an und übe mit ${k.dat} Schritt für Schritt."`,
                `(Inserat: Gymiprüfung im März) "Bis zur Gymiprüfung im März gehe ich mit ${k.dat} die typischen Aufgaben durch."`,
                `(Inserat: wenig Selbstvertrauen in Mathe) "Damit ${k.nom} wieder Vertrauen in Mathematik fasst, beginne ich mit Aufgaben, die gelingen."`,
                `(Inserat: nur "Mathe-Hilfe, Primarschule") "Den Stoff der Primarschule erkläre ich ruhig und mit vielen Beispielen."`,
                `(Inserat: 2. Sek, Prüfungen) "Auf die nächsten Prüfungen der 2. Sek bereite ich ${k.akk} gezielt vor."`,
              ]
            : [
                `(Inserat: Bruchrechnen, 6. Klasse) "Beim Bruchrechnen in der 6. Klasse setze ich bei den Grundlagen an und übe Schritt für Schritt."`,
                `(Inserat: Kanti-Aufnahmeprüfung) "Für die Kanti-Aufnahmeprüfung gehe ich die typischen Prüfungsaufgaben in Mathematik durch."`,
                `(Inserat: Physik in der Berufslehre) "Physik in der Berufslehre erkläre ich an Beispielen aus dem Berufsalltag."`,
                `(Inserat: nur "Mathe-Hilfe, Sek") "Den aktuellen Sek-Stoff erkläre ich in kleinen, klaren Schritten."`,
              ];
  return pool;
}
const examplesV2 = (f: Form) => [...examplePool(f)].sort(() => Math.random() - 0.5).slice(0, 3);
/** Saetze aller Stilbeispiele: eine woertliche Kopie wird abgelehnt (9.11.: 3x "In der Primarschule erkläre ich den Stoff ruhig …"). */
const EXAMPLE_SENTENCES = new Set(
  ([{ typ: "du" }, { typ: "neutral" }, { typ: "en" }, { typ: "fr" }, ...(["Tochter", "Sohn", "Kind"] as const).map((k) => ({ typ: "eltern" as const, ...CHILD_FORMS[k] }))] as Form[])
    .flatMap(examplePool)
    .map((e) => e.match(/"([^"]+)"$/)?.[1] ?? e)
);

/**
 * v2 des persoenlichen Satzes: EIN konkretes Detail aus dem Inserat, aktiv und in der ersten Person,
 * wechselnde Anfaenge; ohne Detail ein kurzer Satz zur Stufe. Gleiche Pruefung wie v1 plus stilProblemV2.
 * Eltern: alle drei Faelle im Prompt ("Ihr Kind" / "Ihrem Kind"), sonst schrieb die KI "mit Ihr Kind" (26 von 274 am 7.11.).
 */
async function generateSentenceV2(
  apiKey: string,
  listing: { title: string; schulstufe: string; description: string },
  f: Form,
  pushLog: (s: string) => void,
  retry?: { satz: string; grund: string }
): Promise<string | null> {
  const lang = f.typ === "en" ? "English" : f.typ === "fr" ? "French" : 'Swiss standard German (use "ss", never "ß")';
  const rule =
    f.typ === "en"
      ? `Write in English and address the reader as "you". Do not mention a son or daughter. Use correct prepositions ("at primary school", "at secondary school", "at the Gymnasium").`
      : f.typ === "fr"
        ? `Write in French, formal "vous". Do not mention a son or daughter. Never use "tu".`
        : f.typ === "du"
          ? `Address the student directly with "du" (informal). Never use "Sie".`
          : f.typ === "eltern"
            ? `The parent wrote the listing. Use formal "Sie"/"Ihr". Refer to the child only with these exact forms and correct German case: ` +
              `subject (Nominativ) "${f.nom}", object (Akkusativ, also after "für") "${f.akk}", after "mit", "bei", "von", "zu" (Dativ) "${f.dat}". ` +
              `Example: "übe ich mit ${f.dat}", "bereite ich ${f.akk} vor". Never use "du".`
            : `It is unclear who wrote it. Use formal "Sie" but do NOT mention a child, son or daughter. Never use "du".`;
  const examples = examplesV2(f).join(" ");
  const banned =
    f.typ === "en" ? `"Since you"` : f.typ === "fr" ? `"Comme vous", "Puisque"` : f.typ === "du" ? `"Da du"` : `"Da ${f.typ === "eltern" ? f.nom : "Ihr Kind"}", "Da Ihr Kind"`;
  const before =
    f.typ === "en"
      ? `The message before your sentence already says "I would be happy to help with mathematics and physics": do NOT start with "I" and do NOT repeat "happy to help". `
      : f.typ === "fr"
        ? `The message before your sentence already says "Je serais ravi de vous aider en mathématiques et en physique": do NOT start with "Je serais" and do NOT repeat "ravi de vous aider". `
        : `The message before your sentence already says "gerne unterstütze ich ... in Mathematik und Physik": do NOT start with "Ich" or "Gerne" and do NOT repeat "unterstütze". `;
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 160,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `You are Omid, a math and physics tutor in Switzerland. Write exactly ONE sentence in ${lang}, max 30 words, ending with a period, that proves you read THIS listing. ` +
            `Step 1: find ONE concrete detail that is literally in the listing: class or year, a topic (e.g. fractions, functions, vectors), an exam (Gymiprüfung, ZAP, Matura, BM, Probezeit, a test), a date or deadline, a stated difficulty, or a goal. ` +
            `Prefer the MOST specific detail: a named topic, a difficulty (e.g. Dyskalkulie, gaps, exam anxiety), an exam or a date beats a class/year, which beats the bare school level. ` +
            `Step 2: build the sentence around that detail, in ACTIVE voice, first person and PRESENT tense (e.g. "erkläre ich", "übe ich mit …", "gehe ich … durch"; not "werde ich"): say what you concretely do with it. Professional and calm. ` +
            `Avoid empty phrases: "begeistern", "Spass machen", "optimal", "gezielte Unterstützung", "Fortschritte erzielen", "make learning fun". ` +
            `If the listing has no concrete detail beyond "needs help in math/physics": write a SHORT sentence (max 15 words) about how you work at that school level. ` +
            `${rule} ` +
            `Never use passive voice (no "wird angeboten", "kann unterstützt werden", "is offered"). Do not merely restate that they need tutoring. Only Mathematik/Physik. ` +
            `NEVER name a goal, exam, topic, class or date that is not in the listing. ` +
            `Do NOT mention: ETH, years of experience, number of students, platform, Google Meet, group courses, prices, the city, other subjects. ` +
            before +
            `Do NOT start with ${banned}${f.typ === "en" || f.typ === "fr" ? "" : `, and do NOT start with the bare school level ("In der Primarschule", "In der Sekundarstufe", "In der Berufslehre", "In Mathematik")`}. ` +
            `Open with the detail itself, e.g. the topic or exam as the first words ("Bruchrechnen übe ich …", "Für die ZAP …", "Bis zur Matura …", "Den Stoff der 2. Sek …", "Damit …"). ` +
            `Use correct prepositions ("in der Primarschule", "am Gymnasium", "in der Berufslehre"). ` +
            `Talk to this one person about what you do; never mention "die Schüler", "die Lernenden" or "students". ` +
            (f.typ === "en" ? `Translate Swiss school terms into English (Primarschule = primary school, Sekundarstufe/Sek/Bezirksschule = secondary school); keep Gymnasium, Gymi, Matura, BM, Probezeit. ` : "") +
            (f.typ === "fr" ? `Translate Swiss school terms into French (Primarschule = école primaire, Sekundarstufe = secondaire, Gymnasium = gymnase). ` : "") +
            `Do NOT copy a style example; write a new sentence for THIS listing. ` +
            `Style examples — each for a DIFFERENT listing; never copy their topics, exams or dates unless THIS listing has them: ${examples} ` +
            `No em dashes, no brackets, no marketing fluff. Respond as JSON: {"detail":"<the detail you used, or none>","satz":"..."}`,
        },
        { role: "user", content: `Titel: ${listing.title}\nSchulstufe: ${listing.schulstufe}\nBeschreibung: ${listing.description.slice(0, 700)}` },
        ...(retry
          ? [
              { role: "assistant" as const, content: JSON.stringify({ satz: retry.satz }) },
              { role: "user" as const, content: `This sentence was rejected: ${retry.grund}. Write a new one that fixes exactly this, following all rules above.` },
            ]
          : []),
      ],
    });
    const satz = (JSON.parse(resp.choices[0]?.message?.content ?? "") as { satz?: unknown }).satz;
    return typeof satz === "string" ? satz.replace(/ß/g, "ss").replace(/\s+/g, " ").trim() : null;
  } catch (err) {
    pushLog(`⚠ OpenAI (persönlicher Satz v2): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Zusaetzliche Pruefung fuer v2: kein Passiv, nicht der verbotene Anfang. null = in Ordnung. */
export function stilProblemV2(satz: string): string | null {
  if (/\b(wird|werden|kann|können)\b[^.]{0,60}\b(angeboten|unterstützt|gefördert|vermittelt|geboten|erklärt|geübt|aufgearbeitet|behandelt)\b/i.test(satz) || /\b(is|are|can be) (offered|provided|supported)\b/i.test(satz))
    return "Passiv — bitte aktiv in der ersten Person";
  // nur die blosse Stufe ("In der Primarschule …" stand am 7.11. vor 53 % der Saetze); "In der 5. Klasse …" bleibt erlaubt
  if (/^(In der (Primarschule|Sekundarstufe|Sekundarschule|Oberstufe|Berufslehre|Erwachsenenbildung|Mathematik)|In Mathematik)\b/.test(satz.trim()))
    return "beginnt mit „In der Primarschule/Sekundarstufe …“ — bitte mit dem konkreten Detail beginnen";
  // auch die zweite Satzhaelfte zaehlt ("Au gymnase, j'explique la matière actuelle en petites étapes claires.")
  if (Array.from(EXAMPLE_SENTENCES).some((e) => satz.trim().endsWith(e.slice(-40)))) return "kopiert ein Stilbeispiel — bitte einen eigenen Satz zu diesem Inserat";
  if (/^(Da (Ihr Kind|du|Ihr Sohn|Ihre Tochter)|Since you|Comme vous|Puisque)\b/i.test(satz.trim())) return "beginnt mit „Da …“ — bitte anders beginnen";
  return null;
}

/** Original Tutor24 personalisation — Schüler-Gesuche, Mathe/Physik. */
export async function generateTutor24Message(
  profile: ListingProfile,
  pushLog: (s: string) => void
): Promise<string> {
  const targetLang = profile.language;
  let message = buildFallbackMessage();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    if (targetLang !== "de") {
      pushLog("⚠ Kein OPENAI_API_KEY — Fallback bleibt Deutsch");
    }
    return message;
  }

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });
    const context = profileContextForAi(profile);
    const targetLabel = LANG_LABEL[targetLang];
    const languageRule =
      targetLang === "de"
        ? `Write the entire "message" in German (Swiss standard).`
        : `The listing is in ${targetLabel}. Write the entire "message" in ${targetLabel} only — do not leave any German sentences. ` +
          `The template below is German reference content: translate every part into ${targetLabel}, including greeting and sign-off.`;

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 2000,
      temperature: 0.5,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `You are Omid, a math and physics tutor in Switzerland (Mathematik and Physik only in the personalised middle section).\n` +
            `You write complete tutor24.ch outreach messages.\n` +
            `MESSAGE STRUCTURE (strict order):\n` +
            `1. "Hallo zusammen,"\n` +
            `2. Credentials block (fixed text — keep meaning; translate for en/fr)\n` +
            `3. {{LEVEL_INSERT}} — your 1–2 sentence personalisation ONLY here\n` +
            `4. Rest of template from "Für meinen Unterricht..." through sign-off\n` +
            `Do NOT merge step 2 and 3. Do NOT rewrite the credentials block to include listing details.\n` +
            `Style: direct, professional, human. No marketing fluff, no em dashes.\n` +
            `TARGET LANGUAGE: ${targetLabel} (${targetLang}). ${languageRule}\n` +
            `Respond with JSON only: {"message":"<full outreach text>"}`,
        },
        {
          role: "user",
          content:
            `Listing title: "${profile.pageTitle}"\n` +
            `Description: ${context.slice(0, 400)}\n\n` +
            `Step 1 — write ONLY the text for {{LEVEL_INSERT}} (1–2 sentences, max 40 words). This goes AFTER the credentials block and BEFORE "Für meinen Unterricht...":\n` +
            `IF the listing mentions a concrete exam/school goal (Gymi, Matura, BM, Passerelle, university entrance, Primarschule, etc.):\n` +
            `→ Name that goal and one sentence on why Omid is a strong fit for Mathematik and/or Physik.\n` +
            `ELSE:\n` +
            `→ One sentence showing you read their need and how Omid can help with Mathematik and/or Physik specifically.\n` +
            `SUBJECTS: Omid teaches Mathematik and Physik only. If the listing also asks for Französisch, Deutsch, Englisch, or other subjects — ignore those here; address only Mathematik and/or Physik. Never offer French or other language tutoring in this section.\n` +
            `Do NOT repeat or paraphrase the credentials block (ETH, 12 years, 30 students, online/Zürich, Deutsch/Englisch) — that block stays fixed above {{LEVEL_INSERT}}.\n` +
            `Do NOT mention: own materials, Mathetogo platform, Google Meet in this section.\n` +
            `Do NOT: recap their whole situation, start with "I", or mention their city.\n\n` +
            `Step 2 — assemble the FULL message: greeting + credentials block (unchanged) + your Step 1 text + remainder of template. Output in ${targetLabel}:\n` +
            TUTOR24_MESSAGE_TEMPLATE,
        },
      ],
    });

    const raw = resp.choices[0]?.message?.content?.trim() ?? "";
    const parsed = parseMessageJson(raw);
    if (parsed) message = parsed;
    else if (raw && !raw.startsWith("{")) message = raw;
    else pushLog("⚠ JSON-Antwort ungültig — Fallback");

    if (targetLang !== "de" && stillLooksGerman(message)) {
      pushLog(`⚠ Nachricht noch auf Deutsch — Übersetzung nach ${targetLabel}`);
      message = await translateFullMessage(client, message, targetLang);
    }

    pushLog(`Zielsprache: ${targetLabel} | "${message.slice(0, 80)}..." | ${message.length} Zeichen`);
    return message;
  } catch (err) {
    pushLog(`⚠ OpenAI: ${err instanceof Error ? err.message : String(err)} — Fallback`);
    if (targetLang !== "de") {
      try {
        const { default: OpenAI } = await import("openai");
        const client = new OpenAI({ apiKey });
        return await translateFullMessage(client, message, targetLang);
      } catch {
        /* keep German fallback */
      }
    }
    return message;
  }
}

/**
 * Persoenlicher Satz mit Pruefung: abgelehnt → ein zweiter Versuch mit dem konkreten Grund im Prompt.
 * Erst wenn auch der scheitert, nimmt der Aufrufer den Ersatzsatz (satz = null).
 */
export async function personalSentenceChecked(
  listing: { title: string; schulstufe: string; description: string },
  form: Form,
  pushLog: (s: string) => void,
  /** v2 (Standard seit 9.11.): ein konkretes Detail, aktiv, erste Person, wechselnde Anfaenge; v1 = alter Satz (nur Vergleich) */
  stil: "v1" | "v2" = "v2"
): Promise<{ satz: string | null; versuche: number; gruende: string[] }> {
  const anrede = form.typ === "fr" ? "neutral" : form.typ;
  const child = form.typ === "eltern" ? form.nom : null;
  const apiKey = process.env.OPENAI_API_KEY;
  const gruende: string[] = [];
  let last: { satz: string; grund: string } | undefined;
  for (let versuch = 1; versuch <= 2; versuch++) {
    const satz =
      stil === "v2"
        ? apiKey ? await generateSentenceV2(apiKey, listing, form, pushLog, last) : null
        : await generatePersonalSentence(listing, anrede, child, pushLog, last);
    if (!satz) return { satz: null, versuche: versuch, gruende: [...gruende, "KI lieferte nichts"] };
    const grund = sentenceProblem(satz, form, listingText(listing)) ?? (stil === "v2" ? stilProblemV2(satz) : null);
    if (!grund) return { satz, versuche: versuch, gruende };
    gruende.push(grund);
    last = { satz, grund };
  }
  return { satz: null, versuche: 2, gruende };
}

// ── Persoenlicher Satz v3 (9.11., Schalter satzV3, erst nach Omids OK) ────────

/**
 * v3: Die KI schreibt nur, wenn das Inserat ein konkretes Detail hat (Klasse, Thema, Pruefung, Termin, Schwierigkeit):
 * hoechstens 20 Woerter, wie ein Lehrer im Chat. Sonst, oder wenn der Satz abgelehnt wird: Omids fester Satz der Stufe.
 * Ohne bekannte Stufe: kein Satz ("").
 */
export async function personalSentenceV3(
  listing: { title: string; schulstufe: string; description: string },
  form: Form,
  fest: string,
  pushLog: (s: string) => void
): Promise<{ satz: string; quelle: "ki" | "fest" | "ohne"; detail: string | null; gruende: string[] }> {
  const mitFest = (gruende: string[], detail: string | null = null) => ({ satz: fest, quelle: fest ? ("fest" as const) : ("ohne" as const), detail, gruende });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return mitFest(["kein OPENAI_API_KEY"]);
  const inserat = listingText(listing);
  const gruende: string[] = [];
  let last: { satz: string; grund: string } | undefined;
  let detail: string | null = null;
  for (let versuch = 1; versuch <= 2; versuch++) {
    const r = await generateSentenceV3(apiKey, listing, form, pushLog, last);
    if (!r) return mitFest([...gruende, "KI lieferte nichts"]);
    detail = r.detail && !/^(none|keins?|kein detail|-)$/i.test(r.detail.trim()) ? r.detail.trim() : null;
    if (!detail || nurStufe(detail)) return mitFest([...gruende, detail ? `nur Stufe/Fach („${detail}“), kein Detail` : "kein konkretes Detail im Inserat"], detail);
    if (!detailImInserat(detail, inserat)) return mitFest([...gruende, `Detail „${detail}“ steht nicht im Inserat`], detail);
    const satz = r.satz.replace(/ß/g, "ss").replace(/\s+/g, " ").trim();
    const grund =
      (satz.split(" ").length > 20 ? "mehr als 20 Wörter" : null) ??
      (satz.match(VERBOTEN_IM_SATZ) ? `verbotenes Wort „${satz.match(VERBOTEN_IM_SATZ)![0]}“` : null) ??
      // Zweck-Anhang klingt nach KI: "…, um den Stoff besser zu bewältigen." / "to help you …"
      (/,? um [^,.]{3,80} zu [a-zäöü]+\.$|,? (to help|in order to|so as to) [^.]+\.$|,? afin de [^.]+\.$/i.test(satz) ? "Anhang „um … zu …“ (klingt nach KI)" : null) ??
      sentenceProblem(satz, form, inserat) ??
      stilProblemV2(satz);
    if (!grund) return { satz, quelle: "ki", detail, gruende };
    gruende.push(grund);
    last = { satz, grund };
  }
  return mitFest(gruende, detail);
}

async function generateSentenceV3(
  apiKey: string,
  listing: { title: string; schulstufe: string; description: string },
  f: Form,
  pushLog: (s: string) => void,
  retry?: { satz: string; grund: string }
): Promise<{ detail: string; satz: string } | null> {
  const lang = f.typ === "en" ? "English" : f.typ === "fr" ? "French (formal vous)" : 'Swiss standard German (use "ss", never "ß")';
  const anrede =
    f.typ === "du"
      ? `Address the student with "du". Never "Sie".`
      : f.typ === "eltern"
        ? `A parent wrote it. Formal "Sie". The child: "${f.nom}" (subject), "${f.akk}" (object, after "für"), "${f.dat}" (after "mit", "bei"). Never "du".`
        : f.typ === "neutral"
          ? `Formal "Sie", but do not mention a child. Never "du".`
          : `Address the reader as "you"/"vous".`;
  const examples = [
    "Für die Gymiprüfung arbeite ich mit alten Prüfungen, damit die typischen Aufgaben vertraut werden.",
    "Für die Matura üben wir mit alten Maturaaufgaben, damit die Prüfung keine Überraschungen bringt.",
    "In der Sek kommt der Stoff schnell hintereinander, da hilft es, Lücken früh zu schliessen.",
    "Für die Prüfung im Dezember gehen wir die Bruchrechnung nochmals von Grund auf durch.",
  ];
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 120,
      temperature: 0.5,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `You are Omid, a math and physics tutor in Switzerland, writing ONE sentence in a tutor24 chat message, in ${lang}. ` +
            `Step 1: find ONE concrete detail that is literally in the listing: a class or year (e.g. "5. Klasse", "2. Sek"), a math/physics topic (e.g. Bruchrechnen, Vektoren), an exam or test (Gymiprüfung, ZAP, Matura, BM-Prüfung, Probezeit), a date or deadline, or a stated difficulty (e.g. Dyskalkulie, Prüfungsangst, Lücken). ` +
            `A school level alone ("Primarschule", "Sekundarstufe", "Gymnasium") or "needs help in math" is NOT a detail. If there is no detail, answer {"detail":"none","satz":""}. ` +
            `Step 2: max 20 words. Pick up the detail and say what you concretely do with it, like a teacher writing in a chat, not like advertising. First person, present tense, active. ` +
            `${anrede} Only mathematics/physics. Never invent anything that is not in the listing. ` +
            `Do not copy words from the listing that are misspelled, abbreviated or unusual (e.g. "niveau" in lower case, "gymni", "Kusnacht"): use the correct, common term instead ("Niveau", "Gymnasium", "Küsnacht"). ` +
            (f.typ === "en"
              ? `In English, use English or generally understood terms (e.g. "probation period at the Gymnasium", "entrance exam", "secondary school"), never German school slang. `
              : f.typ === "fr"
                ? `In French, use French terms (e.g. "période d'essai au gymnase", "examen d'entrée", "secondaire"). `
                : "") +
            `Never use these words: verständlich, klar, Konzepte, gezielt, unterstützen, fördern, regelmässig, optimal, individuell, nachhaltig, Verständnis, vertiefen, stärken, Herausforderungen ` +
            `(nor their English/French equivalents: clear, concepts, targeted, support, foster, regular, individual, sustainable, understanding, deepen, strengthen, challenges). ` +
            `Do not start with "Ich", "Gerne", "Da", "I", "Since", "Je serais". The message before already says "gerne unterstütze ich ... in Mathematik und Physik"; do not repeat it. ` +
            `Style of Omid's own sentences (for other listings, never copy them): ${examples.join(" ")} ` +
            `Respond as JSON: {"detail":"<the detail, quoted from the listing, or none>","satz":"..."}`,
        },
        { role: "user", content: `Titel: ${listing.title}\nSchulstufe: ${listing.schulstufe}\nBeschreibung: ${listing.description.slice(0, 700)}` },
        ...(retry
          ? [
              { role: "assistant" as const, content: JSON.stringify({ satz: retry.satz }) },
              { role: "user" as const, content: `Rejected: ${retry.grund}. Write a new sentence that fixes exactly this, following all rules.` },
            ]
          : []),
      ],
    });
    const j = JSON.parse(resp.choices[0]?.message?.content ?? "") as { detail?: unknown; satz?: unknown };
    return { detail: typeof j.detail === "string" ? j.detail : "none", satz: typeof j.satz === "string" ? j.satz : "" };
  } catch (err) {
    pushLog(`⚠ OpenAI (persönlicher Satz v3): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
