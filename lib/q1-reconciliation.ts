import { MANUAL_BASELINE_YEAR } from "@/lib/manual-revenue";

export type Q1Month = 1 | 2 | 3;

export const Q1_PDF_TOTALS: Readonly<Record<Q1Month, number>> = {
  1: 8248,
  2: 3977.8,
  3: 4472.5,
};

export const DEFAULT_Q1_TARGETS: Readonly<Record<Q1Month, number>> = {
  1: 8501.8,
  2: 4197.5,
  3: 4624.0,
};

export function normalizeQ1Targets(input: {
  m1?: number | null;
  m2?: number | null;
  m3?: number | null;
}): Record<Q1Month, number> {
  return {
    1: Number.isFinite(input.m1) ? Number(input.m1) : DEFAULT_Q1_TARGETS[1],
    2: Number.isFinite(input.m2) ? Number(input.m2) : DEFAULT_Q1_TARGETS[2],
    3: Number.isFinite(input.m3) ? Number(input.m3) : DEFAULT_Q1_TARGETS[3],
  };
}

export function q1ReconciliationRows(year: number, targets: Record<Q1Month, number>) {
  return ([1, 2, 3] as const).map((month) => {
    const pdf = Q1_PDF_TOTALS[month];
    const target = targets[month];
    const delta = Number((target - pdf).toFixed(2));
    return { year, month, pdfCHF: pdf, targetCHF: target, deltaCHF: delta };
  });
}

export function defaultQ1Year() {
  return MANUAL_BASELINE_YEAR;
}
