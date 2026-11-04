import { describe, expect, it } from "vitest";
import {
  PREVIEW_COLS,
  detectAddressee,
  effectiveStatus,
  mergeSettings,
  newCourse,
  parseJobText,
  type Course,
  type ListingInfo,
  type PreviewRow,
} from "./tutor24-followup";
import { assembleFirstMessage, firstMessageProblem, formFor, planFirstMessage, sentenceProblem } from "./tutor24-course-offer";

const NOW = new Date(2026, 10, 4);
const settings = mergeSettings(null);
const matura = (p: Partial<Course> = {}): Course => ({ ...newCourse("Mathe", "matura", NOW), id: "m1", active: true, deadline: "2026-11-14", ...p });
const listing = (description: string, schulstufe = "Gymnasium", fach = "Mathematik"): ListingInfo => ({ title: "Nachhilfe Mathematik", fach, schulstufe, description });

describe("Anrede", () => {
  it("drei Faelle, Kind nur bei genau einem", () => {
    expect(detectAddressee("Ich mache dieses Jahr Matura")).toEqual({ wer: "schueler", anrede: "du", kind: null });
    expect(detectAddressee("absolviere momentan die Vollzeit-Berufsmatura").wer).toBe("schueler");
    expect(detectAddressee("Ich suche für meine Tochter Hilfe").kind).toBe("Tochter");
    expect(detectAddressee("Unser Sohn ist in der 2. Sek").kind).toBe("Sohn");
    expect(detectAddressee("meine beiden Söhne")).toEqual({ wer: "eltern", anrede: "Sie", kind: null });
    expect(detectAddressee("help my 18 year old son improve").kind).toBe("Sohn");
    expect(detectAddressee("Er ist in der 3. Sek").wer).toBe("unklar");
    expect(detectAddressee("Ich bin 14 und suche Hilfe").wer).toBe("unklar");
  });
});

describe("Kurswahl", () => {
  const plan = (d: string, courses = [matura()], now = NOW) => planFirstMessage(listing(d), courses, settings, [], now);

  it("passender aktiver Kurs nur bei Sicherheit hoch", () => {
    expect(plan("Ich mache dieses Jahr Matura und möchte mich vorbereiten").offer.kind).toBe("kurs");
    expect(plan("Ich mache dieses Jahr Matura", [matura({ active: false })]).offer).toMatchObject({ kind: "nachfrage", grund: "kein_kurs" });
  });

  it("Anmeldeschluss, ausgebucht, vor Ort, Ausschluss", () => {
    expect(plan("Ich mache dieses Jahr Matura", [matura()], new Date(2026, 10, 15)).offer).toMatchObject({ grund: "anmeldeschluss_vorbei" });
    expect(plan("Ich mache dieses Jahr Matura", [matura({ maxParticipants: 0, minParticipants: 0 })]).offer).toMatchObject({ grund: "ausgebucht" });
    expect(plan("Ich mache dieses Jahr Matura, Unterricht bei uns zu Hause").offer).toMatchObject({ grund: "nur_vor_ort" });
    expect(plan("Ich bin an der FMS und mache die Fachmatura").offer.kind).toBe("nichts");
  });
});

describe("Nachfassen nutzt dieselbe Kurswahl", () => {
  const row = (p: Partial<PreviewRow>): PreviewRow =>
    ({
      ...Object.fromEntries(PREVIEW_COLS.map((c) => [c, ""])),
      status: "send", conversation_id: "1", kategorie: "matura", faecher: "Mathe", kursgruppe: "matura", sicherheit: "hoch", ort: "online",
      ...p,
    }) as PreviewRow;
  const eff = (p: Partial<PreviewRow>, courses = [matura()], now = NOW) => effectiveStatus(row(p), courses, settings, new Set(), [], now);

  it("sendet nur, was auch die Erst-Nachricht anbieten wuerde", () => {
    expect(eff({}).label).toBe("wird gesendet");
    expect(eff({ sicherheit: "mittel" }).label).toBe("kein Kurs: Stufe unsicher");
    expect(eff({ ausschluss: "fachmatur" }).label).toBe("ausgeschlossen: fachmatur");
    expect(eff({}, [matura()], new Date(2026, 10, 15)).label).toBe("kein Kurs: Anmeldeschluss vorbei");
    expect(eff({ ort: "vor Ort" }).label).toBe("kein Kurs: will vor Ort");
    expect(eff({}, [matura({ maxParticipants: 1, minParticipants: 1 })]).send).toBe(true);
  });

  it("volle Kurse: Zusagen aus dem Protokoll zaehlen", () => {
    const log = [{ kurs: "m1", markierung: "Zusage" }, { kurs: "m1", markierung: "Bezahlt" }];
    expect(effectiveStatus(row({}), [matura({ maxParticipants: 2, minParticipants: 1 })], settings, new Set(), log, NOW).label).toBe("kein Kurs: ausgebucht");
  });
});

describe("Nachricht", () => {
  it("Eltern: Sie-Form mit Tochter, Kursblock aus den Daten, kurzer Wichtig-Satz", () => {
    const p = planFirstMessage(listing("Ich suche für meine Tochter, sie macht dieses Jahr die Matura"), [matura()], settings, [], NOW);
    const m = assembleFirstMessage(p, "Da Ihre Tochter dieses Jahr die Matura schreibt, arbeiten wir gezielt an typischen Aufgaben.");
    expect(m.problem).toBeNull();
    expect(m.satz).toBe("ki");
    expect(m.text).toMatch(/^Guten Tag,\n\ngerne unterstütze ich Ihre Tochter/);
    expect(m.text).toContain("CHF 440, also CHF 55 pro Lektion statt CHF 89");
    expect(m.text).toContain("Anmeldeschluss ist der 14.11.");
    expect(m.text).not.toContain("Lernstrategie");
  });

  it("falscher KI-Satz → Rueckfall-Satz; ohne Kurs bleibt der lange Absatz", () => {
    const p = planFirstMessage(listing("Ich mache dieses Jahr Matura"), [], settings, [], NOW);
    const m = assembleFirstMessage(p, "Gerne helfe ich Ihnen bei der Matura.");
    expect(m.satz).toBe("fallback");
    expect(m.text).toMatch(/^Hallo,\n\ngerne unterstütze ich dich/);
    expect(m.text).toContain("Lernstrategie");
    expect(m.course).toBeNull();
  });

  it("Pruefungen: neutral nennt kein Kind, Eltern nicht das falsche", () => {
    expect(sentenceProblem("Ihr Sohn schafft das.", formFor({ wer: "unklar", anrede: "Sie", kind: null }))).toMatch(/neutrale/);
    expect(sentenceProblem("Ihr Sohn schafft das.", formFor({ wer: "eltern", anrede: "Sie", kind: "Tochter" }))).toMatch(/Sohn/);
    expect(sentenceProblem("Du schaffst das.", formFor({ wer: "eltern", anrede: "Sie", kind: "Tochter" }))).toMatch(/du/i);
    expect(firstMessageProblem("Hallo {vorname}", { typ: "du" }, null)).toMatch(/Platzhalter/);
    expect(sentenceProblem("Gerne unterstütze ich Ihre Tochter in Mathe.", formFor({ wer: "eltern", anrede: "Sie", kind: "Tochter" }))).toMatch(/Anfang/);
  });
});

it("parseJobText liest Fach, Stufe, Freitext", () => {
  const t = "x\nFach\nMathematik\nSchulstufe\nGymnasium\nZusätzliche Informationen\n\nIch mache Matura.\n\nGesuchte Nachhilfe\n…";
  expect(parseJobText(t, "Titel - Tutor24")).toMatchObject({ active: true, fach: "Mathematik", schulstufe: "Gymnasium", description: "Ich mache Matura.", title: "Titel" });
});
