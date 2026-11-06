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
import {
  CHECK_RULES,
  assembleFirstMessage,
  courseHint,
  hintExcluded,
  insertHintBeforeClosing,
  buildFollowup,
  firstMessageProblem,
  followupForm,
  followupMessage,
  formFor,
  messageCheck,
  planFirstMessage,
  sentenceProblem,
} from "./tutor24-course-offer";
import { courseBlock, courseChanged, courseSnapshot, withAnrede, type LeadInfo } from "./tutor24-followup";

const NOW = new Date(2026, 10, 4);
const settings = mergeSettings({ newFirstMessage: true });
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

  it("Stufe offen: Ausgeschlossene bekommen auch die Stufen-Frage nicht", () => {
    const frage = { ...newCourse("Mathe", "offen", NOW), id: "q1", active: true };
    expect(eff({ kursgruppe: "offen", sicherheit: "tief" }, [frage]).label).toBe("wird gesendet");
    for (const ausschluss of ["fms", "fachmatur", "passerelle", "bachelor", "erwachsen"])
      expect(eff({ kursgruppe: "offen", sicherheit: "tief", ausschluss }, [frage]).label).toBe(`ausgeschlossen: ${ausschluss}`);
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
    expect(firstMessageProblem("Hallo {vorname}", { typ: "du" }, null, 89)).toMatch(/Platzhalter/);
    expect(sentenceProblem("Gerne unterstütze ich Ihre Tochter in Mathe.", formFor({ wer: "eltern", anrede: "Sie", kind: "Tochter" }))).toMatch(/Anfang/);
  });
});

it("parseJobText liest Fach, Stufe, Freitext", () => {
  const t = "x\nFach\nMathematik\nSchulstufe\nGymnasium\nZusätzliche Informationen\n\nIch mache Matura.\n\nGesuchte Nachhilfe\n…";
  expect(parseJobText(t, "Titel - Tutor24")).toMatchObject({ active: true, fach: "Mathematik", schulstufe: "Gymnasium", description: "Ich mache Matura.", title: "Titel" });
});

describe("Nachfassen: gleiche Bausteine, Bezug auf die Erst-Nachricht", () => {
  const eltern = formFor({ wer: "eltern", anrede: "Sie", kind: "Tochter" });
  const erst = assembleFirstMessage(
    planFirstMessage(listing("Ich suche für meine Tochter, sie macht dieses Jahr die Matura"), [matura()], settings, [], NOW),
    "Da Ihre Tochter dieses Jahr die Matura schreibt, arbeiten wir gezielt an typischen Aufgaben."
  ).text;
  const lead = (p: Partial<LeadInfo> = {}): LeadInfo => ({
    quelle: "erstnachricht", status: "offen", wer: "eltern", kind: "Tochter", anrede: "Sie", sprache: "de",
    erstKursId: "m1", erstKursDaten: courseSnapshot(matura()), freigabeKursId: null, nachgefasst: false, ...p,
  });
  const row = (p: Partial<PreviewRow> = {}): PreviewRow =>
    ({
      ...Object.fromEntries(PREVIEW_COLS.map((c) => [c, ""])),
      status: "send", conversation_id: "1", kategorie: "matura", faecher: "Mathe", kursgruppe: "matura", sicherheit: "hoch", ort: "online", anrede: "Sie",
      ...p,
    }) as PreviewRow;
  const eff = (l: LeadInfo | undefined, courses = [matura()]) => effectiveStatus(row(), courses, settings, new Set(), [], NOW, l);

  it("gleicher Gruss, gleiche Signatur, wortgleicher Kursblock", () => {
    const n = buildFollowup("angebot", eltern, "Petra", matura(), 89);
    expect(erst.startsWith("Guten Tag,")).toBe(true);
    // Name im Gruss nur in der du-Fassung
    expect(n.startsWith("Guten Tag,\n\n")).toBe(true);
    expect(buildFollowup("angebot", { typ: "neutral" }, "Petra", matura(), 89).startsWith("Guten Tag,\n\n")).toBe(true);
    expect(buildFollowup("angebot", { typ: "du" }, "Lea", matura(), 89).startsWith("Hallo Lea,\n\n")).toBe(true);
    expect(erst.endsWith("Liebi Grüess\nOmid")).toBe(true);
    expect(n.endsWith("Liebi Grüess\nOmid")).toBe(true);
    const block = courseBlock(matura(), 89);
    expect(erst).toContain(block);
    expect(n).toContain(block);
    expect(block).toContain("(maximal 6 Teilnehmende)");
    expect(courseBlock(matura({ maxParticipants: 4 }), 95)).toContain("(maximal 4 Teilnehmende)");
    expect(courseBlock(matura(), 95)).toContain("statt CHF 95 im Einzelunterricht");
    // Eltern-Fassung bleibt im Nachfassen: "für Ihre Tochter"
    expect(n).toContain("Soll ich für Ihre Tochter einen Platz reservieren?");
    expect(n).not.toMatch(/neues .*Angebot/);
  });

  it("Regel 5: Erinnerung, geaendert, neuer Durchgang, Freigabe, angemeldet", () => {
    expect(eff(lead()).kind).toBe("erinnerung");
    const erinnerung = followupMessage("erinnerung", eltern, "Petra", matura(), 89);
    expect(erinnerung.problem).toBeNull();
    expect(erinnerung.text).not.toContain("CHF");
    expect(erinnerung.text).toContain("Dabei hatte ich auch den");
    // Kursdaten geaendert (gespeicherte Daten der Erst-Nachricht ≠ heute) → aktueller Block
    const moved = matura({ saturdays: ["2027-01-09", "2027-01-16", "2027-01-23", "2027-01-30"] });
    expect(eff(lead(), [moved]).kind).toBe("geaendert");
    for (const p of [{ time: "10:00–11:40 Uhr" }, { pricePerLesson: 60 }, { maxParticipants: 8, minParticipants: 3 }, { deadline: "2026-11-13" }])
      expect(eff(lead(), [matura(p)]).kind).toBe("geaendert");
    // Nur Text geaendert (Kursname, Baustein, englischer Name, Einzelpreis): bleibt Erinnerung
    expect(eff(lead(), [matura({ name: "Matura-Mathekurs", nameEn: "Matura maths course" })]).kind).toBe("erinnerung");
    expect(effectiveStatus(row(), [matura()], { ...settings, privatePricePerLesson: 95 }, new Set(), [], NOW, lead()).kind).toBe("erinnerung");
    // JSON aus der Datenbank: andere Schluessel-Reihenfolge zaehlt nicht
    const reordered = Object.fromEntries(Object.entries(courseSnapshot(matura())).reverse());
    expect(courseChanged(reordered, matura())).toBe(false);
    // Aeltere Nachricht ohne gespeicherte Kursdaten: nicht als geaendert werten
    expect(eff(lead({ erstKursDaten: null }), [moved]).kind).toBe("erinnerung");
    // Kurs aus der Erst-Nachricht voll, neuer Durchgang derselben Gruppe
    expect(eff(lead({ erstKursId: "alt" })).kind).toBe("neuer_durchgang");
    // Erst-Nachricht ohne Kurs: nur mit Freigabe
    expect(eff(lead({ erstKursId: null })).label).toBe("wartet auf Freigabe");
    expect(eff(lead({ erstKursId: null, freigabeKursId: "m1" })).kind).toBe("angebot");
    expect(eff(lead({ status: "Zusage" })).label).toBe("angemeldet");
    expect(eff(lead({ status: "Bezahlt" })).send).toBe(false);
    expect(eff(lead({ nachgefasst: true })).label).toBe("bereits nachgefasst");
    // Franzoesisch: einfaches Nachfassen ohne Kurs, vous-Form, keine Kontaktangaben
    const fr = eff(lead({ sprache: "fr" }));
    expect(fr).toMatchObject({ send: true, kind: "einfach", course: null });
    const frText = followupMessage("einfach", followupForm(lead({ sprache: "fr" }), "Sie"), "Claire", null, 89);
    expect(frText.problem).toBeNull();
    expect(frText.text).toMatch(/^Bonjour,\n\nJe vous avais contacté il y a quelque temps/);
    expect(frText.text.endsWith("Meilleures salutations\nOmid")).toBe(true);
    expect(frText.text).not.toContain("CHF");
    // Aeltere Kontakte ohne Erst-Nachricht in der Datenbank: wie bisher
    expect(eff(undefined).kind).toBe("angebot");
    expect(eff(lead({ quelle: "nachfassen", erstKursId: null })).kind).toBe("angebot");
  });

  it("Anrede aus der Erst-Nachricht, sonst aus der Vorschau", () => {
    expect(followupForm(lead(), "du")).toMatchObject({ typ: "eltern", akk: "Ihre Tochter" });
    expect(followupForm(undefined, "du")).toEqual({ typ: "du" });
    expect(followupForm(undefined, "Sie")).toEqual({ typ: "neutral" });
    expect(followupForm(lead({ sprache: "en" }), "Sie")).toEqual({ typ: "en" });
  });

  it("Anrede-Knopf: die Wahl bei der Person schaltet den Text um (Gruss, Anrede, Verben)", () => {
    // Luana: Nachfass-Kontakt, gespeichert du; die Vorschau-Zeile allein reicht nicht, die Person geht vor.
    const luana = lead({ quelle: "nachfassen", wer: "schueler", kind: null, anrede: "du", erstKursId: null, erstKursDaten: null });
    const text = (l: LeadInfo) => followupMessage("angebot", followupForm(l, l.anrede), "Luana", matura(), 89).text;
    expect(followupForm(luana, "Sie")).toEqual({ typ: "du" });
    const sie = text(withAnrede(luana, "Sie"));
    expect(sie).toMatch(/^Guten Tag,/);
    expect(sie).toContain("Ihre Anfrage");
    expect(sie).toContain("Falls Sie noch suchen");
    expect(sie).not.toMatch(/\b(du|deine)\b/);
    const du = text(withAnrede(withAnrede(luana, "Sie"), "du"));
    expect(du).toMatch(/^Hallo Luana,/);
    expect(du).toContain("Falls du noch suchst");
    // Erst-Nachricht an Eltern: auf du umgestellt wird daraus Schueler/in, zurueck auf Sie "unklar" (nicht mehr Eltern)
    expect(followupForm(withAnrede(lead(), "du"), "Sie")).toEqual({ typ: "du" });
    expect(withAnrede(withAnrede(lead(), "du"), "Sie").wer).toBe("unklar");
    expect(withAnrede(lead(), "Sie").wer).toBe("eltern");
  });

  it("alle Arten bestehen die Nachfass-Pruefung, in allen Fassungen", () => {
    const frage = { ...newCourse("Mathe", "offen", NOW), id: "q", active: true };
    for (const f of [{ typ: "du" }, eltern, { typ: "neutral" }, { typ: "en" }] as const)
      for (const k of ["angebot", "erinnerung", "geaendert", "neuer_durchgang", "frage"] as const)
        for (const m of [followupMessage(k, f, "Lea", k === "frage" ? frage : matura(), 89)]) {
          expect(m.problem).toBeNull();
          // kein doppelter Punkt nach dem Datum ("Anmeldeschluss ist der 14.11..")
          expect(m.text).not.toMatch(/\.\.(?!\.)/);
        }
  });

  it("zwei Pruefregeln: Erst-Nachricht darf WhatsApp und Links, Nachfassen nicht", () => {
    expect(CHECK_RULES.erst.kontaktErlaubt).toBe(true);
    expect(CHECK_RULES.nachfassen.kontaktErlaubt).toBe(false);
    expect(erst).toContain("078 693 68 98");
    expect(erst).toContain("www.mathetogo.xyz");
    expect(messageCheck("erst", erst, eltern, matura(), 89)).toBeNull();
    const withLink = buildFollowup("angebot", eltern, "Petra", matura(), 89).replace("Bezahlt wird", "Infos: www.mathetogo.xyz. Bezahlt wird");
    expect(messageCheck("nachfassen", withLink, eltern, matura(), 89)).toMatch(/Link/);
    const withPhone = buildFollowup("angebot", eltern, "Petra", matura(), 89).replace("Bezahlt wird", "WhatsApp 078 693 68 98. Bezahlt wird");
    expect(messageCheck("nachfassen", withPhone, eltern, matura(), 89)).toMatch(/Telefonnummer/);
    // Nachfassen ohne Bezug auf die Erst-Nachricht oder mit falschem Kursblock
    expect(messageCheck("nachfassen", "Guten Tag,\n\nNeues Angebot!\n\nLiebi Grüess\nOmid", eltern, null, 89)).toMatch(/Bezug/);
    expect(messageCheck("nachfassen", buildFollowup("angebot", eltern, "", matura(), 89), eltern, matura({ pricePerLesson: 60 }), 89)).toMatch(/wortgleich/);
  });

  it("Englisch: Erst-Nachricht und Nachfassen in derselben Sprache", () => {
    const p = planFirstMessage(listing("I am in my final year and will write the Matura this year"), [matura()], settings, [], NOW, "en");
    const m = assembleFirstMessage(p, null);
    expect(m.problem).toBeNull();
    expect(m.text.startsWith("Hello,")).toBe(true);
    expect(m.text).toContain(courseBlock(matura(), 89, "en"));
    expect(m.text.endsWith("Best regards\nOmid")).toBe(true);
    const n = followupMessage("erinnerung", { typ: "en" }, "Sam", matura(), 89);
    expect(n.text).toMatch(/^Hello,\n\nI got in touch with you a while ago/);
    expect(n.problem).toBeNull();
    // Englischer Kursname, falls gesetzt; sonst der deutsche
    const en = matura({ nameEn: "Matura maths preparation course" });
    expect(courseBlock(en, 89, "en")).toContain("offering a Matura maths preparation course in a small group");
    expect(courseBlock(en, 89, "de")).toContain("einen Mathe-Vorbereitungskurs für die Matura");
    expect(followupMessage("erinnerung", { typ: "en" }, "Sam", en, 89).text).toContain("mentioned the Matura maths preparation course");
    expect(courseBlock(matura(), 89, "en")).toContain("offering a Mathe-Vorbereitungskurs für die Matura");
  });
});

describe("Entscheidungen 5.11.", () => {
  it("BM2 mit Schulstufe 'Erwachsenenbildung' (Andrea) ist BM, nicht ausgeschlossen", () => {
    const andrea: ListingInfo = {
      title: "Nachhilfe – sind Sie dabei?",
      fach: "Mathematik",
      schulstufe: "Sekundarstufe und Erwachsenenbildung",
      description: "Ich besuche momentan die Berufsmaturität (BM2) Vollzeit in Thun und suche regelmässige Nachhilfe, hauptsächlich in Mathematik.",
    };
    const bm = { ...newCourse("Mathe", "bm", NOW), id: "b1", active: true, deadline: "2026-11-14" };
    const p = planFirstMessage(andrea, [bm], settings, [], NOW);
    expect(p.analysis.kategorie).toBe("bm");
    expect(p.analysis.ausschluss).toBe("");
    expect(p.offer.kind).toBe("kurs");
    // Schulkurse bleiben fuer Erwachsene ausgeschlossen
    const erw = planFirstMessage({ ...andrea, schulstufe: "Erwachsenenbildung", description: "Ich möchte meine Mathe-Kenntnisse auffrischen." }, [matura()], settings, [], NOW);
    expect(erw.offer.kind).toBe("nichts");
  });

  it("KI-Satz darf kein Ziel erfinden, das nicht im Inserat steht", () => {
    const neutral = { typ: "neutral" } as const;
    const sek = "Nachhilfe Mathe\nSekundarstufe\nMein Kind ist in der 2. Sek und braucht Hilfe in Algebra.";
    expect(sentenceProblem("Für die Vorbereitung auf die Matura können gezielte Übungen helfen.", neutral, sek)).toMatch(/Matura/);
    expect(sentenceProblem("Für die Vorbereitung auf die Gymiprüfung braucht es Übung.", neutral, sek)).toMatch(/Gymiprüfung/);
    expect(sentenceProblem("Gerade bei der Algebra der 2. Sek helfen gezielte Übungen.", neutral, sek)).toBeNull();
    // steht das Ziel im Inserat, ist es erlaubt
    expect(sentenceProblem("Für die Vorbereitung auf die Matura helfen gezielte Übungen.", neutral, "Gymnasium\nIch mache dieses Jahr Matura.")).toBeNull();
    expect(sentenceProblem("Für die BM-Prüfung helfen gezielte Übungen.", neutral, "Ich mache die BM2 in Thun.")).toBeNull();
    // ohne Inserat-Text (alte Aufrufe) keine Ziel-Pruefung
    expect(sentenceProblem("Für die Vorbereitung auf die Matura helfen gezielte Übungen.", neutral)).toBeNull();
  });

  it("Anrede bleibt wie in der ersten Nachricht (gespeichert), Vorschau nur bei fehlender Angabe", () => {
    const stored = (anrede: string): LeadInfo => ({
      quelle: "nachfassen", status: "offen", wer: "unklar", kind: null, anrede, sprache: "de",
      erstKursId: null, erstKursDaten: null, freigabeKursId: null, nachgefasst: false,
    });
    expect(followupForm(stored("Sie"), "du")).toEqual({ typ: "neutral" });
    expect(followupForm(stored("du"), "Sie")).toEqual({ typ: "du" });
    expect(followupForm(stored(""), "du")).toEqual({ typ: "du" });
  });
});

describe("Kurs-Hinweis (Academigo, Entscheid 6.11.)", () => {
  const S = (p: Partial<ReturnType<typeof mergeSettings>>) => mergeSettings({ newFirstMessage: true, kursHinweis: true, kursPreisAb: 60, ...p });
  const msg = (d: string, s = S({}), courses: Course[] = [], schulstufe = "Sekundarstufe", sprache = "de") =>
    assembleFirstMessage(planFirstMessage(listing(d, schulstufe), courses, s, [], NOW, sprache), null);
  const HEAD = "Neben dem Einzelunterricht biete ich über meine Kursplattform Academigo (www.academigo.xyz) auch Kurse in kleinen Gruppen an, ab CHF 60 pro Lektion. Ein Kurs findet jeweils statt, sobald genügend Anmeldungen für eine Stufe zusammenkommen.";

  it("Bausteine wortgleich je Anrede und Sprache, Preis aus der Einstellung", () => {
    expect(courseHint({ typ: "du" }, 60)).toBe(`${HEAD} Wenn du Interesse hast, gib mir kurz Bescheid. Ich prüfe dann, ob ein passender Kurs läuft oder geplant ist, und melde mich bei dir.`);
    expect(courseHint(formFor({ wer: "eltern", anrede: "Sie", kind: "Sohn" }), 60)).toBe(
      `${HEAD} Falls das für Ihren Sohn interessant ist, geben Sie mir gerne kurz Bescheid. Ich prüfe dann, ob ein passender Kurs läuft oder geplant ist, und melde mich bei Ihnen.`
    );
    expect(courseHint({ typ: "neutral" }, 60)).toBe(`${HEAD} Bei Interesse geben Sie mir gerne kurz Bescheid. Ich prüfe dann, ob ein passender Kurs läuft oder geplant ist, und melde mich bei Ihnen.`);
    expect(courseHint({ typ: "en" }, 60)).toMatch(/^In addition to private lessons, I also offer small-group courses through my course platform Academigo \(www\.academigo\.xyz\), starting at CHF 60 per lesson\./);
    expect(courseHint({ typ: "fr" }, 60)).toMatch(/via ma plateforme de cours Academigo \(www\.academigo\.xyz\), à partir de CHF 60 par leçon\./);
    for (const f of [{ typ: "du" }, { typ: "neutral" }, { typ: "en" }, { typ: "fr" }] as const) expect(courseHint(f, 60)).not.toMatch(/https?:|\{/);
  });

  it("Schalter: Kurs → Kursblock; kein Kurs → Hinweis; beide aus → keins von beiden (immer neuer Text)", () => {
    const kursFall = "Ich mache dieses Jahr Matura und möchte mich vorbereiten";
    expect(msg(kursFall, S({}), [matura()], "Gymnasium")).toMatchObject({ problem: null, hint: null });
    expect(msg(kursFall, S({}), [matura()], "Gymnasium").course?.id).toBe("m1");
    // Kursblock-Schalter aus: derselbe Fall bekommt den Hinweis
    const ohneBlock = msg(kursFall, S({ newFirstMessage: false }), [matura()], "Gymnasium");
    expect(ohneBlock.course).toBeNull();
    expect(ohneBlock.text).toContain(HEAD);
    // beide aus: neuer Text (du-Form, Gruss, Signatur), ohne Kursblock und ohne Hinweis, langer Wichtig-Absatz
    const keins = msg(kursFall, S({ newFirstMessage: false, kursHinweis: false }), [matura()], "Gymnasium");
    expect(keins).toMatchObject({ course: null, hint: null, problem: null });
    expect(keins.text).toMatch(/^Hallo,\n\ngerne unterstütze ich dich/);
    expect(keins.text).not.toContain("Academigo");
    expect(keins.text).toContain("Lernstrategie");
  });

  it("mit Hinweis: an der Stelle des Kursblocks, Wichtig-Absatz gekuerzt, Pruefung besteht", () => {
    const m = msg("Ich suche für meine Tochter Nachhilfe, sie ist in der 2. Sek");
    expect(m.problem).toBeNull();
    const paras = m.text.split("\n\n");
    expect(paras[3]).toBe(courseHint(formFor({ wer: "eltern", anrede: "Sie", kind: "Tochter" }), 60));
    expect(m.text).not.toContain("Lernstrategie");
  });

  it("wer den Hinweis bekommt: alle ausser Erwachsene ohne BM-Bezug", () => {
    expect(msg("Ich bin erwachsen und möchte meine Mathekenntnisse auffrischen", S({}), [], "Erwachsenenbildung").hint).toBeNull();
    // BM2 nach der Lehre, Schulstufe Erwachsenenbildung: bekommt den Hinweis
    expect(msg("Ich mache die BM2 nach der Lehre und brauche Hilfe in Mathe", S({}), [], "Berufsmaturität und Erwachsenenbildung").hint).not.toBeNull();
    expect(msg("Erwachsene Person, Vorbereitung auf die Berufsmatura", S({}), [], "Erwachsenenbildung").hint).not.toBeNull();
    expect(hintExcluded(listing("Ich bin erwachsen", "Erwachsenenbildung"), "ausgeschlossen")).toBe(true);
    expect(hintExcluded(listing("BM 1 neben der Lehre, ich bin erwachsen", "Erwachsenenbildung"), "ausgeschlossen")).toBe(false);
    for (const [d, stufe] of [["Ich bin an der FMS", "FMS"], ["Mein Sohn ist in der 5. Klasse", "Primarschule"], ["Ich studiere im Bachelor", "Universität"]])
      expect(msg(d, S({}), [], stufe).hint, stufe).not.toBeNull();
  });

  it("Pruefung: Hinweis wortgleich, keine Andeutung 'dort anmelden/finden', Website ohne http", () => {
    const m = msg("Ich bin in der 2. Sek und brauche Hilfe");
    const f = { typ: "du" } as const;
    const hint = courseHint(f, 60);
    expect(firstMessageProblem(m.text, f, null, 89, hint)).toBeNull();
    expect(firstMessageProblem(m.text.replace("ab CHF 60", "ab CHF 50"), f, null, 89, hint)).toMatch(/wortgleich/);
    expect(firstMessageProblem(m.text.replace(hint, `${hint} Auf Academigo kannst du dich direkt anmelden.`), f, null, 89, hint)).toMatch(/Website/);
    expect(firstMessageProblem(m.text.replace("www.mathetogo.xyz", "https://www.academigo.xyz"), f, null, 89, hint)).toMatch(/Website/);
  });

  it("Franzoesisch: Hinweis als Absatz vor dem Gruss, wortgleich geprueft", () => {
    const hint = courseHint({ typ: "fr" }, 60);
    const ki = "Bonjour,\n\nJe serais ravi de vous aider en mathématiques.\n\nN'hésitez pas à me contacter.\n\nMeilleures salutations\nOmid";
    const t = insertHintBeforeClosing(ki, hint);
    expect(t.split("\n\n").slice(-2)).toEqual([hint, "Meilleures salutations\nOmid"]);
    expect(firstMessageProblem(t, { typ: "fr" }, null, 89, hint)).toBeNull();
    expect(firstMessageProblem(ki, { typ: "fr" }, null, 89, hint)).toMatch(/wortgleich/);
    expect(planFirstMessage(listing("Je cherche de l'aide en maths pour mon fils"), [matura()], S({}), [], NOW, "fr")).toMatchObject({ course: null, hint });
  });
});
