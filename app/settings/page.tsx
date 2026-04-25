"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { useGlobalIncomeSummary } from "@/hooks/useGlobalIncomeSummary";
import { monthOptions } from "@/lib/ui-format";

type SettingsForm = {
  name: string;
  email: string;
  address: string;
  phone: string;
  iban: string;
  bankName: string;
};

const emptyForm: SettingsForm = {
  name: "",
  email: "",
  address: "",
  phone: "",
  iban: "",
  bankName: "",
};

type SettingsApi = SettingsForm & {
  manualQ1: {
    year: number;
    m1: number;
    m2: number;
    m3: number;
    fromDatabase: boolean;
  };
  miscYear: number;
  miscEarnings: Array<{
    id: string;
    year: number;
    month: number;
    amountCHF: number;
    label: string;
    source: "manual" | "q1_adjustment";
  }>;
  q1Reconciliation: Array<{
    year: number;
    month: number;
    pdfCHF: number;
    targetCHF: number;
    deltaCHF: number;
  }>;
};

function parseAmount(s: string): number {
  const t = s.trim().replace(/\s/g, "").replace(/'/g, "").replace(",", ".");
  return Number(t);
}

const inputClass =
  "w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-right text-sm font-semibold text-[#4A7FC1] tabular-nums outline-none transition focus:border-[#4A7FC1] focus:ring-2 focus:ring-[#4A7FC1]/20";

export default function SettingsPage() {
  const [form, setForm] = useState<SettingsForm>(emptyForm);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const { monthIncome, ytdIncome, loading: incomeLoading, refresh: refreshIncome } = useGlobalIncomeSummary();
  const [manualYear, setManualYear] = useState("");
  const [manualM1, setManualM1] = useState("");
  const [manualM2, setManualM2] = useState("");
  const [manualM3, setManualM3] = useState("");
  const [manualSaving, setManualSaving] = useState(false);
  const [manualFromDb, setManualFromDb] = useState(false);
  const [miscYear, setMiscYear] = useState(new Date().getFullYear());
  const [miscEarnings, setMiscEarnings] = useState<SettingsApi["miscEarnings"]>([]);
  const [q1Reconciliation, setQ1Reconciliation] = useState<SettingsApi["q1Reconciliation"]>([]);
  const [miscMonth, setMiscMonth] = useState(1);
  const [miscAmount, setMiscAmount] = useState("");
  const [miscLabel, setMiscLabel] = useState("");
  const [miscEditId, setMiscEditId] = useState<string | null>(null);
  const [miscSaving, setMiscSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const settingsRes = await fetch(`/api/settings?miscYear=${miscYear}`);
      if (!settingsRes.ok) throw new Error("Settings load failed");
      const data = (await settingsRes.json()) as SettingsApi;
      setForm({
        name: data.name,
        email: data.email,
        address: data.address,
        phone: data.phone,
        iban: data.iban,
        bankName: data.bankName,
      });
      if (data.manualQ1) {
        setManualYear(String(data.manualQ1.year));
        setManualM1(String(data.manualQ1.m1));
        setManualM2(String(data.manualQ1.m2));
        setManualM3(String(data.manualQ1.m3));
        setManualFromDb(data.manualQ1.fromDatabase);
      }
      setMiscYear(data.miscYear);
      setMiscEarnings(data.miscEarnings ?? []);
      setQ1Reconciliation(data.q1Reconciliation ?? []);

    } catch {
      setMessage("Fehler beim Laden der Einstellungen.");
    } finally {
      setLoading(false);
    }
  }, [miscYear]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveTutor = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      setMessage("Speichern fehlgeschlagen.");
      return;
    }
    setMessage("Einstellungen gespeichert.");
    void load();
    void refreshIncome();
  };

  const saveManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    const y = Math.floor(Number(manualYear));
    const m1 = parseAmount(manualM1);
    const m2 = parseAmount(manualM2);
    const m3 = parseAmount(manualM3);
    if (!Number.isFinite(y) || y < 2000 || y > 2100) {
      setMessage("Bitte ein gueltiges Jahr eingeben.");
      return;
    }
    if (![m1, m2, m3].every((n) => Number.isFinite(n) && n >= 0)) {
      setMessage("Bitte gueltige Betraege eingeben (Zahlen, Dezimaltrennzeichen . oder ,).");
      return;
    }
    setManualSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manualQ1: { year: y, m1, m2, m3 },
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(err.error ?? "Speichern fehlgeschlagen.");
        return;
      }
      setMessage("Manuelle Einnahmen gespeichert.");
      setManualFromDb(true);
      void load();
      void refreshIncome();
    } finally {
      setManualSaving(false);
    }
  };

  const resetManualDefaults = async () => {
    if (!window.confirm("Auf die Standardwerte aus dem Code zuruecksetzen? (Seitenneustart / Deploy kann noetig sein.)")) {
      return;
    }
    setMessage("");
    setManualSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manualQ1: null }),
      });
      if (!res.ok) {
        setMessage("Zuruecksetzen fehlgeschlagen.");
        return;
      }
      setMessage("Auf Standardwerte zurueckgesetzt (aus lib/manual-revenue).");
      setManualFromDb(false);
      void load();
      void refreshIncome();
    } finally {
      setManualSaving(false);
    }
  };

  const saveMiscEarning = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    const amount = parseAmount(miscAmount);
    if (!Number.isFinite(amount)) {
      setMessage("Bitte gueltigen Betrag fuer sonstige Einnahme eingeben.");
      return;
    }
    setMiscSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          miscEarningUpsert: {
            id: miscEditId ?? undefined,
            year: miscYear,
            month: miscMonth,
            amountCHF: amount,
            label: miscLabel,
          },
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(err.error ?? "Speichern fehlgeschlagen.");
        return;
      }
      setMessage("Sonstige Einnahme gespeichert.");
      setMiscEditId(null);
      setMiscAmount("");
      setMiscLabel("");
      setMiscMonth(1);
      void load();
      void refreshIncome();
    } finally {
      setMiscSaving(false);
    }
  };

  const editMiscEarning = (row: SettingsApi["miscEarnings"][number]) => {
    setMiscEditId(row.id);
    setMiscYear(row.year);
    setMiscMonth(row.month);
    setMiscAmount(String(row.amountCHF));
    setMiscLabel(row.label ?? "");
  };

  const deleteMiscEarning = async (id: string) => {
    if (!window.confirm("Diesen Eintrag loeschen?")) return;
    setMessage("");
    setMiscSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ miscEarningDeleteId: id }),
      });
      if (!res.ok) {
        setMessage("Loeschen fehlgeschlagen.");
        return;
      }
      setMessage("Sonstige Einnahme geloescht.");
      if (miscEditId === id) setMiscEditId(null);
      void load();
      void refreshIncome();
    } finally {
      setMiscSaving(false);
    }
  };

  return (
    <DashboardShell monthIncome={monthIncome} ytdIncome={ytdIncome} incomeLoading={incomeLoading}>
      <div className="space-y-5">
        <section className="min-w-0 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="text-lg font-semibold text-gray-900">Manuelle Einnahmen (Jan.–März.)</h2>
          <p className="mt-1 text-sm text-gray-500">
            Diese Beträge ersetzen die Kalender-Sessions für die ersten drei Monate des gewählten
            Jahres in Dashboard und Auswertungen. Ab April zählt nur noch der Kalender.
          </p>
          {loading ? (
            <p className="mt-3 text-sm text-gray-400">Laden…</p>
          ) : (
            <form onSubmit={saveManual} className="mt-4">
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full min-w-[20rem] text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                      <th className="px-4 py-3">Jahr</th>
                      <th className="px-4 py-3">Monat</th>
                      <th className="px-4 py-3 text-right">Gesamt (CHF)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    <tr>
                      <td className="px-4 py-2 align-middle" rowSpan={3}>
                        <input
                          value={manualYear}
                          onChange={(e) => setManualYear(e.target.value)}
                          className="w-full max-w-[5.5rem] rounded-lg border border-gray-200 px-2 py-1.5 text-sm font-medium tabular-nums outline-none focus:border-[#4A7FC1] focus:ring-2 focus:ring-[#4A7FC1]/20"
                          inputMode="numeric"
                          aria-label="Jahr"
                        />
                      </td>
                      <td className="px-4 py-2 text-gray-800">
                        {monthOptions.find((m) => m.value === 1)?.label ?? "Januar"}
                      </td>
                      <td className="px-4 py-2">
                        <input
                          value={manualM1}
                          onChange={(e) => setManualM1(e.target.value)}
                          className={inputClass}
                          inputMode="decimal"
                          aria-label="Januar CHF"
                        />
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-gray-800">
                        {monthOptions.find((m) => m.value === 2)?.label ?? "Februar"}
                      </td>
                      <td className="px-4 py-2">
                        <input
                          value={manualM2}
                          onChange={(e) => setManualM2(e.target.value)}
                          className={inputClass}
                          inputMode="decimal"
                          aria-label="Februar CHF"
                        />
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-gray-800">
                        {monthOptions.find((m) => m.value === 3)?.label ?? "März"}
                      </td>
                      <td className="px-4 py-2">
                        <input
                          value={manualM3}
                          onChange={(e) => setManualM3(e.target.value)}
                          className={inputClass}
                          inputMode="decimal"
                          aria-label="März CHF"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                <button
                  type="submit"
                  disabled={manualSaving}
                  className="rounded-lg bg-[#4A7FC1] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
                >
                  {manualSaving ? "Speichere…" : "Manuelle Werte speichern"}
                </button>
                <button
                  type="button"
                  disabled={manualSaving}
                  onClick={() => void resetManualDefaults()}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 transition hover:border-amber-200 hover:text-amber-800 disabled:opacity-50"
                >
                  Standardwerte (Code-Defaults)
                </button>
                <span className="text-xs text-gray-400">
                  {manualFromDb ? "Gespeichert in der Datenbank." : "Aktuell: Code-Defaults (noch nicht in DB)."}
                </span>
              </div>
            </form>
          )}
        </section>

        <section className="min-w-0 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="text-lg font-semibold text-gray-900">Sonstige Earnings (nur Uebersicht)</h2>
          <p className="mt-1 text-sm text-gray-500">
            Diese Eintraege gehen nur in Dashboard/KPIs/Jahressumme ein, nicht in Rechnungen.
          </p>
          <form onSubmit={saveMiscEarning} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
            <input
              value={miscYear}
              onChange={(e) => setMiscYear(Math.floor(Number(e.target.value) || new Date().getFullYear()))}
              inputMode="numeric"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Jahr"
            />
            <select
              value={miscMonth}
              onChange={(e) => setMiscMonth(Number(e.target.value))}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <input
              value={miscAmount}
              onChange={(e) => setMiscAmount(e.target.value)}
              inputMode="decimal"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Betrag CHF"
            />
            <input
              value={miscLabel}
              onChange={(e) => setMiscLabel(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Label (optional)"
            />
            <button
              type="submit"
              disabled={miscSaving}
              className="rounded-md bg-[#4A7FC1] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {miscSaving ? "Speichere…" : miscEditId ? "Update" : "Hinzufuegen"}
            </button>
          </form>

          <div className="mt-4 overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full min-w-[24rem] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                  <th className="px-3 py-2">Monat</th>
                  <th className="px-3 py-2 text-right">CHF</th>
                  <th className="px-3 py-2">Label</th>
                  <th className="px-3 py-2">Typ</th>
                  <th className="px-3 py-2 text-right">Aktion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {miscEarnings.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-3 text-gray-400">
                      Keine sonstigen Earnings fuer {miscYear}.
                    </td>
                  </tr>
                ) : (
                  miscEarnings.map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2">{monthOptions.find((m) => m.value === row.month)?.label ?? row.month}</td>
                      <td className="px-3 py-2 text-right font-medium text-[#4A7FC1]">{row.amountCHF.toFixed(2)}</td>
                      <td className="px-3 py-2">{row.label || "—"}</td>
                      <td className="px-3 py-2">{row.source === "manual" ? "Manuell" : "Q1-Abgleich"}</td>
                      <td className="px-3 py-2 text-right">
                        {row.source === "manual" ? (
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => editMiscEarning(row)}
                              className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteMiscEarning(row.id)}
                              className="rounded border border-red-200 px-2 py-1 text-xs text-red-600"
                            >
                              Delete
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">Auto</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <h3 className="mt-5 text-sm font-semibold text-gray-700">Q1-Abgleich (PDF vs Ziel)</h3>
          <div className="mt-2 overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full min-w-[22rem] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                  <th className="px-3 py-2">Monat</th>
                  <th className="px-3 py-2 text-right">PDF</th>
                  <th className="px-3 py-2 text-right">Ziel</th>
                  <th className="px-3 py-2 text-right">Differenz</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {q1Reconciliation.map((r) => (
                  <tr key={`${r.year}-${r.month}`}>
                    <td className="px-3 py-2">{monthOptions.find((m) => m.value === r.month)?.label ?? r.month}</td>
                    <td className="px-3 py-2 text-right">{r.pdfCHF.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{r.targetCHF.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-medium">{r.deltaCHF.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="min-w-0 rounded-lg border border-gray-200 bg-white p-4 sm:p-5">
          <h2 className="text-xl font-semibold text-gray-900">Tutor Settings</h2>
          <p className="mt-1 text-sm text-gray-500">
            Diese Daten werden fuer Rechnung PDF und WhatsApp-Nachrichten verwendet.
          </p>

          {loading ? (
            <div className="mt-4 h-40 animate-pulse rounded-lg border border-gray-200 bg-gray-50" />
          ) : (
            <form onSubmit={saveTutor} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Dein Name"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="Deine E-Mail"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="Telefon"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                value={form.bankName}
                onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                placeholder="Bankname"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                value={form.iban}
                onChange={(e) => setForm((f) => ({ ...f, iban: e.target.value }))}
                placeholder="IBAN"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
              />
              <textarea
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Adresse"
                rows={3}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
              />
              <div className="md:col-span-2">
                <button className="rounded-md bg-[#0F6E56] px-4 py-2 text-sm font-medium text-white">
                  Save settings
                </button>
              </div>
            </form>
          )}
          {message ? <p className="mt-3 text-sm text-gray-700">{message}</p> : null}
        </section>
      </div>
    </DashboardShell>
  );
}
