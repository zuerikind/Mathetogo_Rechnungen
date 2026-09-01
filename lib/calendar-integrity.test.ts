import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeIntegrityFinding,
  findCalendarIntegrityIssues,
  findDuplicateSlots,
  findOrphanSessions,
  integrityIssuesToClose,
  integrityIssueStatus,
  type IntegritySession,
} from "./calendar-integrity";

/**
 * Die Szenarien sind keine erfundenen Beispiele: es sind die drei Faelle vom
 * August 2026 (Leo, Elenor, Luca) plus der verschobene Termin, der als einziger
 * noch nicht vorgekommen ist und am gefaehrlichsten waere.
 */

const session = (over: Partial<IntegritySession> & { id: string }): IntegritySession => ({
  studentId: "stud-1",
  studentName: "Testkind",
  date: new Date("2026-08-20T12:30:00Z"),
  durationMin: 50,
  amountCHF: 65,
  calEventId: `evt-${over.id}`,
  ...over,
});

describe("findOrphanSessions", () => {
  it("meldet eine Lektion, deren Kalendertermin es nicht mehr gibt", () => {
    const stale = session({ id: "alt", calEventId: "_serie" });
    const orphans = findOrphanSessions([stale], new Set(["_serie_20260820T143000Z"]));
    expect(orphans.map((s) => s.id)).toEqual(["alt"]);
  });

  it("laesst gueltige Lektionen in Ruhe", () => {
    const ok = session({ id: "ok", calEventId: "evt-1" });
    expect(findOrphanSessions([ok], new Set(["evt-1"]))).toEqual([]);
  });

  it("meldet Q1-Importe nicht — die hatten nie einen Google-Termin", () => {
    const manual = session({ id: "q1", calEventId: "manual-2026-01-13-liam" });
    expect(findOrphanSessions([manual], new Set())).toEqual([]);
  });

  it("meldet Lektionen ohne calEventId nicht", () => {
    const handmade = session({ id: "frei", calEventId: null });
    expect(findOrphanSessions([handmade], new Set())).toEqual([]);
  });
});

describe("findDuplicateSlots", () => {
  it("findet zwei Lektionen desselben Schuelers zur selben Startzeit", () => {
    const a = session({ id: "a", calEventId: "alt", durationMin: 60, amountCHF: 78 });
    const b = session({ id: "b", calEventId: "neu" });
    const groups = findDuplicateSlots([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((s) => s.id).sort()).toEqual(["a", "b"]);
  });

  it("zwei Schueler zur selben Zeit sind keine Doppelbelegung", () => {
    const a = session({ id: "a", studentId: "s1" });
    const b = session({ id: "b", studentId: "s2" });
    expect(findDuplicateSlots([a, b])).toEqual([]);
  });

  it("derselbe Schueler an verschiedenen Zeiten ist keine Doppelbelegung", () => {
    const a = session({ id: "a", date: new Date("2026-08-20T12:30:00Z") });
    const b = session({ id: "b", date: new Date("2026-08-20T13:30:00Z") });
    expect(findDuplicateSlots([a, b])).toEqual([]);
  });
});

describe("die echten Faelle vom August 2026", () => {
  /**
   * Leo: der Einzeltermin `_8p134…` wurde zur Serie. Google liefert seither nur
   * noch `_8p134…_20260820T143000Z`; die alte Zeile (60 Min, 78.00) blieb neben
   * der neuen (50 Min, 65.00) stehen und wurde mitfakturiert.
   */
  it("Leo — alte Einzeltermin-ID neben neuer Serien-Instanz", () => {
    const alt = session({
      id: "leo-alt", studentId: "leo", studentName: "Leo",
      calEventId: "_8p134", durationMin: 60, amountCHF: 78,
    });
    const neu = session({
      id: "leo-neu", studentId: "leo", studentName: "Leo",
      calEventId: "_8p134_20260820T143000Z",
    });

    const findings = findCalendarIntegrityIssues({
      sessions: [alt, neu],
      googleEventIds: new Set(["_8p134_20260820T143000Z"]),
    });

    expect(findings.map((f) => f.type).sort()).toEqual(["duplicate_slot", "session_orphan"]);
    const orphan = findings.find((f) => f.type === "session_orphan")!;
    expect(orphan.sessionIds).toEqual(["leo-alt"]);
    expect(orphan.amountCHF).toBe(78);
    // Der Betrag, der zu viel auf der Rechnung stand.
    const dup = findings.find((f) => f.type === "duplicate_slot")!;
    expect(dup.sessionIds.sort()).toEqual(["leo-alt", "leo-neu"]);
  });

  /**
   * Elenor: der Termin am Montag 15:00 wurde Teil einer Serie am Mittwoch 13:00.
   * Es gibt KEINE Doppelbelegung — die alte Zeile steht allein an ihrem Datum.
   * Nur die Waisen-Pruefung sieht sie.
   */
  it("Elenor — alte Identitaet verschwindet, kein doppelter Slot", () => {
    const alt = session({
      id: "elenor-mo", studentId: "elenor", studentName: "Elenor",
      date: new Date("2026-08-17T13:00:00Z"), calEventId: "_6go3", durationMin: 60, amountCHF: 78,
    });
    const serie = session({
      id: "elenor-mi", studentId: "elenor", studentName: "Elenor",
      date: new Date("2026-08-19T11:00:00Z"), calEventId: "_6go3_20260819T130000Z",
      durationMin: 60, amountCHF: 78,
    });

    const findings = findCalendarIntegrityIssues({
      sessions: [alt, serie],
      googleEventIds: new Set(["_6go3_20260819T130000Z"]),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe("session_orphan");
    expect(findings[0].sessionIds).toEqual(["elenor-mo"]);
  });

  /**
   * Luca: Termin geloescht und neu angelegt — die neue Basis-ID hat mit der alten
   * nichts zu tun. Trotzdem muss die alte Zeile auffallen.
   */
  it("Luca — vollstaendig neue Event-ID am selben Zeitpunkt", () => {
    const alt = session({
      id: "luca-alt", studentId: "luca", studentName: "Luca",
      date: new Date("2026-08-28T11:00:00Z"),
      calEventId: "_6ksj_20260828T130000Z", durationMin: 60, amountCHF: 90,
    });
    const neu = session({
      id: "luca-neu", studentId: "luca", studentName: "Luca",
      date: new Date("2026-08-28T11:00:00Z"),
      calEventId: "08trcp_20260828T130000Z", durationMin: 50, amountCHF: 75,
    });

    const findings = findCalendarIntegrityIssues({
      sessions: [alt, neu],
      googleEventIds: new Set(["08trcp_20260828T130000Z"]),
    });

    const orphan = findings.find((f) => f.type === "session_orphan")!;
    expect(orphan.sessionIds).toEqual(["luca-alt"]);
    const dup = findings.find((f) => f.type === "duplicate_slot")!;
    // Fuer diesen einen Zeitpunkt standen 165.00 auf der Rechnung statt 75.00.
    // Welche der beiden Zeilen die richtige ist, entscheidet der Mensch.
    expect(dup.amountCHF).toBe(165);
    expect(dup.parts).toEqual([
      { durationMin: 60, amountCHF: 90 },
      { durationMin: 50, amountCHF: 75 },
    ]);
  });

  /**
   * Der gefaehrlichste Fall, bisher nicht eingetreten: der Termin wurde
   * VERSCHOBEN und neu angelegt. Die Waise bleibt an Datum A, der Ersatz liegt an
   * Datum B — keine doppelte Startzeit, die Doppelpruefung ist blind. Ohne die
   * Waisen-Pruefung wuerde die alte Lektion einfach als zusaetzliche Stunde
   * mitfakturiert.
   */
  it("verschobener Termin — Waise an Datum A, Ersatz an Datum B", () => {
    const alt = session({
      id: "alt-a", studentId: "kind", studentName: "Kind",
      date: new Date("2026-08-11T09:00:00Z"), calEventId: "alt-id", durationMin: 60, amountCHF: 78,
    });
    const neu = session({
      id: "neu-b", studentId: "kind", studentName: "Kind",
      date: new Date("2026-08-13T09:00:00Z"), calEventId: "neu-id", durationMin: 60, amountCHF: 78,
    });

    const findings = findCalendarIntegrityIssues({
      sessions: [alt, neu],
      googleEventIds: new Set(["neu-id"]),
    });

    expect(findDuplicateSlots([alt, neu])).toEqual([]);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe("session_orphan");
    expect(findings[0].sessionIds).toEqual(["alt-a"]);
  });

  it("ein sauberer Monat meldet nichts", () => {
    const a = session({ id: "a", calEventId: "e1", date: new Date("2026-09-03T12:30:00Z") });
    const b = session({ id: "b", calEventId: "e2", date: new Date("2026-09-10T12:30:00Z") });
    expect(
      findCalendarIntegrityIssues({ sessions: [a, b], googleEventIds: new Set(["e1", "e2"]) })
    ).toEqual([]);
  });
});

describe("ausgelieferte Monate", () => {
  const alt = session({
    id: "alt", studentId: "leo", studentName: "Leo", calEventId: "weg", amountCHF: 78,
  });

  it("werden weiterhin geprueft — Erkennung haengt nicht an der Mutation", () => {
    const findings = findCalendarIntegrityIssues({
      sessions: [alt],
      googleEventIds: new Set(),
      deliveredStudentIds: new Set(["leo"]),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].monthDelivered).toBe(true);
  });

  it("die Erkennung veraendert die Eingabe nicht", () => {
    const sessions = [alt];
    const kopie = JSON.parse(JSON.stringify(sessions));
    findCalendarIntegrityIssues({ sessions, googleEventIds: new Set() });
    expect(JSON.parse(JSON.stringify(sessions))).toEqual(kopie);
  });
});

describe("Lebenszyklus eines Befunds", () => {
  it("bleibt offen, solange er besteht — auch nach einem voreiligen «Erledigt»", () => {
    expect(integrityIssueStatus("resolved")).toBe("open");
    expect(integrityIssueStatus("open")).toBe("open");
    expect(integrityIssueStatus(null)).toBe("open");
  });

  it("«Ignorieren» bleibt bestehen", () => {
    expect(integrityIssueStatus("ignored")).toBe("ignored");
  });

  it("verschwundene Befunde werden automatisch erledigt", () => {
    expect(integrityIssuesToClose(["orphan:a", "dup:x"], new Set(["dup:x"]))).toEqual(["orphan:a"]);
  });
});

describe("describeIntegrityFinding", () => {
  it("beschreibt beide Typen ohne rohe IDs", () => {
    const [orphan] = findCalendarIntegrityIssues({
      sessions: [session({ id: "a", studentName: "Leo", calEventId: "weg" })],
      googleEventIds: new Set(),
    });
    const text = describeIntegrityFinding(orphan);
    expect(text).toContain("Leo");
    expect(text).not.toContain("weg");
  });
});

/**
 * Die Zusicherung, um die es bei Stufe 1 geht: Erkennung ist von Mutation
 * getrennt. Diese Pruefungen lesen die Quelle, statt sie auszufuehren — die
 * Sync-Route haengt an Google, Prisma und auth, und genau das soll hier nicht
 * angefasst werden. Sie fallen, sobald jemand der Erkennung einen Schreibzugriff
 * gibt oder den Schutz ausgelieferter Monate an sie koppelt.
 */
describe("Erkennung veraendert nichts (Quellpruefung)", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");
  const code = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  const modul = code(read("lib/calendar-integrity.ts"));
  const syncRoute = read("app/api/sync/route.ts");
  const integrityBlock = code(
    syncRoute.slice(
      syncRoute.indexOf("let integrityFindings"),
      syncRoute.indexOf("// Nicht zugeordnete Termine festhalten")
    )
  );

  it("das Pruefmodul kennt keine Datenbank", () => {
    expect(modul).not.toContain("prisma");
    expect(modul).not.toContain("@/lib/prisma");
  });

  it("das Pruefmodul schreibt nichts", () => {
    for (const verb of ["delete", "update", "upsert", "create"]) {
      expect(modul).not.toContain(verb);
    }
  });

  it("der Integritaetsblock im Sync liest nur Sessions", () => {
    expect(integrityBlock).toContain("prisma.session.findMany");
    for (const schreibend of [
      "session.delete",
      "session.update",
      "session.upsert",
      "session.deleteMany",
      "session.updateMany",
      "invoice.update",
      "invoice.delete",
      "invoiceSnapshot",
    ]) {
      expect(integrityBlock).not.toContain(schreibend);
    }
  });

  it("die Pruefung haengt weder an pruneOrphans noch am Schutz ausgelieferter Monate", () => {
    // notDelivered/allowPruneOrphans duerfen die Kandidatenauswahl der LOESCHUNG
    // weiterhin steuern — aber nicht die Erkennung.
    expect(integrityBlock).not.toContain("allowPruneOrphans");
    expect(integrityBlock).not.toContain("notDelivered");
    // Der Monatsumfang bleibt vollstaendig. Einzige Einschraenkung sind
    // soft-stornierte Lektionen: die sind entschieden und weder Waise noch
    // Doppelbelegung. Bewusst genau dieser Filter und kein anderer — ohne ihn
    // bliebe nach jeder automatischen Absage ein Befund stehen.
    expect(integrityBlock).toContain("where: { year, month, ...ACTIVE_SESSION_WHERE }");
  });

  it("der Schutz ausgelieferter Monate beim Loeschen bleibt unveraendert", () => {
    const geloescht = code(syncRoute);
    expect(geloescht).toContain("if (allowPruneOrphans)");
    expect(geloescht).toContain("...notDelivered,");
  });
});
