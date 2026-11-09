import { describe, expect, it } from "vitest";
import { addresseeFor, sendBlock, wahlOf, type Batch } from "./tutor24-batch";

const batch = (over: Partial<Batch> = {}): Batch => ({
  zustand: "bereit", pid: 1, gestartet: "", vorbereitetBis: "2026-11-09T12:00:00.000Z", fehler: null, log: [],
  items: [{ id: "1", art: "erst", titel: "", stufe: "", ort: "", link: "", sprache: "de", anrede: "du", block: "ohne", kursId: null, hint: null, satz: "ki", text: "x", problem: null, ausgewaehlt: true }],
  ...over,
});
const at = (hhmm: string) => new Date(`2026-11-09T${hhmm}:00.000Z`);

describe("Batch: Senden direkt nach dem Vorbereiten", () => {
  it("gleicher Lauf, innert 60 min: erlaubt trotz Mindestabstand", () => {
    expect(sendBlock(batch(), at("12:30"), at("12:00"), at("14:00"))).toBeNull();
  });
  it("nach 60 min oder nach einem anderen Lauf: Mindestabstand gilt", () => {
    expect(sendBlock(batch(), at("13:05"), at("12:00"), at("14:00"))).toMatch(/neu vorbereiten/);
    expect(sendBlock(batch(), at("12:30"), at("12:20"), at("14:20"))).toMatch(/anderer Lauf/);
  });
  it("Abstand erreicht: immer erlaubt; nichts ausgewaehlt / fehlerhaft / schon gesendet: nicht", () => {
    expect(sendBlock(batch(), at("16:00"), at("12:00"), null)).toBeNull();
    const b = batch();
    b.items[0].problem = "Satz endet ohne Punkt";
    expect(sendBlock(b, at("12:10"), at("12:00"), null)).toMatch(/Nichts ausgewählt/);
    b.items[0].problem = null;
    b.items[0].ergebnis = "gesendet";
    expect(sendBlock(b, at("12:10"), at("12:00"), null)).toMatch(/Nichts ausgewählt/);
    expect(sendBlock(batch({ zustand: "fertig" }), at("12:10"), at("12:00"), null)).toMatch(/Kein vorbereiteter/);
  });
  it("Anrede-Wahl hin und zurueck", () => {
    for (const w of ["du", "Tochter", "Sohn", "Kind", "unklar"] as const) expect(wahlOf(addresseeFor(w))).toBe(w);
  });
});
