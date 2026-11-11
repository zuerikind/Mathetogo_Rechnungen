/**
 * Pruef-Agent (Omid, 11.11.): liest jede Nachricht vor dem Senden — eigener KI-Aufruf, kennt nur das Inserat und die
 * fertige Nachricht, nicht den Prompt, mit dem sie geschrieben wurde. "ok" → Automatik sendet; "auffaellig" → Rueckfrage.
 * Stopp im Durchgang: mehr als 4 auffaellig oder (ab 5 geprueften) mehr als 30 % → nichts mehr senden, Automatik aus.
 * Agent nicht erreichbar: nicht senden (Rueckfrage), zaehlt nicht zum Stopp; 2× hintereinander → Durchgang sendet nichts mehr.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { zurichDay } from "./tutor24-rueckfragen";

export const AGENT_LOG = "tutor24-followup/pruefagent.json";
export const AGENT_MAX_AUFFAELLIG = 4;
export const AGENT_MAX_ANTEIL = 0.3;
export const AGENT_ANTEIL_AB = 5;
/** erste Woche: Abend-Zusammenfassung zeigt zusaetzlich alle ok und die Liste der Gruende */
export const AGENT_DETAIL_BIS = "2026-11-19";

export type AgentInput = {
  art: "erst" | "nachfassen";
  titel: string;
  fach?: string;
  stufe?: string;
  beschreibung: string;
  text: string;
};
export type AgentUrteil = { urteil: "ok" | "auffaellig" | "fehler"; grund: string };

export const AGENT_ANWEISUNG = `Du prüfst als zweite Person eine Nachricht, die ein Nachhilfelehrer (Mathe und Physik, ETH-Studium, über 12 Jahre Erfahrung, Zürich und online, eigene Kursplattform Academigo) auf ein Nachhilfe-Inserat bei tutor24.ch schicken will. Du siehst das Inserat und die fertige Nachricht.

Die Nachricht besteht fast ganz aus festen Textbausteinen, die der Lehrer bewusst für ALLE Inserate gleich verwendet und selbst freigegeben hat. Beurteile sie NICHT, auch wenn sie nicht genau aufs Inserat zugeschnitten sind:
- Vorstellung: Mathe UND Physik, online oder in Zürich, Deutsch oder Englisch, über 12 Jahre, ETH, über 30 Schüler, meist Gymi/Uni. Das gilt auch bei Primarschule, bei Wunsch nach Unterricht vor Ort/zuhause und wenn das Inserat Physik nicht erwähnt.
- Eigene Lehrmittel für Gymi/BM, Lernplattform Mathetogo, Quizzes, Google Meet, iPad, Unterlagen nach der Lektion, WhatsApp-Nummer, Website.
- Hinweis auf Kurse in kleinen Gruppen bei Academigo ab CHF, Kursblock mit Terminen und Preis, Bitte um kurze Antwort im Chat, Gruss "Omid".
- Schlusssätze wie "nicht nur den aktuellen Stoff verstehen, sondern Mathematik nachhaltig angehen" oder "Lernstrategie, Struktur und Motivation".
- Sucht das Inserat weitere Fächer (Deutsch, Französisch, Englisch, NMG …), ist es richtig, dass die Nachricht nur Mathe/Physik anbietet und die anderen Fächer nicht erwähnt.
- Alle tutor24-Inserate sind von der Plattform als Angebot an Lehrkräfte formuliert ("Sind Sie Tutor?", "Haben Sie Lust auf einen Nachhilfejob?", "Neues Jobangebot!", "wir freuen uns auf Sie"). Das ist normal und KEIN Stellenangebot einer Agentur, und das "Sie" darin richtet sich an den Lehrer, nicht an die Person, die Nachhilfe sucht.

Zu prüfen ist vor allem der persönliche Teil (meist ein bis zwei Sätze nach der Vorstellung, die aufs Anliegen eingehen) und die Anrede. Prüfe nur diese Punkte:
1. Anrede: Schreibt die Person in der Ich-Form über sich selbst ("ich brauche Hilfe", "ich habe bald Prüfung"), ist "du" richtig, auch bei Erwachsenen. Schreiben Eltern über ihr Kind ("mein Sohn", "unsere Tochter", "unser Kind"), ist "Sie" mit Bezug auf das Kind richtig. Ist es unklar, ist "Sie" richtig. Englisch "you", Französisch "vous" sind immer richtig. Auffällig nur bei klarem Widerspruch (z. B. "du" an Eltern, "Ihr Kind" obwohl der Schüler selbst schreibt, falsches Geschlecht des Kindes).
2. Stufe: Nennt der persönliche Teil oder der Kursblock eine Stufe oder Prüfung, die dem Inserat klar widerspricht (z. B. Gymiprüfung, aber das Inserat sucht Hilfe an der Uni)?
3. Behauptet der persönliche Teil etwas über die Person oder ihr Anliegen, das nicht im Inserat steht (erfundene Prüfung, erfundenes Thema, erfundener Name), oder verspricht er etwas, das niemand halten kann (Notengarantie)?
4. Klingt der persönliche Teil deutlich nach KI (hohle Floskeln, das Inserat wörtlich nacherzählt, schwülstig)? Sachlich und leicht formell ist ok.
5. Sprache: Ist die Nachricht nicht in der Sprache des Inserats (Deutsch, Englisch, Französisch)?
6. Ist das Inserat offensichtlich keine Nachhilfe-Suche mit Mathematik oder Physik (z. B. Firma sucht Angestellte, Mathe kommt gar nicht vor)?
7. Sonst etwas klar Kaputtes (abgeschnittener Satz, Platzhalter wie [Name], doppelte Absätze, falscher Name).

Diese Formfragen prüfst du IMMER streng, auch bei den festen Bausteinen (sie sind dann kaputt, nicht gewollt):
- Vollständig? Die Nachricht muss mit einem Gruss und dem Namen "Omid" enden. Endet sie mitten im Satz oder fehlt der Schluss mit Gruss und "Omid" → auffällig.
- Platzhalter in eckigen oder geschweiften Klammern ([Name], {kurs}) oder ein anderer Name als "Omid" am Schluss → auffällig.
- Sprache: Ist das Inserat englisch (z. B. "Tutoring needed", "Maths", "lessons"), muss die Nachricht englisch sein; ist es französisch, französisch; sonst deutsch. Andere Sprache → auffällig. Deutsche Plattform-Zusätze wie "Neues Jobangebot!" zählen dabei nicht.

Sei sonst grosszügig. Stil, Geschmack, "könnte persönlicher sein" und "geht nicht auf alle Wünsche ein" sind "ok". "auffällig" nur, wenn einer der Punkte 1–7 klar verletzt ist und du die Nachricht deshalb nicht abschicken würdest.

Antworte nur mit JSON: {"urteil":"ok"} oder {"urteil":"auffällig","grund":"<ein kurzer Satz auf Deutsch>"}.`;

export function agentNachricht(i: AgentInput): string {
  return (
    `INSERAT\nTitel: ${i.titel}\n${i.fach ? `Fach: ${i.fach}\n` : ""}${i.stufe ? `Stufe: ${i.stufe}\n` : ""}Text:\n${i.beschreibung || "(kein Text)"}\n\n` +
    `NACHRICHT (${i.art === "erst" ? "Erst-Nachricht" : "Nachfassen, zweite Nachricht im selben Chat"})\n${i.text}`
  );
}

export function parseUrteil(raw: string): AgentUrteil {
  try {
    const j = JSON.parse(raw.replace(/^```(?:json)?|```$/g, "").trim());
    const u = String(j.urteil ?? "").toLowerCase();
    if (u === "ok") return { urteil: "ok", grund: "" };
    if (u.startsWith("auff")) return { urteil: "auffaellig", grund: String(j.grund ?? "").trim() || "ohne Begründung" };
  } catch {
    /* unten */
  }
  return { urteil: "fehler", grund: `Antwort nicht lesbar: ${raw.slice(0, 80)}` };
}

type Client = { chat: { completions: { create: (a: object, o?: object) => Promise<{ choices: { message: { content: string | null } }[] }> } } };

export async function pruefAgent(i: AgentInput, client?: Client): Promise<AgentUrteil> {
  try {
    if (!client) {
      if (!process.env.OPENAI_API_KEY) return { urteil: "fehler", grund: "kein OPENAI_API_KEY" };
      const { default: OpenAI } = await import("openai");
      client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) as unknown as Client;
    }
    const r = await client.chat.completions.create(
      {
        model: process.env.PRUEF_AGENT_MODEL || "gpt-4.1",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: AGENT_ANWEISUNG },
          { role: "user", content: agentNachricht(i) },
        ],
      },
      { timeout: 45_000 }
    );
    return parseUrteil(r.choices[0]?.message?.content ?? "");
  } catch (err) {
    return { urteil: "fehler", grund: `Prüf-Agent nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`.slice(0, 160) };
  }
}

/** Zaehler eines Durchgangs (Erst-Nachrichten und Nachfassen zusammen) */
export type AgentPass = { ok: number; auffaellig: number; fehler: number; fehlerFolge: number; halt: string | null; aus: boolean; gruende: string[] };
export const agentPass = (): AgentPass => ({ ok: 0, auffaellig: 0, fehler: 0, fehlerFolge: 0, halt: null, aus: false, gruende: [] });

export function agentZaehlen(p: AgentPass, u: AgentUrteil): AgentPass {
  if (u.urteil === "fehler") {
    p.fehler++;
    p.fehlerFolge++;
    if (p.fehlerFolge >= 2 && !p.halt) p.halt = "Prüf-Agent zweimal hintereinander nicht erreichbar — in diesem Durchgang wird nichts mehr gesendet";
    return p;
  }
  p.fehlerFolge = 0;
  if (u.urteil === "ok") p.ok++;
  else {
    p.auffaellig++;
    p.gruende.push(u.grund);
  }
  const geprueft = p.ok + p.auffaellig;
  if (p.auffaellig > AGENT_MAX_AUFFAELLIG || (geprueft >= AGENT_ANTEIL_AB && p.auffaellig / geprueft > AGENT_MAX_ANTEIL)) {
    p.halt = `Prüf-Agent: ${p.auffaellig} von ${geprueft} Nachrichten auffällig (Grenze: mehr als ${AGENT_MAX_AUFFAELLIG} oder mehr als 30 % ab ${AGENT_ANTEIL_AB}) — deutet auf einen Fehler`;
    p.aus = true;
  }
  return p;
}

export type AgentEintrag = { am: string; tag: string; id: string; art: "erst" | "nachfassen"; titel: string; urteil: AgentUrteil["urteil"]; grund: string; probe?: boolean };

export function loadAgentLog(path = AGENT_LOG): AgentEintrag[] {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as AgentEintrag[]) : [];
  } catch {
    return [];
  }
}
export function agentProtokoll(e: Omit<AgentEintrag, "am" | "tag">, now = new Date(), path = AGENT_LOG): void {
  // ponytail: ganze Datei neu schreiben; 60 Eintraege am Tag, nach einem Jahr ~2 MB — dann alte abschneiden
  const all = loadAgentLog(path);
  all.push({ ...e, am: now.toISOString(), tag: zurichDay(now) });
  writeFileSync(path, JSON.stringify(all.slice(-5000), null, 1));
}

export const urteilLabel = (u: AgentUrteil) =>
  u.urteil === "ok" ? "🤖 Agent: ok" : u.urteil === "auffaellig" ? `🤖 Agent: auffällig – ${u.grund}` : `🤖 ${u.grund}`;
