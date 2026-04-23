"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import type { SessionWithStudent } from "@/lib/ui-types";

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

export default function SettingsPage() {
  const [form, setForm] = useState<SettingsForm>(emptyForm);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [monthIncome, setMonthIncome] = useState(0);
  const [ytdIncome, setYtdIncome] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;
      const [settingsRes, monthRes, yearRes] = await Promise.all([
        fetch("/api/settings"),
        fetch(`/api/sessions?year=${currentYear}&month=${currentMonth}`),
        fetch(`/api/sessions?year=${currentYear}`),
      ]);
      if (!settingsRes.ok) throw new Error("Settings load failed");
      const settings = (await settingsRes.json()) as SettingsForm;
      setForm(settings);

      const monthRows = (await monthRes.json()) as SessionWithStudent[];
      const yearRows = (await yearRes.json()) as SessionWithStudent[];
      setMonthIncome(monthRows.reduce((acc, s) => acc + s.amountCHF, 0));
      setYtdIncome(yearRows.reduce((acc, s) => acc + s.amountCHF, 0));
    } catch {
      setMessage("Fehler beim Laden der Einstellungen.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (e: React.FormEvent) => {
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
  };

  return (
    <DashboardShell monthIncome={monthIncome} ytdIncome={ytdIncome}>
      <section className="min-w-0 rounded-lg border border-gray-200 bg-white p-4 sm:p-5">
        <h2 className="text-xl font-semibold text-gray-900">Tutor Settings</h2>
        <p className="mt-1 text-sm text-gray-500">
          Diese Daten werden fuer Rechnung PDF und WhatsApp-Nachrichten verwendet.
        </p>

        {loading ? (
          <div className="mt-4 h-40 animate-pulse rounded-lg border border-gray-200 bg-gray-50" />
        ) : (
          <form onSubmit={save} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
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
    </DashboardShell>
  );
}
