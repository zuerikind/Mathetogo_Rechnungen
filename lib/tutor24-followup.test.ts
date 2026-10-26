import { describe, expect, it } from "vitest";
import {
  classifyListing,
  containsForbiddenContact,
  defaultSettings,
  detectAnrede,
  formatSaturdays,
  mergeSettings,
  OFFER_LEVELS,
  parseCsv,
  parseTutor24Date,
  renderMessage,
  toCsv,
  toDuForm,
  validateSettings,
  type ListingInfo,
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
      { schulstufe: "Berufsschule", description: "Ich mache eine Lehre als Informatiker mit BM und brauche Hilfe für die BMS-Mathe." },
      "bm",
    ],
    [
      "BM-Aufnahmeprüfung geht vor Gymi-Ziel",
      { schulstufe: "Sekundarstufe", description: "Vorbereitung auf die BM-Aufnahmeprüfung nach der 3. Sek." },
      "bm",
    ],
    [
      "Sek ohne Gymi-Ziel",
      { schulstufe: "Sekundarstufe", description: "Unser Kind in Zürich könnte ein bisschen Nachhilfe gut gebrauchen. Es geht um Mathematik auf Sekundarstufe." },
      "sek",
    ],
    [
      "Primar ohne Gymi-Ziel",
      { schulstufe: "Primarschule", description: "Nachhilfe für zwei 11-jährige Zwillingsjungen gesucht! Schulstufe: 4. Klasse Primarschule" },
      "ausgeschlossen",
    ],
    [
      "Universität",
      { schulstufe: "Universität", description: "Ich brauche Hilfe in Analysis I nach meiner Matura." },
      "ausgeschlossen",
    ],
    [
      "Erwachsenenbildung",
      { schulstufe: "Erwachsenenbildung", description: "Ich möchte meine Mathe-Kenntnisse auffrischen." },
      "ausgeschlossen",
    ],
    ["Kein Mathe", { fach: "Physik", schulstufe: "Gymnasium" }, "ausgeschlossen"],
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

describe("renderMessage", () => {
  const s = defaultSettings();

  it("fuellt Platzhalter aus den Einstellungen", () => {
    const r = renderMessage(s.gymi, "Michael", "Sie");
    expect(r.text.startsWith("Hallo Michael\n\nIch hatte mich vor einiger Zeit auf Ihre Anfrage")).toBe(true);
    expect(r.text).toContain("an 4 Samstagen (28.11., 5.12., 12.12. und 19.12.), jeweils 9:30–11:10 Uhr, online.");
    expect(r.text).toContain("CHF 45 pro Lektion statt CHF 89");
    expect(r.text.endsWith("Liebe Grüsse\nOmid")).toBe(true);
  });

  it("Text- und Datumsaenderungen wirken sofort", () => {
    const changed = { ...s.matura, pricePerLesson: 50, saturdays: ["2027-01-09", "2027-01-16", "2027-01-23", "2027-01-30"] as [string, string, string, string] };
    const r = renderMessage(changed, "Lea", "Sie");
    expect(r.text).toContain("(9.1., 16.1., 23.1. und 30.1.)");
    expect(r.text).toContain("CHF 50 pro Lektion");
    expect(renderMessage({ ...s.sek, template: "Hallo {vorname}, total CHF {total}" }, "Lea", "Sie").text).toBe("Hallo Lea, total CHF 360");
  });

  it("Stufen-Texte: Matura ohne BM, BM mit Kuerzel, Gymi-Vorbereitung mit Pruefungsaufgaben", () => {
    expect(renderMessage(s.matura, "", "Sie").text).toContain("Vorbereitung auf die Matura. Maximal");
    expect(renderMessage(s.bm, "", "Sie").text).toContain("Vorbereitung auf die Berufsmatura (BM).");
    expect(renderMessage(s.gymivorbereitung, "", "Sie").text).toContain("typische Prüfungsaufgaben");
  });

  it("ohne Vorname nur Hallo", () => {
    expect(renderMessage(s.sek, "", "Sie").text.startsWith("Hallo\n\n")).toBe(true);
  });

  it("leitet die du-Form fuer alle Standardtexte ab", () => {
    for (const l of OFFER_LEVELS) {
      const r = renderMessage(s[l], "Lea", "du");
      expect(r.anrede).toBe("du");
      expect(r.text).not.toMatch(/\b(Sie|Ihr|Ihre)\b/);
      expect(r.text).toContain("deine Anfrage");
    }
  });

  it("faellt bei eigenem Text ohne Ableitung auf Sie zurueck", () => {
    expect(toDuForm("Haben Sie Zeit?").ok).toBe(false);
    const r = renderMessage({ ...s.sek, template: "Hallo {vorname}, haben Sie Zeit?" }, "Lea", "du");
    expect(r.anrede).toBe("Sie");
    expect(r.warning).toBeTruthy();
  });

  it("Standardtexte enthalten nie Kontaktangaben und kein ß", () => {
    for (const l of OFFER_LEVELS)
      for (const a of ["Sie", "du"] as const) {
        const t = renderMessage(s[l], "Lea", a).text;
        expect(containsForbiddenContact(t)).toBe(false);
        expect(t).not.toContain("ß");
      }
  });
});

describe("Einstellungen", () => {
  it("Standard: alle Stufen aus und gueltig", () => {
    const s = defaultSettings();
    expect(OFFER_LEVELS.every((l) => !s[l].enabled)).toBe(true);
    expect(validateSettings(s)).toEqual([]);
  });
  it("lehnt Links, Telefonnummern und unbekannte Platzhalter ab", () => {
    const s = defaultSettings();
    s.gymi.template += "\nwww.mathetogo.xyz";
    s.sek.template += "\n079 123 45 67";
    s.bm.template += "\n{name}";
    expect(validateSettings(s)).toHaveLength(3);
  });
  it("mergeSettings ergaenzt fehlende Felder", () => {
    const m = mergeSettings({ gymi: { enabled: true, pricePerLesson: 40 } });
    expect(m.gymi.enabled).toBe(true);
    expect(m.gymi.lessons).toBe(8);
    expect(m.matura.enabled).toBe(false);
  });
  it("formatSaturdays", () => {
    expect(formatSaturdays(["2026-11-28", "2026-12-05"])).toBe("28.11. und 5.12.");
  });
});

it("CSV Rundreise mit Zeilenumbruechen und Semikolons", () => {
  const rows = [{ a: "x;y", b: 'er sagte "Ja"\nneue Zeile' }, { a: "", b: "z" }];
  expect(parseCsv(toCsv(rows, ["a", "b"]))).toEqual(rows);
  expect(parseCsv("")).toEqual([]);
});
