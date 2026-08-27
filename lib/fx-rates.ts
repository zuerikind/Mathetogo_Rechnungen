/**
 * Wechselkurse — manuell gepflegt, kein externer Dienst.
 *
 * Vorher hing das an api.exchangerate.host. Der Endpunkt verlangt inzwischen einen
 * Access Key und antwortet ohne ihn mit HTTP 200 und `success: false`; `response.ok`
 * war also wahr, die Kurse fehlten, `Number(undefined)` wurde NaN und der Fehler lief
 * still in den Fallback. Ergebnis: jede EUR-/MXN-Einnahme wurde auf Dauer mit den
 * hartkodierten Startwerten umgerechnet, waehrend der Knopf "aktualisieren" Erfolg
 * meldete. Ein stiller Netzaufruf, der Geldbetraege bestimmt, ist die falsche
 * Grundlage — die Kurse stehen jetzt in der Datenbank und werden von Hand gepflegt.
 *
 * WICHTIG fuer den Bestand: DanceEarning friert `chfRate` und `amountCHF` beim
 * Erfassen ein. Ein spaeter geaenderter Kurs wirkt deshalb nur auf NEUE Eintraege;
 * historische Betraege bleiben unangetastet.
 */

export type SupportedCurrency = "CHF" | "EUR" | "MXN";

export const SUPPORTED_CURRENCIES: readonly SupportedCurrency[] = ["CHF", "EUR", "MXN"] as const;

export function isSupportedCurrency(value: unknown): value is SupportedCurrency {
  return typeof value === "string" && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

export type FxRates = {
  chfPerEur: number;
  chfPerMxn: number;
  /** "manual" sobald der Nutzer gespeichert hat, sonst "default". */
  source: string;
  /** Zeitpunkt der letzten manuellen Aenderung. */
  fetchedAt: Date;
};

/**
 * Startwerte, solange nie ein Kurs gespeichert wurde. Bewusst als "default"
 * gekennzeichnet, damit die Oberflaeche sagen kann, dass hier noch nichts
 * gepflegt ist — sie sind eine Notloesung, keine Marktdaten.
 */
export const FX_DEFAULTS: FxRates = {
  chfPerEur: 0.97,
  chfPerMxn: 0.05,
  source: "default",
  fetchedAt: new Date(0),
};

/** Obergrenze gegen Tippfehler (z. B. 9700 statt 0.97). Kein Kurs dieser Waehrungen liegt darueber. */
export const MAX_FX_RATE = 1000;

/**
 * Eingabe → Kurs, oder null wenn unbrauchbar.
 *
 * Abgelehnt werden 0, negative Werte, NaN/Infinity, leere und nicht-numerische
 * Zeichenketten sowie absurd grosse Werte. Ein Kurs von 0 wuerde jede Einnahme auf
 * CHF 0.00 abwerten — das darf nie durchrutschen.
 */
export function parseFxRate(value: unknown): number | null {
  if (typeof value === "boolean" || value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  if (n > MAX_FX_RATE) return null;
  // Decimal(12,6) in der Datenbank — gleich hier auf sechs Stellen bringen, damit
  // gespeicherter und angezeigter Wert identisch sind.
  return Math.round(n * 1_000_000) / 1_000_000;
}

export type FxRateInput = { chfPerEur: unknown; chfPerMxn: unknown };
export type FxRateValidation =
  | { ok: true; chfPerEur: number; chfPerMxn: number }
  | { ok: false; error: string };

export function validateFxRates(input: FxRateInput): FxRateValidation {
  const chfPerEur = parseFxRate(input.chfPerEur);
  const chfPerMxn = parseFxRate(input.chfPerMxn);
  const invalid: string[] = [];
  if (chfPerEur === null) invalid.push("EUR");
  if (chfPerMxn === null) invalid.push("MXN");
  if (chfPerEur === null || chfPerMxn === null) {
    return {
      ok: false,
      error: `Ungueltiger Kurs fuer ${invalid.join(" und ")}: erwartet eine Zahl groesser als 0 und hoechstens ${MAX_FX_RATE}.`,
    };
  }
  return { ok: true, chfPerEur, chfPerMxn };
}

/** CHF je Einheit der Fremdwaehrung; CHF selbst ist immer 1. */
export function toChfRate(currency: SupportedCurrency, rates: Pick<FxRates, "chfPerEur" | "chfPerMxn">): number {
  if (currency === "CHF") return 1;
  if (currency === "EUR") return rates.chfPerEur;
  return rates.chfPerMxn;
}

/** Umrechnung auf Rappen gerundet — dieselbe Rundung wie ueberall sonst im Geldpfad. */
export function convertToChf(
  amountOriginal: number,
  currency: SupportedCurrency,
  rates: Pick<FxRates, "chfPerEur" | "chfPerMxn">
): { chfRate: number; amountCHF: number } {
  const chfRate = toChfRate(currency, rates);
  return { chfRate, amountCHF: applyChfRate(amountOriginal, chfRate) };
}

/** Betrag × bereits feststehender Kurs, auf Rappen gerundet. */
export function applyChfRate(amountOriginal: number, chfRate: number): number {
  return Math.round(amountOriginal * chfRate * 100) / 100;
}

export type StoredEarningRate = {
  currency: SupportedCurrency;
  /** Der beim Erfassen eingefrorene Kurs. */
  chfRate: number;
};

export type EditRateDecision = {
  chfRate: number;
  /** true = die Waehrung wurde gewechselt, deshalb gilt der heutige Kurs. */
  currencyChanged: boolean;
  /** true = der gespeicherte Kurs war unbrauchbar und wurde ersetzt (Notfall). */
  replacedUnusableRate: boolean;
};

/**
 * Welcher Kurs gilt beim BEARBEITEN einer bestehenden Einnahme?
 *
 * Buchhalterische Regel: ein manuell geaenderter Kurs wirkt ab jetzt, nie
 * rueckwirkend. Eine im Maerz zu 0.96 erfasste Einnahme bleibt auf 0.96, auch
 * wenn der globale Kurs spaeter auf 0.93 steht — Betrag korrigieren darf nicht
 * heissen, den historischen Kurs stillschweigend auszutauschen.
 *
 * Einzige Ausnahme: wird die WAEHRUNG selbst gewechselt, gibt es fuer die neue
 * Waehrung keinen historischen Kurs. Dann gilt der heute konfigurierte, und er
 * wird als neuer Stand eingefroren.
 *
 * Ist der gespeicherte Kurs unbrauchbar (0, negativ, NaN — etwa aus einem alten
 * Datensatz), wird auf den heutigen zurueckgefallen, statt mit 0 zu rechnen und
 * den Betrag klaglos auf CHF 0.00 zu setzen.
 */
export function rateForEdit(
  existing: StoredEarningRate,
  nextCurrency: SupportedCurrency,
  currentRates: Pick<FxRates, "chfPerEur" | "chfPerMxn">
): EditRateDecision {
  if (nextCurrency !== existing.currency) {
    return {
      chfRate: toChfRate(nextCurrency, currentRates),
      currencyChanged: true,
      replacedUnusableRate: false,
    };
  }
  const stored = existing.chfRate;
  if (!Number.isFinite(stored) || stored <= 0) {
    return {
      chfRate: toChfRate(nextCurrency, currentRates),
      currencyChanged: false,
      replacedUnusableRate: true,
    };
  }
  return { chfRate: stored, currencyChanged: false, replacedUnusableRate: false };
}
