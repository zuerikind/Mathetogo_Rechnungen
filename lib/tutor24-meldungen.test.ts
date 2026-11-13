import { describe, expect, it } from "vitest";
import { antwortText, emptyCounts, probeText, problemText } from "./tutor24-autopilot";

describe("Telegram-Meldungen (13.11.)", () => {
  it("PROBLEM: was passiert ist, was ich tun soll", () => {
    expect(problemText("Automatik gestoppt: 429.", "Nach der Pause /enable.")).toBe("⚠️ PROBLEM\nAutomatik gestoppt: 429.\n👉 Nach der Pause /enable.");
  });

  it("ANTWORT: Vorname, Stufe, Kurs, erster Satz der Antwort, Link", () => {
    const t = antwortText({ id: "33378679", name: "Victoria Muster", satz: "Ja gerne, das passt mir. Wann hätten Sie Zeit?" }, "BM", "Kurs-Hinweis");
    expect(t).toBe("💬 ANTWORT\nVictoria · Stufe BM · Kurs-Hinweis\n„Ja gerne, das passt mir.“\nhttps://www.tutor24.ch/de/conversations/33378679?tab=sent\nBekommt keine automatischen Nachrichten mehr.");
    expect(antwortText({ id: "1", name: "X", absage: true }, "", "ohne Kurs")).toContain("💬 ANTWORT (Absage)\nX · Stufe unbekannt · ohne Kurs\nhttps://");
  });

  it("PROBE: eine Meldung mit Zahlen, Agent und Link zu allen Texten", () => {
    const t = probeText(
      { start: "2026-11-13T15:00:00Z", erst: { ...emptyCounts(), wuerde: 12, hinweis: 12 }, nachfassen: { ...emptyCounts(), wuerde: 3 }, antworten: 1, fehler: [], stopp: null,
        agent: { ok: 14, auffaellig: 1, fehler: 0, gruende: ["Nachhilfe Sek: Grammatik"] }, notes: [] },
      "run1",
      "ohne Fehler"
    );
    expect(t.split("\n")[0]).toBe("🧪 PROBE 16:00: ohne Fehler");
    expect(t).toContain("Erst-Nachrichten: 12 würden gesendet (0 mit Kursblock, 12 mit Hinweis)");
    expect(t).toContain("Prüf-Agent: 14 ok, 1 auffällig\n• Nachhilfe Sek: Grammatik");
    expect(t).toContain("/kurse/texte?lauf=run1");
  });
});
