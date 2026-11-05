import { describe, expect, it } from "vitest";
import { newCourse, type Course } from "./tutor24-followup";
import { checkCourse, parseTimeRange, previewMessage } from "./tutor24-course-offer";

const NOW = new Date(2026, 10, 5);
const base = (p: Partial<Course> = {}): Course => ({
  ...newCourse("Mathe", "matura", NOW),
  id: "m1",
  active: true,
  saturdays: ["2026-11-28", "2026-12-05", "2026-12-12", "2026-12-19"],
  deadline: "2026-11-21",
  ...p,
});
const check = (c: Course, all: Course[] = [c]) => checkCourse(c, all, 89, NOW);
const fields = (c: Course, all?: Course[]) => check(c, all).errors.map((e) => e.field);

describe("Pruefung beim Speichern (/kurse)", () => {
  it("gueltiger Kurs: keine Fehler, keine Warnungen", () => {
    expect(check(base())).toEqual({ errors: [], warnings: [] });
  });

  it("Anmeldeschluss muss vor dem ersten Termin liegen", () => {
    expect(fields(base({ deadline: "2026-11-28" }))).toEqual(["deadline"]);
    expect(fields(base({ deadline: "2026-12-01" }))).toEqual(["deadline"]);
    expect(fields(base({ deadline: "" }))).toEqual(["deadline"]);
  });

  it("Termine in der richtigen Reihenfolge; Termin in der Vergangenheit nur Warnung", () => {
    expect(fields(base({ saturdays: ["2026-12-05", "2026-11-28", "2026-12-12", "2026-12-19"] }))).toContain("saturdays");
    expect(fields(base({ saturdays: ["2026-11-28", "2026-11-28", "2026-12-12", "2026-12-19"] }))).toContain("saturdays");
    expect(fields(base({ saturdays: ["2026-11-28", "", "2026-12-12", "2026-12-19"] }))).toContain("saturdays");
    const past = check(base({ saturdays: ["2026-11-01", "2026-12-05", "2026-12-12", "2026-12-19"], deadline: "2026-10-30" }));
    expect(past.errors).toEqual([]);
    expect(past.warnings.map((w) => w.field)).toEqual(["saturdays"]);
  });

  it("Uhrzeit HH:MM–HH:MM", () => {
    expect(parseTimeRange("9:30–11:10 Uhr")).toEqual({ start: 570, end: 670 });
    expect(parseTimeRange("09:30-11:10")).toEqual({ start: 570, end: 670 });
    for (const t of ["9.30–11.10", "morgens", "9:30", "25:00–26:00", "9:30–9:75"]) expect(fields(base({ time: t }))).toEqual(["time"]);
    expect(fields(base({ time: "11:10–9:30" }))).toEqual(["time"]);
  });

  it("sinnvolle Zahlen, min. Teilnehmende ≤ Plaetze", () => {
    expect(fields(base({ pricePerLesson: 0 }))).toEqual(["pricePerLesson"]);
    expect(fields(base({ pricePerLesson: 5.5 }))).toEqual(["pricePerLesson"]);
    expect(fields(base({ pricePerLesson: Number.NaN }))).toEqual(["pricePerLesson"]);
    expect(fields(base({ lessons: 0 }))).toEqual(["lessons"]);
    expect(fields(base({ maxParticipants: 0, minParticipants: 1 }))).toContain("maxParticipants");
    expect(fields(base({ maxParticipants: 4, minParticipants: 5 }))).toEqual(["minParticipants"]);
    expect(fields(base({ maxParticipants: 4, minParticipants: 4 }))).toEqual([]);
  });

  it("Ueberschneidung mit einem anderen aktiven Kurs: Warnung, kein Fehler", () => {
    const other = base({ id: "b1", name: "BM-Kurs", gruppe: "bm", time: "10:00–11:40 Uhr" });
    const r = check(base(), [base(), other]);
    expect(r.errors).toEqual([]);
    expect(r.warnings[0]).toMatchObject({ field: "time" });
    expect(r.warnings[0].msg).toContain("BM-Kurs");
    // pausiert oder spaeter am Tag: keine Warnung
    expect(check(base(), [base(), { ...other, active: false }]).warnings).toEqual([]);
    expect(check(base(), [base(), { ...other, time: "11:10–12:50 Uhr" }]).warnings).toEqual([]);
  });

  it("Vorschau besteht die Pruefung vor dem Senden; sonst Grund beim Feld 'vorschau'", () => {
    for (const art of ["erst", "nachfassen"] as const)
      for (const wer of ["du", "eltern", "unklar", "en"] as const) expect(previewMessage(base(), 89, art, wer).problem).toBeNull();
    // Kursname mit Platzhalter: Nachricht faellt durch die Pruefung
    const bad = check(base({ name: "Mathe {kursname}" }));
    // je eine Meldung fuer Erst-Nachricht und Nachfassen
    expect(new Set(bad.errors.map((e) => e.field))).toEqual(new Set(["vorschau"]));
    expect(bad.errors.map((e) => e.msg.split(" ")[0])).toEqual(["Erst-Nachricht", "Nachfassen"]);
    expect(bad.errors[0].msg).toMatch(/Platzhalter/);
  });

  it("Vorschau: Englisch mit englischem Kursnamen, Eltern mit 'Ihre Tochter'", () => {
    const c = base({ nameEn: "Matura maths preparation course" });
    expect(previewMessage(c, 89, "erst", "en").text).toContain("offering a Matura maths preparation course");
    expect(previewMessage(c, 89, "nachfassen", "eltern").text).toContain("Soll ich für Ihre Tochter einen Platz reservieren?");
    expect(previewMessage(c, 89, "erst", "du").text).toMatch(/^Hallo,\n\ngerne unterstütze ich dich/);
  });

  it("Stufe offen: keine Termine noetig", () => {
    const q = { ...newCourse("Mathe", "offen", NOW), saturdays: ["", "", "", ""] as Course["saturdays"], deadline: "" };
    expect(check(q).errors).toEqual([]);
  });
});
