"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { useGlobalIncomeSummary } from "@/hooks/useGlobalIncomeSummary";
import { formatCHF } from "@/lib/ui-format";

type DanceRow = {
  id: string;
  date: string;
  payerName: string;
  amountOriginal: number;
  currency: "CHF" | "EUR" | "MXN";
  chfRate: number;
  amountCHF: number;
  notes: string | null;
};

type FxPayload = {
  chfPerEur: number;
  chfPerMxn: number;
  source: string;
  fetchedAt: string;
};

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function DancePage() {
  const { monthIncome, ytdIncome, loading: incomeLoading } = useGlobalIncomeSummary();
  const [rows, setRows] = useState<DanceRow[]>([]);
  const [fx, setFx] = useState<FxPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    date: todayYmd(),
    payerName: "",
    amount: "",
    currency: "CHF" as "CHF" | "EUR" | "MXN",
    notes: "",
  });

  const load = useCallback(async () => {
    const year = new Date().getFullYear();
    const r = await fetch(`/api/dance-earnings?year=${year}`);
    const body = (await r.json().catch(() => ({}))) as {
      rows?: DanceRow[];
      rates?: FxPayload;
      error?: string;
    };
    setRows(Array.isArray(body.rows) ? body.rows : []);
    setFx(body.rates ?? null);
    if (!r.ok) setError(body.error ?? "Dance earnings konnten nicht geladen werden.");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const monthTotal = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    return rows
      .filter((r) => {
        const d = new Date(r.date);
        return d.getFullYear() === y && d.getMonth() + 1 === m;
      })
      .reduce((acc, r) => acc + r.amountCHF, 0);
  }, [rows]);

  return (
    <DashboardShell monthIncome={monthIncome} ytdIncome={ytdIncome} incomeLoading={incomeLoading}>
      <div className="space-y-4">
        <section className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-bold text-gray-900">Dance Earnings</h1>
            <button
              type="button"
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await fetch("/api/fx-rates", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ force: true }),
                  });
                  const body = (await r.json()) as FxPayload;
                  setFx(body);
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:border-[#4A7FC1] hover:text-[#4A7FC1]"
            >
              Wechselkurse aktualisieren
            </button>
          </div>
          {fx && (
            <p className="mb-3 text-xs text-gray-500">
              1 EUR = {fx.chfPerEur.toFixed(4)} CHF · 1 MXN = {fx.chfPerMxn.toFixed(4)} CHF
            </p>
          )}
          <form
            className="grid grid-cols-1 gap-2 md:grid-cols-5"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const r = await fetch("/api/dance-earnings", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    date: form.date,
                    payerName: form.payerName,
                    amount: Number(form.amount),
                    currency: form.currency,
                    notes: form.notes,
                  }),
                });
                const body = (await r.json().catch(() => ({}))) as { error?: string };
                if (!r.ok) {
                  setError(body.error ?? "Konnte nicht speichern.");
                  return;
                }
                setForm((old) => ({ ...old, payerName: "", amount: "", notes: "" }));
                await load();
              } finally {
                setBusy(false);
              }
            }}
          >
            <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm" />
            <input placeholder="Name" value={form.payerName} onChange={(e) => setForm((f) => ({ ...f, payerName: e.target.value }))} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm" />
            <input placeholder="Betrag" type="number" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm" />
            <select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value as "CHF" | "EUR" | "MXN" }))} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
              <option value="CHF">CHF</option>
              <option value="EUR">EUR</option>
              <option value="MXN">MXN</option>
            </select>
            <button type="submit" disabled={busy} className="rounded-xl bg-[#4A7FC1] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
              Hinzufügen
            </button>
            <input placeholder="Notiz (optional)" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="md:col-span-5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm" />
          </form>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <p className="mt-3 text-sm font-medium text-[#4A7FC1]">Dance Einnahmen diesen Monat: {formatCHF(monthTotal)}</p>
        </section>

        <section className="overflow-x-auto rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-2">Datum</th>
                <th className="py-2">Name</th>
                <th className="py-2">Original</th>
                <th className="py-2">Kurs</th>
                <th className="py-2">CHF</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="py-2">{new Date(row.date).toLocaleDateString("de-CH")}</td>
                  <td className="py-2">{row.payerName}</td>
                  <td className="py-2">{row.amountOriginal.toFixed(2)} {row.currency}</td>
                  <td className="py-2">{row.chfRate.toFixed(4)}</td>
                  <td className="py-2 font-semibold">{formatCHF(row.amountCHF)}</td>
                  <td className="py-2">
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:underline"
                      onClick={async () => {
                        await fetch(`/api/dance-earnings/${row.id}`, { method: "DELETE" });
                        await load();
                      }}
                    >
                      Löschen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </DashboardShell>
  );
}
