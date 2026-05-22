export function parseAdditionalEarningInput(body: {
  year?: unknown;
  month?: unknown;
  name?: unknown;
  amountCHF?: unknown;
}):
  | { ok: true; year: number; month: number; name: string; amountCHF: number }
  | { ok: false; error: string } {
  const year = Math.floor(Number(body.year));
  const month = Math.floor(Number(body.month));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const amount = Number(body.amountCHF);

  if (year < 2000 || year > 2100) return { ok: false, error: "Ungueltiges Jahr." };
  if (month < 1 || month > 12) return { ok: false, error: "Ungueltiger Monat." };
  if (!name) return { ok: false, error: "Name ist erforderlich." };
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: "Ungueltiger Betrag." };

  return {
    ok: true,
    year,
    month,
    name,
    amountCHF: Math.round(amount * 100) / 100,
  };
}
