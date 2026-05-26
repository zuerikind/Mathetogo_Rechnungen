"use client";

import { formatCHF } from "@/lib/ui-format";
import type { AdditionalEarningForIncome } from "@/lib/additional-earnings";

type Props = {
  year: number;
  month: number;
  rows: AdditionalEarningForIncome[];
};

export function AdditionalEarningsSection({ year, month, rows }: Props) {
  const monthRows = rows.filter((r) => r.year === year && r.month === month);
  const total = monthRows.reduce((s, r) => s + r.amountCHF, 0);

  if (monthRows.length === 0) {
    return null;
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <details className="group">
        <summary className="cursor-pointer list-none px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-slate-900">Zusatzeinkommen</span>
            <span className="text-sm font-semibold tabular-nums text-slate-900">{formatCHF(total)}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {monthRows.length} {monthRows.length === 1 ? "Eintrag" : "Einträge"} · zum Aufklappen klicken
          </p>
        </summary>
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 sm:px-5">
          <ul className="divide-y divide-slate-100">
            {monthRows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5"
              >
                <p className="min-w-0 font-medium text-slate-800">{row.name}</p>
                <span className="font-semibold tabular-nums text-slate-900">{formatCHF(row.amountCHF)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            Bearbeiten und hinzufügen unter Einstellungen.
          </p>
        </div>
      </details>
    </section>
  );
}
