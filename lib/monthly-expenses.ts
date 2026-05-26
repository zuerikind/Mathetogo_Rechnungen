export type MonthlyExpenseForIncome = {
  id: string;
  year: number;
  month: number;
  amountCHF: number;
  notes?: string | null;
};

function isSameMonth(row: MonthlyExpenseForIncome, year: number, month: number): boolean {
  return row.year === year && row.month === month;
}

export function monthExpenseTotal(
  rows: MonthlyExpenseForIncome[],
  year: number,
  month: number
): number {
  return rows.filter((r) => isSameMonth(r, year, month)).reduce((acc, r) => acc + r.amountCHF, 0);
}

export function ytdExpenseTotal(
  rows: MonthlyExpenseForIncome[],
  year: number,
  throughMonth: number
): number {
  return rows
    .filter((r) => r.year === year && r.month >= 1 && r.month <= throughMonth)
    .reduce((acc, r) => acc + r.amountCHF, 0);
}
