export type SupportedCurrency = "CHF" | "EUR" | "MXN";

export type FxRates = {
  chfPerEur: number;
  chfPerMxn: number;
  source: string;
  fetchedAt: Date;
};

export const FX_DEFAULTS: FxRates = {
  chfPerEur: 0.97,
  chfPerMxn: 0.05,
  source: "default",
  fetchedAt: new Date(0),
};

export function toChfRate(currency: SupportedCurrency, rates: FxRates): number {
  if (currency === "CHF") return 1;
  if (currency === "EUR") return rates.chfPerEur;
  return rates.chfPerMxn;
}

export async function fetchLatestFxRates(): Promise<FxRates> {
  const response = await fetch("https://api.exchangerate.host/latest?base=CHF&symbols=EUR,MXN", {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`FX API ${response.status}`);
  const body = (await response.json()) as {
    rates?: { EUR?: number; MXN?: number };
    date?: string;
  };
  const eurPerChf = Number(body.rates?.EUR);
  const mxnPerChf = Number(body.rates?.MXN);
  if (!Number.isFinite(eurPerChf) || eurPerChf <= 0 || !Number.isFinite(mxnPerChf) || mxnPerChf <= 0) {
    throw new Error("FX API payload invalid");
  }
  const fetchedAt = body.date ? new Date(`${body.date}T00:00:00Z`) : new Date();
  return {
    chfPerEur: 1 / eurPerChf,
    chfPerMxn: 1 / mxnPerChf,
    source: "exchangerate.host",
    fetchedAt,
  };
}
