/**
 * MonthlyExpense routes: tolerate missing DB migration or stale Prisma client.
 */
export function isMonthlyExpenseUnavailable(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: string }).code;
    if (code === "P2021" || code === "P2010") return true;
  }
  const msg = error instanceof Error ? error.message : String(error);
  if (/MonthlyExpense/i.test(msg) && /does not exist|42P01|Unknown table|relation/i.test(msg)) return true;
  if (/Cannot read properties of undefined/i.test(msg) && /findMany|upsert|create|update|delete/i.test(msg))
    return true;
  return false;
}

export function prismaHasMonthlyExpense(prisma: object): boolean {
  const p = prisma as { monthlyExpense?: { findMany?: unknown } };
  return typeof p.monthlyExpense?.findMany === "function";
}
