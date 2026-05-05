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

export function ytdDanceEarningsTotal(rows: DanceEarningForIncome[], year: number): number {
  return rows
    .filter((r) => r.year === year)
    .reduce((acc, r) => acc + r.amountCHF, 0);
}
