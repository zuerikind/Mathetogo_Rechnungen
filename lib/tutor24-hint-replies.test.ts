import { describe, expect, it } from "vitest";
import { buildInterestList, isHintVariant, type LeadRow } from "./tutor24-leads";
import { PREVIEW_COLS, effectiveStatus, mergeSettings, newCourse, type PreviewRow } from "./tutor24-followup";

const NOW = new Date(2026, 10, 7);
const settings = mergeSettings({ newFirstMessage: true, kursHinweis: true });
const lead = (p: Partial<LeadRow>): LeadRow => ({
  id: "l1", name: "Lea", createdAt: new Date(2026, 10, 6), inseratId: "6290000", conversationId: "33000000", quelle: "erstnachricht",
  stufe: "Sekundarstufe", kategorie: "sek", kursgruppe: "sek2", sicherheit: "hoch", ausschluss: "", faecher: "Mathe", anlass: "",
  ort: "online", ortsname: "", wer: "schueler", anrede: "du", kind: null, sprache: "de", kursId: null, freigabeKursId: null,
  status: "offen", geantwortet: "", einzelunterricht: false, erstVariante: "ohne Kurs/du",
  ...p,
});

describe("Antworten auf den Kurs-Hinweis", () => {
  it("ganz oben, jede Stufe (Primar, FMS, Bachelor), nicht in den Gruppen", () => {
    const leads = [
      lead({ id: "a", erstVariante: "hinweis/du", geantwortet: "ja" }),
      lead({ id: "b", erstVariante: "hinweis/Sie", geantwortet: "ja", kategorie: "primar", stufe: "Primarschule" }),
      lead({ id: "c", erstVariante: "hinweis/du", geantwortet: "ja", kategorie: "ausgeschlossen", stufe: "FMS", ausschluss: "fms" }),
      lead({ id: "d", erstVariante: "hinweis/du", geantwortet: "ja", kategorie: "ausgeschlossen", stufe: "Universität", ausschluss: "bachelor" }),
      lead({ id: "e", erstVariante: "hinweis/du", geantwortet: "" }), // noch keine Antwort: normal in der Gruppe
      lead({ id: "f", erstVariante: "ohne Kurs/du", geantwortet: "ja" }), // geantwortet, aber ohne Hinweis
      lead({ id: "g", erstVariante: "hinweis/du", geantwortet: "ja", status: "Absage" }),
    ];
    const list = buildInterestList(leads, [], settings, [], NOW);
    expect(list.hinweisAntworten.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
    expect(list.hinweisAntworten[1]).toMatchObject({ stufe: "Primarschule", konversationUrl: "https://www.tutor24.ch/de/conversations/33000000?tab=sent" });
    const inGroups = list.groups.flatMap((g) => g.people.map((p) => p.id));
    expect(inGroups).not.toContain("a");
    expect(inGroups).toContain("e");
    expect(list.primar.length).toBe(0); // b zaehlt nicht doppelt als Primar-Nachfrage
  });

  it("keine automatischen Nachrichten mehr (Nachfassen gesperrt)", () => {
    const row = { ...Object.fromEntries(PREVIEW_COLS.map((c) => [c, ""])), status: "send", conversation_id: "33000000", kategorie: "sek", faecher: "Mathe", kursgruppe: "sek2", sicherheit: "hoch", ort: "online" } as PreviewRow;
    const sek = { ...newCourse("Mathe", "sek2", NOW), id: "s1", active: true, deadline: "2026-12-01" };
    const base = { quelle: "erstnachricht", status: "offen", wer: "schueler", kind: null, anrede: "du", sprache: "de", erstKursId: null, erstKursDaten: null, freigabeKursId: "s1", nachgefasst: false };
    expect(effectiveStatus(row, [sek], settings, new Set(), [], NOW, { ...base, erstHinweis: true, geantwortet: true })).toMatchObject({ send: false, label: "hat auf Kurs-Hinweis geantwortet" });
    expect(effectiveStatus(row, [sek], settings, new Set(), [], NOW, { ...base, erstHinweis: true, geantwortet: false }).label).not.toBe("hat auf Kurs-Hinweis geantwortet");
    expect(isHintVariant("hinweis/Sie")).toBe(true);
    expect(isHintVariant("ohne Kurs/du")).toBe(false);
  });
});
