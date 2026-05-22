export type AdditionalEarningForIncome = {
  id: string;
  year: number;
  month: number;
  name: string;
  amountCHF: number;
};

function isSameMonth(row: AdditionalEarningForIncome, year: number, month: number): boolean {
  return row.year === year && row.month === month;
}

export function monthAdditionalEarningsTotal(
  rows: AdditionalEarningForIncome[],
  year: number,
  month: number
): number {
  return rows.filter((r) => isSameMonth(r, year, month)).reduce((acc, r) => acc + r.amountCHF, 0);
}

export function ytdAdditionalEarningsTotal(rows: AdditionalEarningForIncome[], year: number): number {
  return rows.filter((r) => r.year === year).reduce((acc, r) => acc + r.amountCHF, 0);
}
