export function parseMonthlyExpenseInput(body: {
  year?: unknown;
  month?: unknown;
  amountCHF?: unknown;
  notes?: unknown;
}):
  | { ok: true; year: number; month: number; amountCHF: number; notes: string | null }
  | { ok: false; error: string } {
  const year = Math.floor(Number(body.year));
  const month = Math.floor(Number(body.month));
  const amount = Number(body.amountCHF);
  const notes =
    typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  if (year < 2000 || year > 2100) return { ok: false, error: "Ungueltiges Jahr." };
  if (month < 1 || month > 12) return { ok: false, error: "Ungueltiger Monat." };
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: "Ungueltiger Betrag." };

  return {
    ok: true,
    year,
    month,
    amountCHF: Math.round(amount * 100) / 100,
    notes,
  };
}
