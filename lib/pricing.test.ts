import { describe, expect, it } from "vitest";
import { classPriceFromRate, typicalLessonMinutes } from "./pricing";

/**
 * "CHF pro Lektion" war in der Schuelertabelle keine Aussage, sondern eine
 * Schaetzung: 60 Minuten fuer eine Namensliste, sonst 50. In derselben Spalte
 * stand damit mal ein Stundenpreis und mal der Preis einer 50-Minuten-Lektion.
 * Diese Tests halten fest, dass die Dauer aus den Lektionen kommt.
 */
describe("typicalLessonMinutes", () => {
  const lektion = (durationMin: number, date: string) => ({ durationMin, date });

  it("ohne Lektionen gibt es keine Dauer — und keine erfundene Zahl", () => {
    expect(typicalLessonMinutes([])).toBeNull();
  });

  it("nimmt die haeufigste Dauer, nicht die erstbeste", () => {
    expect(
      typicalLessonMinutes([
        lektion(90, "2026-01-05"),
        lektion(50, "2026-01-12"),
        lektion(50, "2026-01-19"),
      ])
    ).toBe(50);
  });

  it("bei Gleichstand gewinnt die zuletzt unterrichtete Dauer", () => {
    // Wechsel von 50 auf 60 Minuten: der alte Stand darf nicht haengenbleiben.
    expect(
      typicalLessonMinutes([
        lektion(50, "2026-01-05"),
        lektion(60, "2026-03-09"),
      ])
    ).toBe(60);
  });

  it("ignoriert unbrauchbare Dauern statt an ihnen zu scheitern", () => {
    expect(
      typicalLessonMinutes([
        lektion(0, "2026-01-05"),
        lektion(Number.NaN, "2026-01-06"),
        lektion(45, "2026-01-07"),
      ])
    ).toBe(45);
  });

  it("der Schueler mit 60-Minuten-Bloecken bekommt seine echte Stunde", () => {
    const sessions = [lektion(60, "2026-02-02"), lektion(60, "2026-02-09")];
    const dauer = typicalLessonMinutes(sessions);
    expect(dauer).toBe(60);
    // 1.20 CHF/Min · 60 Min — eine ganze Stunde, und die Tabelle sagt das dazu.
    expect(classPriceFromRate(1.2, dauer as number)).toBe(72);
  });
});
