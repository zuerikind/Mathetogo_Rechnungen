import { describe, expect, it } from "vitest";
import {
  applyChfRate,
  convertToChf,
  FX_DEFAULTS,
  isSupportedCurrency,
  MAX_FX_RATE,
  parseFxRate,
  rateForEdit,
  toChfRate,
  validateFxRates,
} from "./fx-rates";

/**
 * Regression: die Kurse kamen von api.exchangerate.host. Der Endpunkt verlangt
 * inzwischen einen Access Key und antwortet ohne ihn mit HTTP 200 und
 * `success: false` — `response.ok` war wahr, die Kurse fehlten, der Fehler lief
 * still in den Fallback. Jede EUR-/MXN-Einnahme wurde dauerhaft mit den
 * Startwerten umgerechnet, waehrend der Knopf Erfolg meldete.
 *
 * Jetzt: gespeicherte, von Hand gepflegte Kurse. Kein Modul im Einkommenspfad
 * ruft noch etwas ab — das prueft der letzte Block hier.
 */

describe("parseFxRate", () => {
  it("nimmt Zahlen und numerische Zeichenketten", () => {
    expect(parseFxRate(0.93)).toBe(0.93);
    expect(parseFxRate("0.93")).toBe(0.93);
    expect(parseFxRate(" 0.0432 ")).toBe(0.0432);
  });

  it("rundet auf die sechs Nachkommastellen der Decimal(12,6)-Spalte", () => {
    expect(parseFxRate(0.12345678)).toBe(0.123457);
  });

  it("lehnt 0 ab", () => {
    // Ein Kurs von 0 wuerde jede Einnahme klaglos auf CHF 0.00 abwerten.
    expect(parseFxRate(0)).toBeNull();
    expect(parseFxRate("0")).toBeNull();
    expect(parseFxRate("0.000000")).toBeNull();
  });

  it("lehnt negative Werte ab", () => {
    expect(parseFxRate(-1)).toBeNull();
    expect(parseFxRate("-0.93")).toBeNull();
  });

  it("lehnt NaN, Infinity und Unfug ab", () => {
    expect(parseFxRate(NaN)).toBeNull();
    expect(parseFxRate(Infinity)).toBeNull();
    expect(parseFxRate(-Infinity)).toBeNull();
    expect(parseFxRate("abc")).toBeNull();
    expect(parseFxRate("0,93")).toBeNull(); // Komma statt Punkt
    expect(parseFxRate("")).toBeNull();
    expect(parseFxRate("   ")).toBeNull();
    expect(parseFxRate(null)).toBeNull();
    expect(parseFxRate(undefined)).toBeNull();
    expect(parseFxRate({})).toBeNull();
    expect(parseFxRate([])).toBeNull();
    expect(parseFxRate(true)).toBeNull();
  });

  it("lehnt absurd grosse Werte ab (Tippfehler wie 9700 statt 0.97)", () => {
    expect(parseFxRate(MAX_FX_RATE)).toBe(MAX_FX_RATE);
    expect(parseFxRate(MAX_FX_RATE + 1)).toBeNull();
    expect(parseFxRate(9700)).toBeNull();
  });
});

describe("validateFxRates", () => {
  it("nimmt ein gueltiges Paar an", () => {
    expect(validateFxRates({ chfPerEur: "0.93", chfPerMxn: "0.043" })).toEqual({
      ok: true,
      chfPerEur: 0.93,
      chfPerMxn: 0.043,
    });
  });

  it("nennt die fehlerhafte Waehrung", () => {
    const eur = validateFxRates({ chfPerEur: 0, chfPerMxn: 0.043 });
    expect(eur.ok).toBe(false);
    if (!eur.ok) expect(eur.error).toContain("EUR");

    const mxn = validateFxRates({ chfPerEur: 0.93, chfPerMxn: "abc" });
    expect(mxn.ok).toBe(false);
    if (!mxn.ok) expect(mxn.error).toContain("MXN");

    const beide = validateFxRates({ chfPerEur: -1, chfPerMxn: NaN });
    expect(beide.ok).toBe(false);
    if (!beide.ok) {
      expect(beide.error).toContain("EUR");
      expect(beide.error).toContain("MXN");
    }
  });

  it("speichert nichts Halbes: ein ungueltiger Wert kippt das ganze Paar", () => {
    expect(validateFxRates({ chfPerEur: 0.93, chfPerMxn: 0 }).ok).toBe(false);
  });
});

describe("toChfRate / convertToChf", () => {
  const manuell = { chfPerEur: 0.93, chfPerMxn: 0.0432 };

  it("verwendet den manuell gesetzten EUR-Kurs", () => {
    expect(toChfRate("EUR", manuell)).toBe(0.93);
    expect(convertToChf(100, "EUR", manuell)).toEqual({ chfRate: 0.93, amountCHF: 93 });
  });

  it("verwendet den manuell gesetzten MXN-Kurs", () => {
    expect(toChfRate("MXN", manuell)).toBe(0.0432);
    expect(convertToChf(1000, "MXN", manuell)).toEqual({ chfRate: 0.0432, amountCHF: 43.2 });
  });

  it("CHF bleibt 1:1", () => {
    expect(toChfRate("CHF", manuell)).toBe(1);
    expect(convertToChf(250.5, "CHF", manuell)).toEqual({ chfRate: 1, amountCHF: 250.5 });
  });

  it("ein geaenderter Kurs wirkt auf neue Umrechnungen", () => {
    const alt = convertToChf(100, "EUR", { chfPerEur: 0.97, chfPerMxn: 0.05 });
    const neu = convertToChf(100, "EUR", { chfPerEur: 0.93, chfPerMxn: 0.05 });
    expect(alt.amountCHF).toBe(97);
    expect(neu.amountCHF).toBe(93);
  });

  it("rundet auf Rappen", () => {
    expect(convertToChf(33.33, "EUR", { chfPerEur: 0.93, chfPerMxn: 0.05 }).amountCHF).toBe(31);
    expect(convertToChf(1, "MXN", { chfPerEur: 0.93, chfPerMxn: 0.043219 }).amountCHF).toBe(0.04);
  });
});

describe("Startwerte", () => {
  it("sind als 'default' gekennzeichnet, damit die Oberflaeche sie so benennen kann", () => {
    expect(FX_DEFAULTS.source).toBe("default");
    expect(FX_DEFAULTS.chfPerEur).toBeGreaterThan(0);
    expect(FX_DEFAULTS.chfPerMxn).toBeGreaterThan(0);
  });
});

describe("isSupportedCurrency", () => {
  it("kennt genau die drei Waehrungen", () => {
    expect(isSupportedCurrency("CHF")).toBe(true);
    expect(isSupportedCurrency("EUR")).toBe(true);
    expect(isSupportedCurrency("MXN")).toBe(true);
    expect(isSupportedCurrency("USD")).toBe(false);
    expect(isSupportedCurrency("")).toBe(false);
    expect(isSupportedCurrency(undefined)).toBe(false);
  });
});

describe("kein externer Dienst mehr", () => {
  it("das Modul exportiert keinen Abruf und ruft beim Laden nichts auf", async () => {
    // Waere hier noch ein fetch, wuerde ein Testlauf ohne Netz auffliegen — und
    // vor allem: die Einkommensrechnung haenge wieder an einem fremden Endpunkt.
    const mod = await import("./fx-rates");
    expect(Object.keys(mod)).not.toContain("fetchLatestFxRates");
    expect(Object.values(mod).every((v) => typeof v !== "function" || v.length >= 0)).toBe(true);
  });

  it("Umrechnung braucht nur Zahlen, kein IO", () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (() => {
      called = true;
      throw new Error("Im Einkommenspfad darf kein Netzaufruf stattfinden");
    }) as typeof fetch;
    try {
      expect(convertToChf(50, "EUR", { chfPerEur: 0.93, chfPerMxn: 0.043 }).amountCHF).toBe(46.5);
      expect(validateFxRates({ chfPerEur: 0.93, chfPerMxn: 0.043 }).ok).toBe(true);
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

/**
 * Buchhalterische Kernregel: ein manuell geaenderter Kurs wirkt AB JETZT.
 *
 * Eine im Maerz zu 0.96 erfasste Einnahme bleibt auf 0.96 — auch nachdem der
 * globale Kurs auf 0.93 gesetzt wurde, auch wenn spaeter der Betrag korrigiert
 * wird. Sonst wanderten historische Ertraege jedes Mal mit, wenn jemand den
 * aktuellen Kurs nachfuehrt.
 */
describe("rateForEdit — historische Kurse bleiben stehen", () => {
  const HEUTE = { chfPerEur: 0.93, chfPerMxn: 0.0432 };
  /** Die Maerz-Einnahme aus dem Beispiel: EUR 500 zu 0.96 = CHF 480. */
  const maerz = { currency: "EUR" as const, chfRate: 0.96 };

  it("Bearbeitung ohne Waehrungswechsel behaelt den eingefrorenen Kurs", () => {
    expect(rateForEdit(maerz, "EUR", HEUTE)).toEqual({
      chfRate: 0.96,
      currencyChanged: false,
      replacedUnusableRate: false,
    });
  });

  it("Betragskorrektur rechnet mit dem historischen Kurs, nicht mit dem heutigen", () => {
    // EUR 500 -> EUR 600 bei gespeichertem 0.96 ergibt CHF 576, nicht CHF 558.
    const { chfRate } = rateForEdit(maerz, "EUR", HEUTE);
    expect(applyChfRate(600, chfRate)).toBe(576);
    expect(applyChfRate(600, HEUTE.chfPerEur)).toBe(558); // was es faelschlich waere
  });

  it("eine reine Beschreibungs-/Datumsaenderung ruehrt den Betrag nicht an", () => {
    const { chfRate } = rateForEdit(maerz, "EUR", HEUTE);
    expect(chfRate).toBe(0.96);
    expect(applyChfRate(500, chfRate)).toBe(480);
  });

  it("mehrfaches Bearbeiten driftet nicht auf den heutigen Kurs", () => {
    let row = { ...maerz };
    for (let edit = 0; edit < 5; edit += 1) {
      const { chfRate } = rateForEdit(row, "EUR", HEUTE);
      row = { currency: "EUR", chfRate };
    }
    expect(row.chfRate).toBe(0.96);
    expect(applyChfRate(500, row.chfRate)).toBe(480);
  });

  it("Waehrungswechsel nimmt den heutigen Kurs der NEUEN Waehrung", () => {
    // Fuer die neue Waehrung gibt es keinen historischen Kurs — der alte EUR-Kurs
    // waere hier schlicht falsch.
    expect(rateForEdit(maerz, "MXN", HEUTE)).toEqual({
      chfRate: 0.0432,
      currencyChanged: true,
      replacedUnusableRate: false,
    });
    expect(rateForEdit(maerz, "CHF", HEUTE)).toEqual({
      chfRate: 1,
      currencyChanged: true,
      replacedUnusableRate: false,
    });
  });

  it("Wechsel zurueck holt den HEUTIGEN Kurs, nicht den alten von damals", () => {
    const nachMxn = { currency: "MXN" as const, chfRate: 0.0432 };
    expect(rateForEdit(nachMxn, "EUR", HEUTE).chfRate).toBe(0.93);
  });

  it("CHF-Einnahmen bleiben bei 1", () => {
    expect(rateForEdit({ currency: "CHF", chfRate: 1 }, "CHF", HEUTE).chfRate).toBe(1);
  });

  it("ein unbrauchbarer gespeicherter Kurs faellt auf den heutigen zurueck", () => {
    // Statt mit 0 zu rechnen und den Betrag klaglos auf CHF 0.00 zu setzen.
    for (const kaputt of [0, -1, NaN, Infinity]) {
      const d = rateForEdit({ currency: "EUR", chfRate: kaputt }, "EUR", HEUTE);
      expect(d.chfRate).toBe(0.93);
      expect(d.replacedUnusableRate).toBe(true);
    }
  });
});

describe("Szenario 4 aus der Abnahme — Schritt fuer Schritt", () => {
  it("alte Einnahme bleibt, neue folgt dem neuen Kurs", () => {
    // 1./2./3. EUR/CHF = 0.96, EUR 500 erfassen -> CHF 480
    const kursAlt = { chfPerEur: 0.96, chfPerMxn: 0.05 };
    const maerzErfasst = convertToChf(500, "EUR", kursAlt);
    expect(maerzErfasst).toEqual({ chfRate: 0.96, amountCHF: 480 });

    // 4. globalen Kurs auf 0.93 aendern
    const kursNeu = { chfPerEur: 0.93, chfPerMxn: 0.05 };

    // 5. die alte Einnahme ist ein gespeicherter Datensatz — sie wird von der
    //    Kursaenderung gar nicht beruehrt. Erst eine Bearbeitung koennte sie
    //    anfassen, und die haelt den Kurs fest:
    const maerzGespeichert = { currency: "EUR" as const, chfRate: maerzErfasst.chfRate };
    expect(rateForEdit(maerzGespeichert, "EUR", kursNeu).chfRate).toBe(0.96);
    expect(applyChfRate(500, 0.96)).toBe(480);

    // 6./7. neue Einnahme EUR 500 -> CHF 465
    expect(convertToChf(500, "EUR", kursNeu)).toEqual({ chfRate: 0.93, amountCHF: 465 });

    // Beschreibung der alten aendern -> weiterhin 0.96 / CHF 480
    expect(applyChfRate(500, rateForEdit(maerzGespeichert, "EUR", kursNeu).chfRate)).toBe(480);

    // Betrag der alten auf EUR 600 aendern -> CHF 576 (0.96), nicht CHF 558 (0.93)
    expect(applyChfRate(600, rateForEdit(maerzGespeichert, "EUR", kursNeu).chfRate)).toBe(576);
  });
});
