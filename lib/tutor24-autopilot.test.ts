import { describe, expect, it } from "vitest";
import { RATE_LIMIT_TEXT, autoEligible, daySummary, emptyCounts, errorKey, firstName, inSendWindow, isBusy, isHardStop, passView, stopReason, type PassLog } from "./tutor24-autopilot";
import { mergeSettings, newActivity, type ListEntry } from "./tutor24-followup";

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

  it("Antwort-Meldung aus der Liste: nur neue Aktivitaet, letzte Nachricht nicht von mir", () => {
    const e = (id: string, lastSender: ListEntry["lastSender"], sig = "a"): ListEntry => ({ id, name: "Luana", date: "2026-11-05", lastSender, unread: 0, sig, link: "" });
    const prev = { "1": e("1", "ich"), "2": e("2", "ich"), "3": e("3", "unbekannt", "x") };
    const now = [e("1", "gegenseite", "b"), e("2", "ich", "c"), e("3", "unbekannt", "x"), e("4", "gegenseite"), e("5", "system", "z")];
    // 1: Antwort; 2: ich habe geschrieben; 3: schon gemeldet, unveraendert; 4, 5: neu seit dem letzten Stand
    expect(newActivity(now, prev).map((x) => x.id)).toEqual(["1", "4", "5"]);
    // Erster Durchgang ohne Stand: nichts melden, nur merken
    expect(newActivity(now, {})).toEqual([]);
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

describe("Protokoll auf /kurse (passView)", () => {
  const base = { ende: "", erst: emptyCounts(), nachfassen: emptyCounts(), antworten: 0, fehler: [] as string[], stopp: null as string | null };
  it("Ergebnis in einem Satz, Probe mit 'würden gesendet'", () => {
    const v = passView({ ...base, start: "2026-11-06T21:51:00Z", modus: "probe", erst: { ...emptyCounts(), wuerde: 5 }, antworten: 1 });
    expect(v.satz).toBe("Ohne Fehler · Erst-Nachrichten 5, Nachfassen 0 (würden gesendet), 1 Antwort");
    expect(v).toMatchObject({ fehlerKurz: null, details: null, behoben: null });
  });
  it("behobene Fehler grau, neue bleiben offen", () => {
    const name = "[6294260] page.evaluate: ReferenceError: __name is not defined\n    at eval";
    const alt = passView({ ...base, start: "2026-11-06T20:43:00Z", modus: "probe", fehler: [name] });
    expect(alt).toMatchObject({ fehlerKurz: "Programmfehler beim Lesen der Inserate", behoben: "6.11." });
    expect(alt.details).toContain("__name");
    expect(passView({ ...base, start: "2026-11-08T08:00:00Z", modus: "probe", fehler: [name] }).behoben).toBeNull();
    const old429 = passView({ ...base, start: "2026-11-05T11:28:00Z", modus: "probe", stopp: "429 Too Many Requests" });
    expect(old429.behoben).toBe("5.11.");
    expect(old429.satz.startsWith("Gestoppt")).toBe(true);
    const new429 = passView({ ...base, start: "2026-11-09T08:00:00Z", modus: "an", stopp: "429 Too Many Requests" });
    expect(new429).toMatchObject({ behoben: null, fehlerKurz: RATE_LIMIT_TEXT });
  });
});
