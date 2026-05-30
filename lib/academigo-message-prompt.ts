/**
 * Academigo — eigene KI-Prompts (Lehrer vs. Schüler), unabhängig von Tutor24.
 */

import type { AcademigoMode } from "./academigo-types";
import type { ListingProfile } from "./tutor24-messaging";

export const DEFAULT_ACADEMIGO_TEACHER_TEMPLATE = `Hallo [Name],

[PERSONALIZED_SECTION]

Ich bin Gründer von Academigo, einer neuen Academy und Lernplattform für Schülerinnen und Schüler in der Schweiz.

Unser Ziel ist es, persönliche Förderung mit moderner Technologie zu verbinden. Neben individuellem Unterricht entwickeln wir eine Plattform, die Schüler beim Lernen unterstützt und Lehrpersonen administrative Arbeit abnimmt.

Aktuell bauen wir unser Lehrpersonen-Netzwerk auf und suchen engagierte Personen, die von Anfang an Teil des Projekts werden möchten. Wir legen grossen Wert auf fachliche Kompetenz, verständliche Erklärungen und eine langfristige Zusammenarbeit.

Falls das grundsätzlich interessant für dich klingt, würde ich mich über einen kurzen Austausch freuen.

Liebe Grüsse

Omid
Gründer von Academigo`;

/** @deprecated Alias — Lehrer-Vorlage */
export const DEFAULT_ACADEMIGO_MESSAGE_TEMPLATE = DEFAULT_ACADEMIGO_TEACHER_TEMPLATE;

export const DEFAULT_ACADEMIGO_STUDENT_TEMPLATE = `Hallo [Name],

[PERSONALIZED_SECTION]

Ich bin Omid, Gründer von Academigo. Wir bauen in der Schweiz eine Academy und Lernplattform, die persönliche Nachhilfe mit klarer Struktur und moderner Lernbegleitung verbindet.

Wenn du für dein Gesuch passende Unterstützung suchst, prüfen wir gerne gemeinsam, ob unsere Lehrpersonen oder unser Ansatz zu deinen Zielen passen — unverbindlich und ohne Druck.

Melde dich gerne für ein kurzes Gespräch.

Liebe Grüsse

Omid
Gründer von Academigo`;

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

function languageInstruction(targetLang: ListingProfile["language"]): string {
  const label = LANG_LABEL[targetLang];
  if (targetLang === "de") {
    return `Write personalized_section in German (Swiss standard).`;
  }
  return `The listing is in ${label}. Write personalized_section in ${label} only.`;
}

function parsePersonalizedJson(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { personalized_section?: unknown };
    return typeof parsed.personalized_section === "string" ? parsed.personalized_section.trim() : null;
  } catch {
    const block = raw.match(/\{[\s\S]*\}/);
    if (!block) return null;
    try {
      const parsed = JSON.parse(block[0]) as { personalized_section?: unknown };
      return typeof parsed.personalized_section === "string" ? parsed.personalized_section.trim() : null;
    } catch {
      return null;
    }
  }
}

function buildTeacherPrompt(profile: ListingProfile, targetLang: ListingProfile["language"]) {
  const context = profileContextForAi(profile).slice(0, 400);
  const system =
    `You are Omid, founder of Academigo (academy and learning platform in Switzerland).\n` +
    `You write ONLY the first paragraph after the greeting in a tutor24.ch message to a private tutor.\n` +
    `${languageInstruction(targetLang)}\n` +
    `Style: professional, warm, specific, human. Not generic, not marketing-heavy, no em dashes.\n` +
    `Respond with JSON only: {"personalized_section":"..."}`;

  const user =
    `Profile title: "${profile.pageTitle}"\n` +
    `Profile text: ${context}\n\n` +
    `The message looks like this:\n` +
    `  Hallo [FirstName],\n\n` +
    `  [YOUR TEXT]\n\n` +
    `  Ich bin Gründer von Academigo...\n\n` +
    `Write exactly 1–2 sentences for [YOUR TEXT] (max 45 words).\n` +
    `It must read as a natural continuation after "Hallo [Name]," — not as a separate meta comment about reading the profile.\n` +
    `Refer to something concrete from the profile (subjects, levels, experience) and why this tutor fits Academigo's teacher network.\n\n` +
    `GOOD starts: "Dein Schwerpunkt …", "Du bietest …", "Mit deiner Erfahrung in …", "Dein Profil zu … passt …"\n` +
    `BAD starts (never use): "Besonders ist mir aufgefallen", "Mir ist aufgefallen", "Interessant finde ich", "Aufgefallen ist mir"\n\n` +
    `Do NOT repeat the Academigo pitch, Mathetogo, ETH, years of experience, or invented facts.\n` +
    `Do NOT start with "Ich". Do not mention location unless central to the profile.`;

  return { system, user };
}

function buildStudentPrompt(profile: ListingProfile, targetLang: ListingProfile["language"]) {
  const context = profileContextForAi(profile).slice(0, 400);
  const system =
    `You are Omid, founder of Academigo (academy and learning platform in Switzerland).\n` +
    `You write ONLY the first paragraph after the greeting in a tutor24.ch message to a student or parent who posted a tutoring request (Gesuch).\n` +
    `${languageInstruction(targetLang)}\n` +
    `Style: professional, warm, specific, supportive. Not salesy, no em dashes.\n` +
    `Respond with JSON only: {"personalized_section":"..."}`;

  const user =
    `Request title: "${profile.pageTitle}"\n` +
    `Request description: ${context}\n\n` +
    `The message looks like this:\n` +
    `  Hallo [FirstName],\n\n` +
    `  [YOUR TEXT]\n\n` +
    `  Ich bin Omid, Gründer von Academigo...\n\n` +
    `Write exactly 1–2 sentences for [YOUR TEXT] (max 45 words).\n` +
    `It must read naturally after "Hallo [Name]," — show you read their request and why a short chat from Academigo could help.\n` +
    `Refer to subject, school level, exam prep, or a concrete goal from the listing.\n\n` +
    `GOOD starts: "Dein Gesuch zu …", "Du suchst …", "Für die Vorbereitung auf …", "Bei deinem Ziel …"\n` +
    `BAD starts (never use): "Mir ist aufgefallen", "Besonders ist mir aufgefallen", "Interessant finde ich"\n\n` +
    `Do NOT recruit them as a teacher. Do NOT repeat the full Academigo pitch. Do NOT invent subjects or goals not in the listing.\n` +
    `Do NOT start with "Ich".`;

  return { system, user };
}

function fallbackPersonalizedSection(mode: AcademigoMode, profile: ListingProfile): string {
  const snippet = profile.bodyText.trim().slice(0, 120);
  if (mode === "teachers") {
    if (snippet) {
      return `Dein Profil — insbesondere ${snippet.replace(/\s+/g, " ").slice(0, 100)} — passt gut zu dem Lehrpersonen-Netzwerk, das wir bei Academigo aufbauen.`;
    }
    return "Dein Profil und deine Schwerpunkte passen gut zu dem, was wir bei Academigo suchen — darüber würde ich gerne kurz mit dir sprechen.";
  }
  const title = profile.pageTitle.trim();
  if (title.length > 10) {
    return `Dein Gesuch «${title.slice(0, 80)}» klingt nach etwas, bei dem wir dich bei Academigo gerne unverbindlich unterstützen können.`;
  }
  return "Dein Nachhilfe-Gesuch klingt nach etwas, bei dem wir dich bei Academigo gerne unverbindlich unterstützen können.";
}

const AWKWARD_OPENING_RES =
  /^(?:besonders\s+(?:ist\s+mir\s+)?(?:aufgefallen|interessant)|mir\s+ist\s+(?:mir\s+)?(?:aufgefallen|gefallen)|interessant\s+finde\s+ich|aufgefallen\s+ist\s+mir),?\s*(?:dass\s+)?/i;

/** Rewrites common AI openers so the text flows after "Hallo [Name],". */
function polishPersonalizedSection(text: string): string {
  let out = text.trim();
  if (!out || !AWKWARD_OPENING_RES.test(out)) return out;

  out = out.replace(AWKWARD_OPENING_RES, "");
  if (/^du\b/i.test(out)) {
    out = "Du" + out.slice(2);
  } else if (/^dein\b/i.test(out)) {
    out = "Dein" + out.slice(4);
  } else if (/^deine\b/i.test(out)) {
    out = "Deine" + out.slice(5);
  } else if (out.length > 0) {
    out = out.charAt(0).toUpperCase() + out.slice(1);
  }
  return out;
}

async function fetchPersonalizedSection(
  mode: AcademigoMode,
  profile: ListingProfile,
  pushLog: (s: string) => void
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    pushLog("⚠ Kein OPENAI_API_KEY — Academigo-Fallback für Personalisierung");
    return fallbackPersonalizedSection(mode, profile);
  }

  const targetLang = profile.language;
  const { system, user } =
    mode === "teachers" ? buildTeacherPrompt(profile, targetLang) : buildStudentPrompt(profile, targetLang);

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 300,
      temperature: 0.55,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const raw = resp.choices[0]?.message?.content?.trim() ?? "";
    const parsed = parsePersonalizedJson(raw);
    if (parsed) {
      const polished = polishPersonalizedSection(parsed);
      pushLog(
        `Academigo ${mode === "teachers" ? "Lehrer" : "Schüler"}-Prompt | "${polished.slice(0, 80)}…" | ${polished.length} Zeichen`
      );
      return polished;
    }
    pushLog("⚠ JSON-Antwort ungültig — Fallback");
    return fallbackPersonalizedSection(mode, profile);
  } catch (err) {
    pushLog(`⚠ OpenAI: ${err instanceof Error ? err.message : String(err)} — Fallback`);
    return fallbackPersonalizedSection(mode, profile);
  }
}

function greetingName(profile: ListingProfile): string {
  const raw = profile.name.trim();
  const first = raw.split(/\s+/)[0];
  if (first && first.length > 1 && !/^\d+$/.test(first)) return first;
  return "du";
}

function applyAcademigoPlaceholders(template: string, profile: ListingProfile, personalized: string): string {
  const name = greetingName(profile);
  let out = template;
  out = out.replace(/\[Name\]/gi, name);
  out = out.replace(/\[PERSONALIZED_SECTION\]/gi, personalized);
  out = out.replace(/\{\{LEVEL_INSERT\}\}/g, `${personalized}\n\n`);
  return out;
}

export async function generateAcademigoMessage(
  profile: ListingProfile,
  messageTemplate: string,
  mode: AcademigoMode,
  pushLog: (s: string) => void
): Promise<string> {
  const section = await fetchPersonalizedSection(mode, profile, pushLog);
  return applyAcademigoPlaceholders(messageTemplate, profile, section);
}
