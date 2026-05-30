/**
 * Tutor24 outreach — original KI-Prompt (Nachhilfe an Schüler-Gesuche).
 * Unabhängig von Academigo; nicht ändern ohne Absicht.
 */

import type { ListingProfile } from "./tutor24-messaging";

export const TUTOR24_MESSAGE_TEMPLATE = `Hallo zusammen,

gerne unterstütze ich dich in Mathematik und der Physik, entweder online oder in Zürich, auf Deutsch oder Englisch. Ich unterrichte seit über 12 Jahren, habe an der ETH studiert und begleite aktuell mehr als 30 aktive Schüler, die meisten auf Gymi- oder Universitätsniveau. Entsprechend gut kenne ich die Anforderungen, typischen Fehler und relevanten Themen über alle Stufen hinweg.

{{LEVEL_INSERT}}Für meinen Unterricht habe ich eigene Lehrmittel für die Gymivorbereitung, BM-Vorbereitung sowie verschiedene Gymi- und BM-Stufen entwickelt. Zusätzlich habe ich die Lernplattform Mathetogo programmiert (www.platform.mathetogo.xyz). Dort arbeitest du mit klar strukturierten Inhalten, löst gezielte Aufgaben, hältst deinen Lösungsweg fest und erhältst persönliches Feedback. Ergänzende Quizzes helfen dir, deinen Lernstand realistisch einzuschätzen und gezielt Fortschritte zu machen.

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
            `You are Omid, a math and physics tutor in Switzerland (math and physics only).\n` +
            `You write complete tutor24.ch outreach messages.\n` +
            `Style: direct, professional, human. No marketing fluff, no em dashes.\n` +
            `TARGET LANGUAGE: ${targetLabel} (${targetLang}). ${languageRule}\n` +
            `Respond with JSON only: {"message":"<full outreach text>"}`,
        },
        {
          role: "user",
          content:
            `Listing title: "${profile.pageTitle}"\n` +
            `Description: ${context.slice(0, 400)}\n\n` +
            `Step 1 — personalised opening (1–2 sentences, max 40 words) for {{LEVEL_INSERT}}:\n` +
            `IF the listing mentions a concrete exam/school goal (Gymi, Matura, BM, Passerelle, university entrance, etc.):\n` +
            `→ Name that goal and one sentence on why Omid is a strong fit.\n` +
            `ELSE:\n` +
            `→ One sentence showing you read their need and how Omid can help specifically.\n` +
            `Do NOT mention: ETH, 12 years experience, 30+ students, own materials, Mathetogo platform, Google Meet, languages offered.\n` +
            `Do NOT: recap their situation, start with "I", mention location, other subjects.\n\n` +
            `Step 2 — insert opening into template, output full message in ${targetLabel}:\n` +
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
