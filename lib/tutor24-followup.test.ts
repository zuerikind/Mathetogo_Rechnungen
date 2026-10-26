import { describe, expect, it } from "vitest";
import {
  analyzeListing,
  assignCourse,
  classifyListing,
  compareAnalyses,
  containsForbiddenContact,
  courseStats,
  demandOverview,
  detectAnrede,
  effectiveStatus,
  entryChanged,
  extractAnlass,
  extractGrade,
  extractOrt,
  extractSubjects,
  extractZeitwunsch,
  findReply,
  formatSaturdays,
  hasNewActivity,
  listSender,
  listSkipReason,
  listingFromConversation,
  mergeSettings,
  needsListing,
  newCourse,
  parseCsv,
  parseTutor24Date,
  renderMessage,
  scrollStop,
  snippetSig,
  toCsv,
  toDuForm,
  validateCourses,
  type Course,
  type ListEntry,
  type ListingInfo,
  type LogRow,
  type PreviewRow,
} from "./tutor24-followup";

const listing = (p: Partial<ListingInfo>): ListingInfo => ({
  title: "Nachhilfe Mathematik",
  fach: "Mathematik",
  schulstufe: "",
  description: "",
  ...p,
});

describe("classifyListing", () => {
  const cases: Array<[string, Partial<ListingInfo>, string]> = [
    [
      "ZAP in der 6. Klasse",
      { schulstufe: "Primarschule", description: "Unsere Tochter ist in der 6. Klasse und möchte im März die ZAP schreiben. Wir suchen Unterstützung in Mathe." },
      "gymivorbereitung",
    ],
    [
      "Kurzgymi aus der 2. Sek",
      { schulstufe: "Sekundarstufe", description: "Mein Sohn (2. Sek) bereitet sich auf die Kurzgymiprüfung vor." },
      "gymivorbereitung",
    ],
    [
      "Sek mit Ziel Gymnasium",
      { schulstufe: "Sekundarstufe", description: "Ich bin in der 3. Sek und will nächstes Jahr ans Gymnasium." },
      "gymivorbereitung",
    ],
    [
      "Sek mit Kantonsschule als Ziel",
      { schulstufe: "Sekundarstufe", description: "Er möchte sein Englisch verbessern und später die Kantonsschule besuchen können." },
      "gymivorbereitung",
    ],
    [
      "Probezeit am Gymi",
      { schulstufe: "Gymnasium", description: "Meine Tochter ist neu im Langzeitgymnasium und in der Probezeit. Mathe fällt ihr schwer." },
      "gymi",
    ],
    [
      "Maturajahr",
      { schulstufe: "Gymnasium", description: "Ich bin im letzten Gymi-Jahr und schreibe im Juni die Matura in Mathematik." },
      "matura",
    ],
    [
      "Berufsmatura in der Lehre",
      { schulstufe: "Berufslehre", description: "Ich bin gerade im 1. Lehrjahr mit der BMS und brauche Unterstützung im Fach Mathematik." },
      "bm",
    ],
    [
      "BM-Aufnahmeprüfung geht vor Gymi-Ziel",
      { schulstufe: "Sekundarstufe", description: "Vorbereitung auf die BM-Aufnahmeprüfung nach der 3. Sek." },
      "bm",
    ],
    [
      "Sek ohne Gymi-Ziel",
      { schulstufe: "Sekundarstufe", description: "Unser Kind besucht die 7. Klasse (Sek A) und braucht Unterstützung in Mathematik." },
      "sek",
    ],
    [
      "Primar ohne Gymi-Ziel",
      { schulstufe: "Primarschule", description: "Nachhilfe für zwei 11-jährige Zwillingsjungen gesucht! Schulstufe: 4. Klasse Primarschule" },
      "ausgeschlossen",
    ],
    ["Universität", { schulstufe: "Universität", description: "Ich brauche Hilfe in Analysis I nach meiner Matura." }, "ausgeschlossen"],
    ["Erwachsenenbildung", { schulstufe: "Erwachsenenbildung", description: "Ich möchte meine Mathe-Kenntnisse auffrischen." }, "ausgeschlossen"],
    // Das Fach entscheidet nicht mehr die Stufe — das prueft die Kurszuordnung.
    ["Physik am Gymi", { fach: "Physik", schulstufe: "Gymnasium" }, "gymi"],
    ["Nichts erkennbar", { schulstufe: "", description: "Suche Nachhilfe, gerne online." }, "unklar"],
  ];
  for (const [name, p, expected] of cases) {
    it(name, () => {
      const c = classifyListing(listing(p));
      expect(c.category).toBe(expected);
      expect(c.begruendung.length).toBeGreaterThan(3);
    });
  }

  it("Begruendung zeigt die Fundstelle", () => {
    const c = classifyListing(listing({ description: "Mein Sohn schreibt im März die ZAP, er braucht Mathe." }));
    expect(c.begruendung).toContain("ZAP");
  });
});

describe("extractSubjects", () => {
  // Fach-Felder wie sie in echten Inseraten stehen, inkl. Tippfehler und Englisch/Franzoesisch.
  const cases: Array<[string, string[]]> = [
    ["Mathematik", ["Mathe"]],
    ["Mathemaik, Physik und Chemie", ["Mathe", "Physik", "Chemie"]],
    ["Deutsch, Mathematik", ["Deutsch", "Mathe"]],
    ["Math et allemand", ["Mathe", "Deutsch"]],
    ["Mathematics and German", ["Mathe", "Deutsch"]],
    ["Englisch, Mathe und Französisch", ["Englisch", "Mathe", "Französisch"]],
    ["Hausaufgaben allg. Deutsch Math Französisch NMG", ["Deutsch", "Mathe", "Französisch"]],
    ["Klavier", ["Klavier"]],
  ];
  for (const [fach, expected] of cases)
    it(fach, () => expect(extractSubjects(listing({ fach, title: "Nachhilfe", description: "" }))).toEqual(expected));

  it("Unterrichtssprache ist kein Fach, Freitext ergaenzt", () => {
    expect(
      extractSubjects(listing({ fach: "Physik", title: "Nachhilfe", description: "Unterricht gerne auf Deutsch, eventuell auch Chemie." }))
    ).toEqual(["Physik", "Chemie"]);
  });
});

describe("extractGrade", () => {
  const g = (schulstufe: string, description: string) => extractGrade(listing({ schulstufe, description }));
  it("Sek: Sek 2 → Klasse 8", () => {
    expect(g("Sekundarstufe", "Mein Sohn ist in der 2. Sek.").klasse).toBe(8);
    expect(g("Sekundarstufe", "Sek 3, Niveau A").klasse).toBe(9);
    expect(g("Sekundarstufe", "Unser Kind besucht die 7. Klasse (Sek A).").klasse).toBe(7);
  });
  it("Gymi-Jahr inkl. Kurzgymi, Ordnungswoerter und Englisch", () => {
    expect(g("Gymnasium", "Meine Tochter ist im 2. Gymi.").gymiJahr).toBe(2);
    expect(g("Gymnasium", "Schülerin im zweiten Jahr des Kurzzeitgymnasiums").gymiJahr).toBe(4);
    expect(g("Gymnasium", "Tutor needed in maths for Y3 Gymi student").gymiJahr).toBe(3);
    expect(g("Gymnasium", "Er ist in der 9. Klasse am Gymnasium.")).toEqual({ klasse: 9, gymiJahr: 3, kurz: null });
    expect(g("Gymnasium", "Ich besuche das Gymnasium und bin im letzten Jahr.").gymiJahr).toBe(6);
  });
  it("Gymi-Pruefung ist kein Gymi-Jahr", () => {
    expect(g("Primarschule", "Sie ist in der 6. Klasse Gymiprüfung im März").gymiJahr).toBeNull();
    expect(g("Primarschule", "Sie ist in der 6. Klasse und macht die ZAP.").klasse).toBe(6);
  });
  it("nichts genannt", () => {
    expect(g("Gymnasium", "Unser Kind besucht das Gymnasium.")).toEqual({ klasse: null, gymiJahr: null, kurz: null });
  });
});

describe("analyzeListing: Kursgruppe und Sicherheit", () => {
  const a = (schulstufe: string, description: string) => analyzeListing(listing({ schulstufe, description }));
  it.each([
    ["Sekundarstufe", "Mein Sohn ist in der 2. Sek und hat Mühe in Mathe.", "sek2", "hoch"],
    ["Primarschule", "Unsere Tochter (6. Klasse) bereitet sich auf die Aufnahmeprüfung ans Gymi vor.", "zap_lang", "hoch"],
    ["Sekundarstufe", "Vorbereitung auf die Kurzgymiprüfung.", "zap_kurz", "hoch"],
    ["Sekundarstufe", "Er möchte ins Gymnasium.", "zap_kurz", "mittel"],
    ["Gymnasium", "Meine Tochter ist neu im Langzeitgymnasium und in der Probezeit.", "gymi_unter", "mittel"],
    ["Gymnasium", "Mein Sohn ist im 1. Gymi und in der Probezeit.", "gymi_unter", "hoch"],
    ["Gymnasium", "Schülerin im zweiten Jahr des Kurzzeitgymnasiums", "gymi_mittel", "hoch"],
    ["Gymnasium", "Ich schreibe im Juni die Matura.", "matura", "hoch"],
    ["Berufslehre", "Lehre mit BM, Mathe ist schwierig.", "bm", "hoch"],
    ["Gymnasium", "Unser Kind besucht das Gymnasium.", "", "tief"],
    ["Sekundarstufe", "Nachhilfe für Sekundarstufe.", "", "tief"],
  ])("%s / %s → %s", (schulstufe, description, gruppe, sicherheit) => {
    const r = a(schulstufe, description);
    expect(r.kursgruppe).toBe(gruppe);
    expect(r.sicherheit).toBe(sicherheit);
  });

  it("schreibt nur kurze Werte, nie den ganzen Inseratstext", () => {
    const long = "Unsere Tochter ist im 2. Gymi in Meilen. ".repeat(20);
    const r = analyzeListing(listing({ schulstufe: "Gymnasium", description: long }));
    for (const v of Object.values(r)) expect(String(v).length).toBeLessThan(200);
  });
});

describe("extractOrt", () => {
  const o = (description: string, ort?: string) => extractOrt(listing({ description, ort }));
  it("Modus", () => {
    expect(o("Der Unterricht soll online über Zoom stattfinden.").ort).toBe("online");
    expect(o("Der Unterricht findet bei uns zuhause statt.").ort).toBe("vor Ort");
    expect(o("Gerne online oder vor Ort, beides möglich.").ort).toBe("beides");
    expect(o("Mathe für die 2. Sek.").ort).toBe("unbekannt");
  });
  it("Ortsname aus Feld, PLZ oder Staedteliste", () => {
    expect(o("", "8050 Zürich").ortsname).toBe("8050 Zürich");
    expect(o("Wir wohnen in 8706 Meilen am See.").ortsname).toBe("Meilen");
    expect(o("Er besucht die 5. Klasse in Dübendorf.").ortsname).toBe("Dübendorf");
    expect(o("Keine Angabe.").ortsname).toBe("");
  });
});

describe("extractZeitwunsch", () => {
  it("Wochentage, Tageszeiten, ab-Uhrzeit", () => {
    expect(extractZeitwunsch(listing({ description: "Am liebsten mittwochs oder am Samstagvormittag." }))).toEqual(["Mittwoch", "Vormittag"]);
    expect(extractZeitwunsch(listing({ description: "Dienstag und Donnerstag ab 17 Uhr, nach der Schule." }))).toEqual([
      "Dienstag", "Donnerstag", "nach der Schule", "ab 17 Uhr",
    ]);
    expect(extractZeitwunsch(listing({ description: "Gerne am Wochenende." }))).toEqual(["Wochenende"]);
    expect(extractZeitwunsch(listing({ description: "Die Zeiten sind flexibel." }))).toEqual([]);
  });
});

describe("extractAnlass", () => {
  const an = (description: string) => extractAnlass(listing({ description }));
  it.each([
    ["Sie möchte im März die ZAP schreiben.", "Aufnahmeprüfung"],
    ["Er ist neu am Gymi und in der Probezeit.", "Probezeit"],
    ["Ich schreibe im Juni die Matura in Mathematik.", "Abschlussprüfung"],
    ["Nächste Woche hat sie eine Prüfung über Brüche.", "Prüfung"],
    ["Die Promotion ist gefährdet.", "Noten verbessern"],
    ["Er hat Lücken bei den Grundlagen.", "Lücken allgemein"],
    ["Wir suchen eine Lehrperson.", "unbekannt"],
  ])("%s → %s", (d, expected) => expect(an(d)).toBe(expected));
});

describe("parseTutor24Date", () => {
  it("liest Zeitstempel und Tagestrenner, das letzte Vorkommen gewinnt", () => {
    expect(parseTutor24Date("Hallo ... 25 Oct 26, 09:37")).toEqual(new Date(2026, 9, 25, 9, 37));
    expect(parseTutor24Date("Do 22 Okt 26")).toEqual(new Date(2026, 9, 22, 12, 0));
    expect(parseTutor24Date("Gestern")).toBeNull();
  });
});

describe("detectAnrede", () => {
  it("Eltern und Unklares: Sie, Schueler selbst: du", () => {
    expect(detectAnrede("Unser Kind in Zürich könnte Nachhilfe gebrauchen")).toBe("Sie");
    expect(detectAnrede("meine beiden 11-jährigen Söhne")).toBe("Sie");
    expect(detectAnrede("Ich bin 14 und suche Hilfe")).toBe("Sie");
    expect(detectAnrede("Ich suche Hilfe für meine Matura")).toBe("du");
  });
});

const NOW = new Date(2026, 9, 26);
const course = (p: Partial<Course> = {}): Course => ({ ...newCourse("Mathe", "gymi_unter", NOW), id: "k1", ...p });
const settings = mergeSettings(null);

describe("Kurse und Nachricht", () => {
  it("neuer Kurs: Namensvorschlag, inaktiv, 4 Samstage, Anmeldeschluss davor, gueltig", () => {
    const c = newCourse("Mathe", "sek2", NOW);
    expect(c.name).toBe("Mathe-Repetitionskurs 2. Sek");
    expect(newCourse("Physik", "matura", NOW).name).toBe("Physik-Vorbereitungskurs Matura");
    expect(c.active).toBe(false);
    expect(c.saturdays.every((d) => new Date(d).getDay() === 6)).toBe(true);
    expect(c.saturdays[0] > "2026-11-15").toBe(true);
    expect(c.deadline < c.saturdays[0]).toBe(true);
    expect(c.minParticipants).toBe(3);
    expect(validateCourses([c])).toEqual([]);
  });

  it("fuellt alle Platzhalter", () => {
    const c = course({ name: "Mathe-Repetitionskurs 2. Gymi", saturdays: ["2026-11-28", "2026-12-05", "2026-12-12", "2026-12-19"] });
    const r = renderMessage(c, "Michael", "Sie");
    expect(r.text.startsWith("Hallo Michael\n\nIch hatte mich vor einiger Zeit auf Ihre Anfrage für Mathe-Nachhilfe gemeldet.")).toBe(true);
    expect(r.text).toContain("Ich starte einen Mathe-Repetitionskurs 2. Gymi in einer kleinen Gruppe (maximal 6 Teilnehmende), an 4 Samstagen (28.11., 5.12., 12.12. und 19.12.), jeweils 9:30–11:10 Uhr, online.");
    expect(r.text).toContain("CHF 45 pro Lektion statt CHF 89");
    expect(r.text).toContain("Der Kurs findet ab 3 Anmeldungen statt");
    expect(r.text.endsWith("Liebe Grüsse\nOmid")).toBe(true);
    const t = renderMessage(course({ template: "{fach} {total} {anmeldeschluss} {ort}", deadline: "2026-11-21", mode: "vor Ort", place: "Zürich" }), "", "Sie").text;
    expect(t).toBe("Mathe 360 21.11. vor Ort (Zürich)");
  });

  it("du-Form fuer den Standardtext, Fallback bei eigenem Text", () => {
    const r = renderMessage(course(), "Lea", "du");
    expect(r.anrede).toBe("du");
    expect(r.text).not.toMatch(/\b(Sie|Ihr|Ihre)\b/);
    expect(r.text).toContain("deine Anfrage");
    expect(r.text).toContain("Du lernst");
    expect(toDuForm("Haben Sie Zeit?").ok).toBe(false);
    expect(renderMessage(course({ template: "Hallo {vorname}, haben Sie Zeit?" }), "Lea", "du").warning).toBeTruthy();
  });

  it("Standardtext ohne Kontaktangaben und ohne ß", () => {
    for (const a of ["Sie", "du"] as const) {
      const t = renderMessage(course(), "Lea", a).text;
      expect(containsForbiddenContact(t)).toBe(false);
      expect(t).not.toContain("ß");
    }
  });

  it("lehnt Links, Telefonnummern, unbekannte Platzhalter und fehlende Daten ab", () => {
    expect(validateCourses([course({ template: "Hallo\nwww.mathetogo.xyz" })])).toHaveLength(1);
    expect(validateCourses([course({ template: "Hallo\n079 123 45 67" })])).toHaveLength(1);
    expect(validateCourses([course({ template: "Hallo {name}" })])).toHaveLength(1);
    expect(validateCourses([course({ deadline: "" })])).toHaveLength(1);
    expect(validateCourses([course(), course()])).toHaveLength(1);
  });

  it("formatSaturdays", () => {
    expect(formatSaturdays(["2026-11-28", "2026-12-05"])).toBe("28.11. und 5.12.");
  });
});

const row = (p: Partial<PreviewRow>): PreviewRow => ({
  status: "send", conversation_id: "1", link: "", name: "Lea", kategorie: "gymi", begruendung: "", stufe: "", fach: "",
  faecher: "Mathe", klasse: "", gymi_jahr: "", kursgruppe: "gymi_unter", sicherheit: "hoch", ort: "unbekannt", ortsname: "",
  zeitwunsch: "", anlass: "unbekannt", letzte_nachricht: "", anrede: "Sie", grund: "", quelle: "", kurs: "", nachricht: "",
  ...p,
});

describe("Zuordnung und effektiver Status", () => {
  const mathe = course({ id: "m", active: true });
  const physik = course({ id: "p", fach: "Physik", active: true });

  it("zuerst genanntes Fach gewinnt, sonst das naechste mit Kurs", () => {
    expect(assignCourse(row({ faecher: "Physik, Mathe" }), [mathe, physik], settings)?.id).toBe("p");
    expect(assignCourse(row({ faecher: "Mathe, Physik" }), [mathe, physik], settings)?.id).toBe("m");
    expect(assignCourse(row({ faecher: "Deutsch, Physik" }), [mathe, physik], settings)?.id).toBe("p");
    expect(assignCourse(row({ faecher: "Physik, Mathe" }), [mathe], settings)?.id).toBe("m");
  });

  it("nur aktive Kurse, nur meine Faecher, passende Kursgruppe", () => {
    expect(assignCourse(row({}), [{ ...mathe, active: false }], settings)).toBeNull();
    expect(assignCourse(row({ kursgruppe: "sek2" }), [mathe], settings)).toBeNull();
    expect(assignCourse(row({}), [mathe], { ...settings, mySubjects: ["Physik"] })).toBeNull();
  });

  it("Status-Labels", () => {
    const eff = (p: Partial<PreviewRow>, courses = [mathe], logged = new Set<string>()) => effectiveStatus(row(p), courses, settings, logged).label;
    expect(eff({})).toBe("wird gesendet");
    expect(eff({ status: "skip" })).toBe("skip");
    expect(eff({}, [])).toBe("kein Kurs");
    expect(eff({ faecher: "Deutsch" })).toBe("ausgeschlossen: Fach");
    expect(eff({ kursgruppe: "" })).toBe("keine Kursgruppe");
    expect(eff({ kategorie: "unklar", status: "skip", grund: "" })).toBe("ausgeschlossen: Stufe (unklar)");
    expect(eff({ grund: "abgelehnt" })).toBe("abgelehnt");
    expect(eff({}, [mathe], new Set(["1"]))).toBe("bereits nachgefasst");
  });
});

describe("demandOverview", () => {
  const rows = [
    ...Array.from({ length: 21 }, (_, i) => row({ conversation_id: `a${i}`, ort: i % 2 ? "online" : "vor Ort", anlass: "Probezeit", zeitwunsch: "Mittwoch" })),
    row({ conversation_id: "b1", faecher: "Mathe, Physik", kursgruppe: "matura", sicherheit: "mittel", ort: "beides", zeitwunsch: "Samstag, Vormittag" }),
    row({ conversation_id: "x1", faecher: "Deutsch" }),
    row({ conversation_id: "x2", grund: "abgelehnt" }),
    row({ conversation_id: "x3", status: "skip" }),
  ];
  const d = demandOverview(rows, settings);

  it("gruppiert nach Fach × Kursgruppe, sortiert nach Anzahl", () => {
    expect(d.map((x) => `${x.fach}|${x.gruppe}|${x.count}`)).toEqual(["Mathe|gymi_unter|21", "Mathe|matura|1", "Physik|matura|1"]);
  });
  it("online, Anlass, Zeit, Empfehlung ab N mit Sicherheit hoch", () => {
    expect(d[0]).toMatchObject({ online: 10, hoch: 21, anlass: "Probezeit", zeit: "Mittwoch", recommended: true });
    expect(d[1]).toMatchObject({ online: 1, hoch: 0, recommended: false, zeit: "Samstag, Vormittag" });
    expect(demandOverview(rows, { ...settings, recommendMin: 22 })[0].recommended).toBe(false);
  });
});

describe("Antworten", () => {
  const sentAt = new Date(2026, 9, 20, 10, 0);
  it("erste Antwort nach meinem Nachfassen, ohne Zeitstempel, max. 200 Zeichen", () => {
    const r = findReply(
      [
        { kind: "mine", text: "Hallo, ich biete Nachhilfe an 1 Oct 26, 09:00" },
        { kind: "mine", text: "Hallo Lea\nIch hatte mich vor einiger Zeit gemeldet 20 Oct 26, 10:00" },
        { kind: "theirs", text: `Ja gerne! ${"x".repeat(300)} 21 Oct 26, 18:12` },
      ],
      sentAt
    );
    expect(r?.date).toEqual(new Date(2026, 9, 21, 18, 12));
    expect(r?.text.startsWith("Ja gerne!")).toBe(true);
    expect(r?.text.length).toBe(200);
  });
  it("keine Antwort, und alte Antworten vor dem Nachfassen zaehlen nicht", () => {
    expect(findReply([{ kind: "mine", text: "Ich hatte mich vor einiger Zeit … 20 Oct 26, 10:00" }], sentAt)).toBeNull();
    expect(findReply([{ kind: "theirs", text: "Danke 2 Oct 26, 10:00" }, { kind: "mine", text: "Eigener Text 20 Oct 26, 10:00" }], sentAt)).toBeNull();
    expect(findReply([{ kind: "mine", text: "Eigener Text 20 Oct 26, 10:00" }, { kind: "theirs", text: "Ja 20 Oct 26, 11:00" }], sentAt)?.text).toBe("Ja");
  });

  it("Kurs-Uebersicht mit Ampel", () => {
    const c = course({ id: "k", deadline: "2026-11-05", minParticipants: 3 });
    const log = (markierung: string, geantwortet = "ja"): Partial<LogRow> => ({ kurs: "k", geantwortet, markierung });
    const s = courseStats(c, [log("Zusage"), log("Absage"), log("", "nein"), log("", "nein"), { kurs: "anderer", markierung: "Zusage" }], NOW);
    expect(s).toEqual({ angeschrieben: 4, geantwortet: 2, zusagen: 1, quote: 0.5, tageBisSchluss: 10, ampel: "gelb" });
    expect(courseStats(c, [], NOW).ampel).toBe("rot");
    expect(courseStats(c, [log("Zusage"), log("Zusage"), log("Zusage")], NOW).ampel).toBe("gruen");
  });
});

describe("Einstellungen", () => {
  it("Standard: Mathe und Physik, N = 20; altes Format wird ersetzt", () => {
    expect(mergeSettings(null)).toEqual({ mySubjects: ["Mathe", "Physik"], recommendMin: 20, listingOnDemand: false });
    expect(mergeSettings({ gymi: { enabled: true } } as never)).toEqual({ mySubjects: ["Mathe", "Physik"], recommendMin: 20, listingOnDemand: false });
    expect(mergeSettings({ mySubjects: ["Chemie"], recommendMin: 5 })).toEqual({ mySubjects: ["Chemie"], recommendMin: 5, listingOnDemand: false });
  });
});

it("CSV Rundreise mit Zeilenumbruechen und Semikolons", () => {
  const rows = [{ a: "x;y", b: 'er sagte "Ja"\nneue Zeile' }, { a: "", b: "z" }];
  expect(parseCsv(toCsv(rows, ["a", "b"]))).toEqual(rows);
  expect(parseCsv("")).toEqual([]);
});

describe("Inserat nur bei Bedarf", () => {
  const info = (p: Partial<ListingInfo>): ListingInfo => ({ title: "", fach: "", schulstufe: "", description: "", ...p });
  const need = (i: ListingInfo) => needsListing(analyzeListing(i), i);

  it("Konversationsseite mit Fach, Stufe und Jahr reicht", () => {
    expect(need(info({ fach: "Mathematik", schulstufe: "Gymnasium", description: "Nachhilfe Mathematik 3. Gymi" }))).toBeNull();
  });
  it("Stufe unklar, kein Fach oder Sicherheit nicht hoch → Inserat öffnen", () => {
    expect(need(info({ description: "Prüfungsvorbereitung, Hausaufgaben\n8057 Zürich" }))).toBe("Stufe unklar");
    expect(need(info({ schulstufe: "Gymnasium", description: "2. Gymi" }))).toBe("kein Fach");
    expect(need(info({ fach: "Mathematik", schulstufe: "Sekundarschule" }))).toBe("Sicherheit tief");
    expect(need(info({ fach: "Mathematik", schulstufe: "Gymnasium", description: "Probezeit" }))).toBe("Sicherheit mittel");
  });
  it("Widerspruch zwischen Schulstufen-Feld und Text → Inserat öffnen", () => {
    expect(need(info({ fach: "Mathematik", schulstufe: "Berufsmaturität", description: "2. Sek" }))).toBe("Widerspruch bm/sek");
  });
  it("listingFromConversation liest beschriftete Felder und PLZ-Ort, Rest ist Freitext", () => {
    const l = listingFromConversation("Nachhilfe Mathe\nFach\nMathematik\nSchulstufe\nGymnasium\n8057 Zürich");
    expect(l).toMatchObject({ fach: "Mathematik", schulstufe: "Gymnasium", ort: "8057 Zürich" });
    expect(listingFromConversation("Prüfungsvorbereitung, Hausaufgaben\n8057 Zürich")).toMatchObject({ fach: "", schulstufe: "" });
  });
  it("compareAnalyses listet nur abweichende Felder", () => {
    const a = analyzeListing(info({ fach: "Mathematik", schulstufe: "Gymnasium", description: "2. Gymi" }));
    const b = analyzeListing(info({ fach: "Mathematik", schulstufe: "Gymnasium", description: "4. Gymi, ich suche Hilfe" }));
    expect(compareAnalyses(a, a)).toEqual([]);
    expect(compareAnalyses(a, b).map((d) => d.feld)).toEqual(["klasse", "gymi_jahr", "kursgruppe", "anrede"]);
  });
});

describe("Konversationsliste", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  const e = (id: string, p: Partial<ListEntry> = {}): ListEntry => ({
    id, name: id, date: "2026-10-20T00:00:00.000Z", lastSender: "ich", unread: 0, sig: "s", link: "", ...p,
  });

  it("listSender: nur mit positivem Beleg", () => {
    expect(listSender("Leider ist Mia nicht an Ihrer Bewerbung interessiert. Wir wünschen …", 1)).toBe("system");
    expect(listSender("Hallo Omid, gerne eine Probelektion", 1)).toBe("gegenseite");
    expect(listSender("Hallo zusammen, gerne unterstütze ich dich in Mathematik …", 0)).toBe("ich");
    expect(listSender("Hallo Lea, Ich hatte mich vor einiger Zeit bei Ihnen gemeldet …", 0)).toBe("ich");
    // Bereits gelesene Antwort ohne meinen Wortlaut: nicht sicher → unbekannt (wird geoeffnet)
    expect(listSender("Hallo Omid, danke, wir haben schon jemanden", 0)).toBe("unbekannt");
  });

  it("entryChanged: Datum, letzter Absender oder Ausschnitt", () => {
    expect(entryChanged(undefined, e("1"))).toBe(true);
    expect(entryChanged(e("1"), e("1"))).toBe(false);
    expect(entryChanged(e("1"), e("1", { date: "2026-10-25T00:00:00.000Z" }))).toBe(true);
    expect(entryChanged(e("1"), e("1", { lastSender: "unbekannt" }))).toBe(true);
    expect(entryChanged(e("1"), e("1", { sig: snippetSig("neu") }))).toBe(true);
    // Ungelesen-Zaehler allein (z.B. nach dem Oeffnen) ist keine neue Aktivitaet
    expect(entryChanged(e("1"), e("1", { unread: 2 }))).toBe(false);
  });

  it("scrollStop: Ende, Alter, unveränderter Block", () => {
    const cache = { a: e("a"), b: e("b") };
    expect(scrollStop([], cache, now)).toBe("Ende der Liste");
    expect(scrollStop([e("x", { date: "2026-08-01T00:00:00.000Z" })], {}, now, 57)).toBe("älter als 57 Tage");
    expect(scrollStop([e("a"), e("b")], cache, now)).toBe("Rest unverändert im Zwischenspeicher");
    // ein neuer oder geaenderter Eintrag im Block: weiterscrollen
    expect(scrollStop([e("a"), e("c")], cache, now)).toBeNull();
    expect(scrollStop([e("a", { sig: "neu" }), e("b")], cache, now)).toBeNull();
    // leerer Zwischenspeicher (erster Lauf): ganz laden
    expect(scrollStop([e("a"), e("b")], {}, now, 57)).toBeNull();
  });

  it("Antwort-Erkennung aus der Liste", () => {
    expect(hasNewActivity(e("1"))).toBe(false);
    expect(hasNewActivity(e("1", { unread: 1 }))).toBe(true);
    expect(hasNewActivity(e("1", { lastSender: "gegenseite" }))).toBe(true);
    expect(hasNewActivity(e("1", { lastSender: "unbekannt" }))).toBe(true);
    expect(hasNewActivity(e("1", { lastSender: "system" }))).toBe(true);
    // nicht in der Liste gefunden: lieber oeffnen
    expect(hasNewActivity(undefined)).toBe(true);
  });

  it("listSkipReason im Probelauf: nur Absage und Ungelesenes", () => {
    expect(listSkipReason(e("1", { lastSender: "system" }))).toBe("abgelehnt");
    expect(listSkipReason(e("1", { lastSender: "gegenseite" }))).toBe("ungelesene_nachricht");
    expect(listSkipReason(e("1"))).toBeNull();
    expect(listSkipReason(e("1", { lastSender: "unbekannt" }))).toBeNull();
  });
});
