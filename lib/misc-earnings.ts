export type MiscEarningForIncome = {
  year: number;
  month: number;
  amountCHF: number;
  source: "manual" | "q1_adjustment";
};

function isSameMonth(row: MiscEarningForIncome, year: number, month: number): boolean {
  return row.year === year && row.month === month;
}

export function monthMiscEarningsTotal(
  rows: MiscEarningForIncome[],
  year: number,
  month: number,
  opts?: { includeQ1Adjustment?: boolean }
): number {
  const includeQ1Adjustment = opts?.includeQ1Adjustment ?? true;
  return rows
    .filter((r) => isSameMonth(r, year, month))
    .filter((r) => includeQ1Adjustment || r.source !== "q1_adjustment")
    .reduce((acc, r) => acc + r.amountCHF, 0);
}

export function ytdMiscEarningsTotal(
  rows: MiscEarningForIncome[],
  year: number,
  opts?: { excludeQ1AdjustmentMonths?: Set<number> }
): number {
  const excluded = opts?.excludeQ1AdjustmentMonths ?? new Set<number>();
  let total = 0;
  for (const r of rows) {
    if (r.year !== year) continue;
    if (r.source === "q1_adjustment" && excluded.has(r.month)) continue;
    total += r.amountCHF;
  }
  return total;
}
