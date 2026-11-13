import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMarkiert } from "./tutor24-batch";
import {
  MAX_PRO_TAG,
  heuteGestellt,
  anredeSetzen,
  freigeben,
  freigegebene,
  loadRueckfragen,
  parseRueckfrageKnopf,
  persoenlicherTeil,
  rueckfrageAnlegen,
  rueckfrageArt,
  rueckfrageKnoepfe,
  rueckfrageText,
  sendeLaufFaellig,
  tagesStand,
  ueberspringen,
  unsicherGruende,
  verfallenLassen,
  type Rueckfrage,
  type SicherInput,
} from "./tutor24-rueckfragen";

const AUS = { sicherUnklar: true, sicherKi: false, sicherEn: false };
const base: SicherInput = { sprache: "de", wer: "eltern", satz: "fest", problem: null, agentur: null, nebenfach: null };

describe("Sicher oder Rueckfrage (Omid, 11.11.)", () => {
  it("fester Text, Anrede erkannt, Deutsch, keine Markierung, Pruefung ok = sicher", () => {
    expect(unsicherGruende(base, AUS)).toEqual([]);
    expect(unsicherGruende({ ...base, wer: "schueler" }, AUS)).toEqual([]);
  });
  it("Anrede unklar: sicher nur mit neutralem festem Text und Schalter EIN", () => {
    expect(unsicherGruende({ ...base, wer: "unklar" }, AUS)).toEqual([]);
    expect(unsicherGruende({ ...base, wer: "unklar" }, { ...AUS, sicherUnklar: false })).toEqual(["Anrede unklar"]);
    expect(unsicherGruende({ ...base, wer: "unklar", satz: "ki" }, { ...AUS, sicherKi: true })).toEqual(["Anrede unklar"]);
  });
  it("KI-Satz, Englisch: Rueckfrage, ausser der Schalter ist an; Franzoesisch immer", () => {
    expect(unsicherGruende({ ...base, satz: "ki" }, AUS)).toEqual(["KI-Satz"]);
    expect(unsicherGruende({ ...base, satz: "ki" }, { ...AUS, sicherKi: true })).toEqual([]);
    expect(unsicherGruende({ ...base, sprache: "en" }, AUS)).toEqual(["Englisch"]);
    expect(unsicherGruende({ ...base, sprache: "en" }, { ...AUS, sicherEn: true })).toEqual([]);
    expect(unsicherGruende({ ...base, sprache: "fr" }, { sicherUnklar: true, sicherKi: true, sicherEn: true })).toEqual(["Französisch"]);
  });
  it("Markierung, Pruefung, Stufe, Ersatzsatz: immer Rueckfrage, alle Gruende genannt", () => {
    expect(unsicherGruende({ ...base, agentur: "Text wirbt Lehrpersonen an", satz: "ohne" }, AUS)).toEqual(["Möglicherweise Agentur: Text wirbt Lehrpersonen an", "Stufe nicht erkannt"]);
    expect(unsicherGruende({ ...base, nebenfach: "Schwerpunkt Deutsch" }, AUS)[0]).toMatch(/Nebenfach/);
    expect(unsicherGruende({ ...base, problem: "zu lang" }, AUS)).toEqual(["Prüfung nicht bestanden: zu lang"]);
    expect(unsicherGruende({ ...base, satz: "fallback" }, AUS)).toEqual(["Ersatzsatz (alte Regel)"]);
  });
  it("Art fuer den Zaehler: ki vor en vor unklar; Markierung/Pruefung zaehlt nicht", () => {
    expect(rueckfrageArt({ ...base, satz: "ki", sprache: "en" })).toBe("ki");
    expect(rueckfrageArt({ ...base, sprache: "en", wer: "unklar" })).toBe("en");
    expect(rueckfrageArt({ ...base, wer: "unklar" })).toBe("unklar");
    expect(rueckfrageArt({ ...base, satz: "ki", agentur: "x" })).toBe("andere");
  });
});

const TEXT = "Guten Tag,\n\ngerne biete ich Nachhilfe an.\n\nIn der Sek kommt der Stoff schnell. Darum schaue ich zuerst, wo es hakt.\n\nWeitere Infos.\n\nFreundliche Grüsse\nOmid";
const mk = (id: string, o: Partial<Rueckfrage> = {}): Omit<Rueckfrage, "tag" | "erstelltAm" | "status"> => ({
  id, titel: `Inserat ${id}`, stufe: "Sekundarstufe", link: `https://tutor24.ch/de/jobs/${id}`, sprache: "de", anrede: "unklar", grund: "Anrede unklar", art: "unklar",
  text: TEXT, kursId: null, hint: null, satz: "fest", info: { title: `Inserat ${id}`, fach: "Mathematik", schulstufe: "Sekundarstufe", description: "…", ort: "" }, ...o,
});
const tmp = () => mkdtempSync(join(tmpdir(), "rf-"));
const T = (h: number, d = 11) => new Date(Date.UTC(2026, 10, d, h - 1, 0)); // Zuerich = UTC+1 im November

describe("Rueckfragen stellen, Knoepfe, Verfall", () => {
  it("hoechstens 5 am Tag, danach Liste; nach 20 Uhr direkt Liste; nie doppelt", () => {
    const dir = tmp();
    const p = join(dir, "rf.json");
    const mp = join(dir, "markiert.json");
    for (let i = 1; i <= MAX_PRO_TAG; i++) expect(rueckfrageAnlegen(mk(String(i)), T(11), p, mp)).toBe("gestellt");
    expect(rueckfrageAnlegen(mk("1"), T(11), p, mp)).toBe("schon");
    expect(loadRueckfragen(p).items).toHaveLength(MAX_PRO_TAG);
    expect(rueckfrageAnlegen(mk("99"), T(12), p, mp)).toBe("liste");
    expect(rueckfrageAnlegen(mk("100"), T(21, 12), p, mp)).toBe("liste");
    expect(rueckfrageAnlegen(mk("101"), T(9, 12), p, mp)).toBe("gestellt");
    expect(loadMarkiert(mp).map((m) => `${m.id} ${m.grund}`)).toEqual([`99 Anrede unklar (ohne Rückfrage: ${MAX_PRO_TAG} am Tag erreicht)`, "100 Anrede unklar (ohne Rückfrage: nach 20 Uhr)"]);
  });
  it("Meldung: Grund, Titel, Stufe, Link, Text; Knoepfe du/Sie nur bei Deutsch; Knopfdaten streng", () => {
    const r = { ...mk("77"), tag: "2026-11-11", erstelltAm: "", status: "offen" as const };
    const t = rueckfrageText(r, 2);
    expect(t).toMatch(/^🟠 ENTSCHEIDUNG NÖTIG: Diese Erst-Nachricht senden oder überspringen\?\n❓ Rückfrage 2\/10 · Anrede unklar\nInserat 77 · Stufe: Sekundarstufe · Anrede: Sie \(neutral\)\nhttps:\/\/tutor24.ch\/de\/jobs\/77\n\nGuten Tag,/);
    expect(rueckfrageKnoepfe(r).inline_keyboard).toHaveLength(2);
    expect(rueckfrageKnoepfe({ ...r, sprache: "en" }).inline_keyboard).toHaveLength(1);
    expect(parseRueckfrageKnopf("rf:send:77")).toEqual({ aktion: "send", id: "77" });
    expect(parseRueckfrageKnopf("rf:sie:77")).toEqual({ aktion: "sie", id: "77" });
    expect(parseRueckfrageKnopf("rf:send:77; rm")).toBeNull();
    expect(parseRueckfrageKnopf("start")).toBeNull();
    expect(persoenlicherTeil(TEXT)).toBe("In der Sek kommt der Stoff schnell. Darum schaue ich zuerst, wo es hakt.");
  });
  it("Senden zaehlt in Folge (unklar nur ohne Anrede-Wechsel); Ueberspringen setzt auf 0 und schreibt die Liste", () => {
    const dir = tmp();
    const p = join(dir, "rf.json");
    const md = join(dir, "ki.md");
    writeFileSync(md, "# Liste\n");
    rueckfrageAnlegen(mk("1"), T(11), p);
    rueckfrageAnlegen(mk("2"), T(11), p);
    rueckfrageAnlegen(mk("3", { art: "ki", grund: "KI-Satz" }), T(11), p);
    expect(freigeben("1", T(12), p)?.status).toBe("freigegeben");
    anredeSetzen("2", "du", TEXT.replace("gerne biete ich", "gerne unterstütze ich dich"), p);
    expect(freigeben("2", T(12), p)?.anrede).toBe("du");
    expect(loadRueckfragen(p).folge).toEqual({ ki: 0, en: 0, unklar: 1 });
    expect(freigeben("3", T(12), p)?.status).toBe("freigegeben");
    expect(loadRueckfragen(p).folge.ki).toBe(1);
    expect(freigegebene(p)).toHaveLength(3);
    expect(sendeLaufFaellig(T(12), p)).toBe(false);
    expect(sendeLaufFaellig(new Date(T(12).getTime() + 10 * 60_000), p)).toBe(true);
    rueckfrageAnlegen(mk("4", { art: "ki", grund: "KI-Satz" }), T(13), p);
    expect(ueberspringen("4", T(13), p, md)?.status).toBe("uebersprungen");
    expect(loadRueckfragen(p).folge.ki).toBe(0);
    expect(readFileSync(md, "utf8")).toMatch(/Übersprungen per Telegram.*\n- Inserat: https:\/\/tutor24.ch\/de\/jobs\/4 .*\n- Rückfrage wegen: KI-Satz\n- Persönlicher Teil: In der Sek/);
    expect(freigeben("99", T(12), p)).toBeNull();
    const st = tagesStand("2026-11-11", p);
    expect([st.freigegeben, st.uebersprungen]).toEqual([3, 1]);
  });
  it("Verfall: offene von heute ab 20 Uhr und alle von gestern; freigegebene bleiben", () => {
    const dir = tmp();
    const p = join(dir, "rf.json");
    const mp = join(dir, "markiert.json");
    rueckfrageAnlegen(mk("1"), T(11), p, mp);
    rueckfrageAnlegen(mk("2"), T(11), p, mp);
    freigeben("2", T(12), p);
    expect(verfallenLassen(T(19), p, mp)).toHaveLength(0);
    const v = verfallenLassen(T(20), p, mp);
    expect(v.map((r) => r.id)).toEqual(["1"]);
    expect(loadRueckfragen(p).items.map((r) => r.status)).toEqual(["verfallen", "freigegeben"]);
    rueckfrageAnlegen(mk("3"), T(9, 12), p, mp);
    expect(verfallenLassen(T(8, 13), p, mp).map((r) => r.id)).toEqual(["3"]);
    expect(loadMarkiert(mp).map((m) => m.id)).toEqual(["1", "3"]);
    expect(loadMarkiert(mp)[0].grund).toBe("Rückfrage unbeantwortet: Anrede unklar");
  });
});

describe("Probe-Rueckfragen (11.11.): Knoepfe ausprobieren, nichts zaehlt", () => {
  it("zaehlen nicht zum Tageslimit, nie in Liste/Freigaben/Zaehler/ki_verbesserungen", () => {
    const dir = tmp();
    const p = join(dir, "rf.json");
    const mp = join(dir, "markiert.json");
    const md = join(dir, "ki.md");
    writeFileSync(md, "# Liste\n");
    for (let i = 1; i <= MAX_PRO_TAG; i++) rueckfrageAnlegen(mk(String(i)), T(11), p, mp);
    expect(rueckfrageAnlegen({ ...mk("50"), probe: true }, T(11), p, mp)).toBe("gestellt");
    expect(rueckfrageAnlegen({ ...mk("51"), probe: true }, T(21), p, mp)).toBe("gestellt"); // auch nach 20 Uhr
    expect(heuteGestellt(loadRueckfragen(p), "2026-11-11")).toBe(MAX_PRO_TAG);
    expect(rueckfrageAnlegen({ ...mk("1"), probe: true }, T(11), p, mp)).toBe("schon"); // echte geht vor
    expect(rueckfrageText({ ...mk("50"), probe: true, tag: "", erstelltAm: "", status: "offen" }, 1, 1)).toMatch(/^🧪 PROBE · 🟠 ENTSCHEIDUNG NÖTIG.*\n❓ Rückfrage 1\/1/);
    freigeben("50", T(12), p);
    expect(freigegebene(p)).toHaveLength(0);
    expect(sendeLaufFaellig(T(13), p)).toBe(false);
    rueckfrageAnlegen({ ...mk("52", { art: "ki" }), probe: true }, T(11), p, mp);
    ueberspringen("52", T(12), p, md);
    expect(readFileSync(md, "utf8")).toBe("# Liste\n");
    expect(loadRueckfragen(p).folge).toEqual({ ki: 0, en: 0, unklar: 0 });
    verfallenLassen(T(8, 12), p, mp);
    expect(loadMarkiert(mp).some((m) => ["50", "51", "52"].includes(m.id))).toBe(false);
    expect(tagesStand("2026-11-11", p).freigegeben).toBe(0);
  });

  it("nur Probe offen: verfällt trotzdem und wird gespeichert (Gesamttest 12.11.)", () => {
    const dir = tmp();
    const p = join(dir, "rf.json");
    const mp = join(dir, "markiert.json");
    rueckfrageAnlegen({ ...mk("60"), probe: true }, T(11), p, mp);
    expect(verfallenLassen(T(20), p, mp)).toHaveLength(0);
    expect(loadRueckfragen(p).items[0].status).toBe("verfallen");
  });
});
