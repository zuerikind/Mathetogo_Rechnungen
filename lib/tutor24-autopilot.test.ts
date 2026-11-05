import { describe, expect, it } from "vitest";
import { autoEligible, daySummary, errorKey, firstName, inSendWindow, isBusy, isHardStop, stopReason, type PassLog } from "./tutor24-autopilot";
import { mergeSettings } from "./tutor24-followup";

describe("Automatik", () => {
  it("Sendefenster 8:00–19:59", () => {
    expect(inSendWindow(new Date(2026, 10, 5, 7, 59))).toBe(false);
    expect(inSendWindow(new Date(2026, 10, 5, 8, 0))).toBe(true);
    expect(inSendWindow(new Date(2026, 10, 5, 19, 59))).toBe(true);
    expect(inSendWindow(new Date(2026, 10, 5, 20, 0))).toBe(false);
  });

  it("Stopp: mehr als 3 Pruef-Fehler, harte Fehler sofort, gleicher Fehler zweimal", () => {
    const none = { pruefungFehler: 0, fehler: null, letzterFehler: null };
    expect(stopReason(none)).toBeNull();
    expect(stopReason({ ...none, pruefungFehler: 3 })).toBeNull();
    expect(stopReason({ ...none, pruefungFehler: 4 })).toMatch(/4 Nachrichten/);
    // Captcha, Sicherheitsabfrage, Login-Umleitung, Sperre des Kontos: beim ersten Mal
    for (const f of [
      "Captcha auf der Seite (Inserat 123): https://…",
      "Login-Problem: auf Anmeldeseite umgeleitet (Liste sent).",
      "Captcha/Prüfung erkannt (Liste sent): https://www.tutor24.ch/challenge",
      "Fehlermeldung «Zu viele Anfragen» auf der Seite",
      "Ihr Konto wurde vorübergehend gesperrt.",
    ])
      expect(stopReason({ ...none, fehler: f }), f).toMatch(/^tutor24:/);
    // Gewoehnlicher Fehler: erst beim zweiten Mal (Zahlen duerfen sich unterscheiden)
    const e1 = "Unerwarteter Seitenaufbau: keine Nachrichten-Blasen in Konversation 33216495.";
    const e2 = "Unerwarteter Seitenaufbau: keine Nachrichten-Blasen in Konversation 40000001.";
    expect(stopReason({ ...none, fehler: e1 })).toBeNull();
    expect(stopReason({ ...none, fehler: e2, letzterFehler: errorKey(e1) })).toMatch(/zweimal/);
  });

  it("eigene Sperre (anderer Lauf aktiv) ist kein Fehler und kein harter Stopp", () => {
    const busy = "tutor24 ist gesperrt: „Nachfassen (Senden)“ läuft seit 2026-11-05T10:00:00Z (PID 4711). Bitte warten, bis dieser Lauf fertig ist.";
    expect(isBusy(busy)).toBe(true);
    expect(isHardStop(busy)).toBe(false);
    expect(stopReason({ pruefungFehler: 0, fehler: busy, letzterFehler: errorKey(busy) })).toBeNull();
  });

  it("automatisch nachgefasst wird nur sicher und mit Kurs", () => {
    const c = { id: "m1" };
    expect(autoEligible({ sicherheit: "hoch", kind: "angebot", course: c })).toBe(true);
    expect(autoEligible({ sicherheit: "hoch", kind: "erinnerung", course: c })).toBe(true);
    expect(autoEligible({ sicherheit: "mittel", kind: "angebot", course: c })).toBe(false);
    expect(autoEligible({ sicherheit: "hoch", kind: "frage", course: c })).toBe(false);
    expect(autoEligible({ sicherheit: "hoch", kind: "einfach", course: null })).toBe(false);
  });

  it("Meldungen nur mit Vorname", () => {
    expect(firstName("Luana Muster")).toBe("Luana");
    expect(firstName("  ")).toBe("(ohne Name)");
  });

  it("Einstellungen: Standard 20 / 15 / 4 Tage, nie unter 3 Tage, Nachfassen nie ueber 25", () => {
    const s = mergeSettings(null);
    expect([s.autoErstLimit, s.autoNachfassLimit, s.nachfassNachTagen]).toEqual([20, 15, 4]);
    expect(mergeSettings({ nachfassNachTagen: 1, autoNachfassLimit: 99, autoErstLimit: 0 })).toMatchObject({ nachfassNachTagen: 3, autoNachfassLimit: 25, autoErstLimit: 0 });
  });

  it("Tages-Zusammenfassung zaehlt nur Durchgaenge des Tages (Ortszeit)", () => {
    const p = (start: Date, gesendet: number): PassLog => ({
      start: start.toISOString(), ende: start.toISOString(), modus: "an",
      erst: { gesendet, wuerde: 0, uebersprungen: 0, pruefungFehler: 0 }, nachfassen: { gesendet: 1, wuerde: 0, uebersprungen: 0, pruefungFehler: 0 },
      antworten: 1, fehler: [], stopp: null,
    });
    const text = daySummary("2026-11-05", [p(new Date(2026, 10, 4, 18), 9), p(new Date(2026, 10, 5, 9), 2), p(new Date(2026, 10, 5, 13), 3)]);
    expect(text).toContain("2 Durchgänge");
    expect(text).toContain("Erst-Nachrichten: 5 gesendet");
    expect(text).toContain("Nachfassen: 2 gesendet");
  });
});
