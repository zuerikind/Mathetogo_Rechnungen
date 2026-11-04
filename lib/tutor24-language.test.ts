import { describe, expect, it } from "vitest";
import { detectLanguageFromText, resolveTargetLanguage } from "./tutor24-messaging";

const URL_DE = "https://www.tutor24.ch/de/jobs/1";
const lang = (title: string, body: string) => resolveTargetLanguage(URL_DE, "de", title, body).language;

describe("Spracherkennung: nur de, en, fr — im Zweifel Deutsch", () => {
  it("Italienisch wird nicht Franzoesisch, sondern Deutsch", () => {
    expect(
      lang(
        "Ripetizioni di matematica NMG cercate",
        "Ci piacerebbe trovare un tutor per le ripetizioni di matematica NMG per nostro figlio alla scuola media. Viviamo a Buttisholz e cerchiamo qualcuno."
      )
    ).toBe("de");
    expect(lang("Tutor cercasi", "Wettingen. Ripetizioni di matematica, NMG e tedesco per la scuola media. Lezioni individuali a casa dello studente.")).toBe("de");
  });

  it("deutsches Inserat mit einzelnen englischen Woertern bleibt Deutsch", () => {
    expect(lang("Lieber Tutor, wir brauchen Sie!", "Math Nachhilfe für ein 5.Klässler.Aktuelles üben, auf Test vorbereiten.")).toBe("de");
    expect(lang("Math Coach gesucht", "Online Tutor für Mathe, Gymi")).toBe("de");
  });

  it("klar Englisch", () => {
    expect(
      lang(
        "Tutor needed in maths for Y3 Gymi student",
        "We live in Meilen and are looking for a tutor who could help my 18 year old son improve his math grades. He is at MNG gymnasium in Y3."
      )
    ).toBe("en");
  });

  it("klar Franzoesisch", () => {
    expect(
      lang(
        "Cours particuliers recherchés",
        "Notre enfant à Delémont a besoin de cours particuliers en mathématiques, français, anglais et allemand. Les cours sont individuels et se déroulent à domicile."
      )
    ).toBe("fr");
  });

  it("ohne Text entscheidet die URL", () => {
    expect(detectLanguageFromText("", "")).toBeNull();
    expect(resolveTargetLanguage("https://www.tutor24.ch/fr/jobs/1", "de", "", "").language).toBe("fr");
  });
});
