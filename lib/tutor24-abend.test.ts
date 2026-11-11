import { describe, expect, it } from "vitest";
import { abendText } from "./tutor24-abend";
import { emptyCounts, type PassLog } from "./tutor24-autopilot";
import type { Course } from "./tutor24-followup";

const pass: PassLog = {
  start: "2026-11-11T09:00:00Z", ende: "2026-11-11T09:30:00Z", modus: "an",
  erst: { ...emptyCounts(), gesendet: 6, uebersprungen: 2 }, nachfassen: { ...emptyCounts(), gesendet: 1 }, antworten: 2, fehler: [], stopp: null,
};
const kurs: Course = {
  id: "k1", name: "Mathe-Vorbereitungskurs für die Matura", fach: "Mathe", gruppe: "matura", active: true,
  saturdays: ["2026-12-05", "2026-12-12", "2026-12-19", "2027-01-09"], time: "9:30–11:10 Uhr", pricePerLesson: 55, lessons: 8, mode: "online", place: "", deadline: "2026-11-28", minParticipants: 4, maxParticipants: 8,
};
const stand = { offen: 1, freigegeben: 2, gesendet: 3, uebersprungen: 1, verfallen: 0, fehler: 0, folge: { ki: 4, en: 0, unklar: 7 } };

describe("Abend-Zusammenfassung (11.11.)", () => {
  it("Durchgaenge, Rueckfragen und Stand der aktiven Kurse in einem Text", () => {
    const t = abendText("2026-11-11", [pass], stand, [kurs, { ...kurs, id: "k2", name: "inaktiv", active: false }], [], new Date("2026-11-11T19:00:00Z"));
    expect(t).toContain("Erst-Nachrichten: 6 gesendet");
    expect(t).toContain("Rückfragen: 3 gesendet, 1 übersprungen, 2 freigegeben (warten auf den nächsten Lauf), 1 offen, 0 verfallen");
    expect(t).toContain("• Mathe-Vorbereitungskurs für die Matura: 0 von 8 angemeldet (mind. 4), 0 angeschrieben, 0 geantwortet, Anmeldeschluss 28.11.");
    expect(t).not.toContain("inaktiv");
  });
});
