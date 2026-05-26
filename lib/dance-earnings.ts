export type DanceEarningForIncome = {
  year: number;
  month: number;
  amountCHF: number;
};

export function monthDanceEarningsTotal(rows: DanceEarningForIncome[], year: number, month: number): number {
  return rows
    .filter((r) => r.year === year && r.month === month)
    .reduce((acc, r) => acc + r.amountCHF, 0);
}

export function ytdDanceEarningsTotal(
  rows: DanceEarningForIncome[],
  year: number,
  throughMonth = 12
): number {
  return rows
    .filter((r) => r.year === year && r.month >= 1 && r.month <= throughMonth)
    .reduce((acc, r) => acc + r.amountCHF, 0);
}
