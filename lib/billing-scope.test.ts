import { describe, expect, it } from "vitest";
import {
  affectedInvoiceMonths,
  billingScopeStudentIds,
  billingTargetIdOf,
  collectBilledSessionIds,
  excludeAlreadyBilledSessions,
  blockedDeliveredMonths,
  evaluateRepricingGuard,
} from "./billing-scope";

/**
 * Regression: Tarifaenderung auf einer bereits ausgelieferten Familienrechnung.
 *
 * Der Guard in app/api/students/[id] suchte ausgelieferte Rechnungen nur unter
 * `studentId = <geaenderter Schueler>`. Fuer ein per billedToId verknuepftes Kind
 * gibt es diese Zeile gar nicht — die Lektionen stehen auf der Rechnung des
 * Hauptschuelers. Der Guard fand nichts, der 409 blieb aus, und amountCHF von
 * Lektionen einer ausgelieferten, snapshot-belegten Rechnung wurde neu berechnet.
 */

const KIND = "student-kind";
const ELTERN = "student-eltern";

describe("billingTargetIdOf", () => {
  it("ohne Verknuepfung ist der Schueler sein eigener Rechnungsempfaenger", () => {
    expect(billingTargetIdOf(KIND, null)).toBe(KIND);
    expect(billingTargetIdOf(KIND, undefined)).toBe(KIND);
  });

  it("mit Verknuepfung traegt der Hauptschueler die Rechnung", () => {
    expect(billingTargetIdOf(KIND, ELTERN)).toBe(ELTERN);
  });
});

describe("billingScopeStudentIds", () => {
  it("Einzelschueler: nur er selbst", () => {
    expect(billingScopeStudentIds(KIND, null)).toEqual([KIND]);
  });

  it("verknuepftes Kind: eigene UND Familienrechnung", () => {
    // Beide, weil ein Kind auch eine eigene, frueher ausgelieferte Rechnung fuer
    // den Monat haben kann (dann bleiben seine Betraege dort) — dieselbe Ausnahme,
    // die getInvoicePayload ueber excludedChildIds kennt.
    expect(billingScopeStudentIds(KIND, ELTERN)).toEqual([KIND, ELTERN]);
  });

  it("nie doppelt, wenn billedToId auf den Schueler selbst zeigt", () => {
    expect(billingScopeStudentIds(KIND, KIND)).toEqual([KIND]);
  });
});

describe("affectedInvoiceMonths", () => {
  it("fasst Lektionen zu Kalendermonaten (Zuerich) zusammen", () => {
    const months = affectedInvoiceMonths([
      { date: new Date("2026-06-03T09:00:00Z") },
      { date: new Date("2026-06-20T09:00:00Z") },
      { date: new Date("2026-07-01T09:00:00Z") },
    ]);
    expect(months).toEqual([
      { year: 2026, month: 6 },
      { year: 2026, month: 7 },
    ]);
  });

  it("bucketet nach Zuercher Kalendertag, nicht nach UTC", () => {
    // 30.06. 23:30 UTC ist in Zuerich bereits der 1. Juli (Sommerzeit, UTC+2).
    expect(affectedInvoiceMonths([{ date: new Date("2026-06-30T23:30:00Z") }])).toEqual([
      { year: 2026, month: 7 },
    ]);
  });
});

describe("blockedDeliveredMonths", () => {
  const juni = { year: 2026, month: 6 };
  const juli = { year: 2026, month: 7 };

  it("direkter Schueler mit ausgelieferter Rechnung -> blockiert", () => {
    expect(blockedDeliveredMonths([juni], [juni])).toEqual([juni]);
  });

  it("Kind mit ausgelieferter FAMILIENrechnung -> blockiert", () => {
    // Die Rechnung gehoert dem Hauptschueler; entscheidend ist allein, dass fuer
    // den betroffenen Monat innerhalb der Rechnungsgruppe eine ausgelieferte
    // Rechnung existiert. Genau das hat der alte Guard nie gesehen.
    const deliveredFamilyInvoices = [juni]; // aus billingScopeStudentIds([KIND, ELTERN])
    expect(blockedDeliveredMonths([juni], deliveredFamilyInvoices)).toEqual([juni]);
  });

  it("Kind mit nur einem Entwurf in der Gruppe -> erlaubt", () => {
    // Entwuerfe kommen gar nicht erst in die Liste (DELIVERED_INVOICE_WHERE filtert
    // sie weg) — ohne ausgelieferte Rechnung bleibt die Umbepreisung erlaubt.
    expect(blockedDeliveredMonths([juni], [])).toEqual([]);
  });

  it("kein betroffener Monat ausgeliefert -> erlaubt", () => {
    expect(blockedDeliveredMonths([juli], [juni])).toEqual([]);
  });

  it("meldet nur die tatsaechlich betroffenen Monate zurueck", () => {
    expect(blockedDeliveredMonths([juni, juli], [juni, juli])).toEqual([juni, juli]);
    expect(blockedDeliveredMonths([juli], [juni, juli])).toEqual([juli]);
  });

  it("trennt gleiche Monatszahl in verschiedenen Jahren", () => {
    expect(blockedDeliveredMonths([{ year: 2025, month: 6 }], [juni])).toEqual([]);
  });
});

describe("evaluateRepricingGuard", () => {
  const juni = { year: 2026, month: 6 };
  const juli = { year: 2026, month: 7 };

  /**
   * Der ganze Ablauf des Guards, so wie der PUT-Endpunkt ihn durchlaeuft:
   * betroffene Monate der umzubepreisenden Lektionen gegen die ausgelieferten
   * Rechnungen der Rechnungsgruppe.
   */
  const guardFor = (opts: {
    billedToId: string | null;
    /** Ausgelieferte Rechnungen, nach studentId. */
    delivered: { studentId: string; year: number; month: number }[];
    affected: { year: number; month: number }[];
    confirmed?: boolean;
  }) => {
    const scope = new Set(billingScopeStudentIds(KIND, opts.billedToId));
    return evaluateRepricingGuard({
      affected: opts.affected,
      deliveredInScope: opts.delivered.filter((d) => scope.has(d.studentId)),
      confirmed: opts.confirmed ?? false,
    });
  };

  it("direkter Schueler + ausgelieferte eigene Rechnung -> blockiert", () => {
    const guard = guardFor({
      billedToId: null,
      delivered: [{ studentId: KIND, ...juni }],
      affected: [juni],
    });
    expect(guard).toEqual({ allowed: false, billedMonths: [juni] });
  });

  it("Kind mit billedToId + ausgelieferte Familienrechnung -> blockiert", () => {
    // DER Regressionsfall. Die ausgelieferte Rechnung laeuft auf ELTERN, die
    // geaenderte Lektion gehoert KIND. Vorher: Guard sah nur KIND, fand nichts,
    // liess durch und schrieb amountCHF einer fakturierten Lektion um.
    const guard = guardFor({
      billedToId: ELTERN,
      delivered: [{ studentId: ELTERN, ...juni }],
      affected: [juni],
    });
    expect(guard).toEqual({ allowed: false, billedMonths: [juni] });
  });

  it("blockierter Fall meldet die Monate und erlaubt KEINE Schreiboperation", () => {
    const guard = guardFor({
      billedToId: ELTERN,
      delivered: [{ studentId: ELTERN, ...juni }],
      affected: [juni, juli],
    });
    expect(guard.allowed).toBe(false);
    // Der Aufrufer bricht bei allowed === false vor jedem Schreiben ab; die
    // historischen Betraege bleiben damit unangetastet.
    if (guard.allowed) throw new Error("Guard haette blockieren muessen");
    expect(guard.billedMonths).toEqual([juni]);
  });

  it("Kind mit billedToId, aber nur Entwurf in der Gruppe -> erlaubt", () => {
    // Entwuerfe sind nicht ausgeliefert und stehen deshalb nicht in `delivered`.
    const guard = guardFor({ billedToId: ELTERN, delivered: [], affected: [juni] });
    expect(guard).toEqual({ allowed: true });
  });

  it("ausgelieferte Rechnung eines fremden Schuelers zaehlt nicht", () => {
    const guard = guardFor({
      billedToId: null,
      delivered: [{ studentId: "student-fremd", ...juni }],
      affected: [juni],
    });
    expect(guard).toEqual({ allowed: true });
  });

  it("kein betroffener Monat ausgeliefert -> erlaubt", () => {
    const guard = guardFor({
      billedToId: ELTERN,
      delivered: [{ studentId: ELTERN, ...juni }],
      affected: [juli],
    });
    expect(guard).toEqual({ allowed: true });
  });

  it("ausdrueckliche Bestaetigung ueberstimmt den Guard (unveraendert)", () => {
    const guard = guardFor({
      billedToId: ELTERN,
      delivered: [{ studentId: ELTERN, ...juni }],
      affected: [juni],
      confirmed: true,
    });
    expect(guard).toEqual({ allowed: true });
  });
});

/**
 * Regression: Doppelfakturierung beim Wechsel des Rechnungsempfaengers.
 *
 * `billedToId` ist eine bewegliche Spalte ohne Historie. Wurde ein Kind von
 * Eltern A zu Eltern B umgehaengt, gehoerten seine Lektionen ploetzlich zu B —
 * auch die Monate, die auf A's bereits ausgelieferter Rechnung standen. Sie
 * wurden ein zweites Mal fakturiert, unter einer zweiten Nummer, an einen
 * zweiten Zahler. Vorher verhinderte das NICHTS: die einzige Ausschlussregel
 * fragte, ob das Kind eine EIGENE ausgelieferte Rechnung hat.
 */
describe("collectBilledSessionIds", () => {
  it("sammelt die IDs aus den sessionIds-Feldern", () => {
    expect(
      Array.from(collectBilledSessionIds([{ sessionIds: '["s1","s2"]' }, { sessionIds: '["s3"]' }])).sort()
    ).toEqual(["s1", "s2", "s3"]);
  });

  it("leere und fehlende Listen ergeben nichts", () => {
    expect(collectBilledSessionIds([]).size).toBe(0);
    expect(collectBilledSessionIds([{ sessionIds: "[]" }]).size).toBe(0);
    expect(collectBilledSessionIds([{ sessionIds: "" }]).size).toBe(0);
  });

  it("ein defekter Altbeleg blockiert die Rechnungsstellung nicht", () => {
    // Er verliert nur seinen Schutzbeitrag; die uebrigen Belege zaehlen weiter.
    const ids = collectBilledSessionIds([
      { sessionIds: "{kaputt" },
      { sessionIds: '["s9"]' },
      { sessionIds: '"kein array"' },
    ]);
    expect(Array.from(ids)).toEqual(["s9"]);
  });
});

describe("excludeAlreadyBilledSessions", () => {
  const s = (id: string, amountCHF: number) => ({ id, amountCHF });

  it("laesst alles durch, wenn nichts anderweitig abgerechnet ist", () => {
    const sessions = [s("s1", 60), s("s2", 60)];
    expect(excludeAlreadyBilledSessions(sessions, new Set())).toBe(sessions);
  });

  it("DER Regressionsfall: Lektionen auf A's ausgelieferter Rechnung landen nicht auf B", () => {
    // Kind hatte im Juni 4 Lektionen, alle auf der ausgelieferten Rechnung von
    // Eltern A. Danach Wechsel zu Eltern B. B's Rechnung darf leer bleiben.
    const juniLektionen = [s("s1", 60), s("s2", 60), s("s3", 60), s("s4", 60)];
    const aufRechnungVonA = collectBilledSessionIds([{ sessionIds: '["s1","s2","s3","s4"]' }]);
    const fuerB = excludeAlreadyBilledSessions(juniLektionen, aufRechnungVonA);
    expect(fuerB).toEqual([]);
    expect(fuerB.reduce((a, x) => a + x.amountCHF, 0)).toBe(0);
  });

  it("nur die bereits abgerechneten fallen weg, neue bleiben", () => {
    const lektionen = [s("s1", 60), s("s2", 60), s("neu", 90)];
    const gefiltert = excludeAlreadyBilledSessions(
      lektionen,
      collectBilledSessionIds([{ sessionIds: '["s1","s2"]' }])
    );
    expect(gefiltert.map((x) => x.id)).toEqual(["neu"]);
    expect(gefiltert.reduce((a, x) => a + x.amountCHF, 0)).toBe(90);
  });

  it("eine STORNIERTE Rechnung schuetzt nichts — ihre Lektionen bleiben abrechenbar", () => {
    // Storniert wird gar nicht erst geladen (BILLED_ELSEWHERE_WHERE filtert sie
    // weg), die Menge bleibt also leer und die Lektionen kehren zurueck.
    const lektionen = [s("s1", 60)];
    expect(excludeAlreadyBilledSessions(lektionen, collectBilledSessionIds([]))).toEqual(lektionen);
  });

  it("schuetzt auch, wenn der Schueler heute zu gar keiner Gruppe gehoert", () => {
    // Der Schutz haengt am Beleg, nicht an der aktuellen Zuordnung — das ist der
    // ganze Punkt der Aenderung.
    expect(excludeAlreadyBilledSessions([s("s1", 60)], new Set(["s1"]))).toEqual([]);
  });
});
