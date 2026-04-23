"use client";

import { useState } from "react";
import { formatCHF, getCurrentMonthYear, monthOptions } from "@/lib/ui-format";
import { buildChargeRows, monthsRemaining } from "@/lib/subscription-utils";
import type { PlatformSubscriptionWithCharges } from "@/lib/ui-types";

interface SubscriptionSectionProps {
  studentId: string;
  initialSubscriptions: PlatformSubscriptionWithCharges[];
}

export function SubscriptionSection({ studentId, initialSubscriptions }: SubscriptionSectionProps) {
  const [subscriptions, setSubscriptions] = useState<PlatformSubscriptionWithCharges[]>(initialSubscriptions);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const { month: currentMonth, year: currentYear } = getCurrentMonthYear();

  // Add form state
  const [addAmount, setAddAmount] = useState("");
  const [addDuration, setAddDuration] = useState<"1" | "6">("6");
  const [addBillingMethod, setAddBillingMethod] = useState<"invoice" | "direct">("invoice");
  const [addStartMonth, setAddStartMonth] = useState(currentMonth);
  const [addStartYear, setAddStartYear] = useState(currentYear);

  // Edit form state (per subscription)
  const [editAmount, setEditAmount] = useState("");
  const [editBillingMethod, setEditBillingMethod] = useState<"invoice" | "direct">("invoice");

  const hasActive = subscriptions.some((s) => s.active);

  function openEditForm(sub: PlatformSubscriptionWithCharges) {
    setEditingId(sub.id);
    setEditAmount(String(sub.amountCHF));
    setEditBillingMethod(sub.billingMethod === "direct" ? "direct" : "invoice");
  }

  function openAddForm() {
    const { month, year } = getCurrentMonthYear();
    setAddAmount("");
    setAddDuration("6");
    setAddBillingMethod("invoice");
    setAddStartMonth(month);
    setAddStartYear(year);
    setError("");
    setShowAddForm(true);
  }

  async function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          amountCHF: parseFloat(addAmount),
          durationMonths: parseInt(addDuration, 10),
          billingMethod: addBillingMethod,
          startMonth: addStartMonth,
          startYear: addStartYear,
        }),
      });
      if (res.status === 409) {
        setError("Student hat bereits ein aktives Abonnement");
        return;
      }
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Fehler beim Speichern.");
        return;
      }
      const newSub = (await res.json()) as PlatformSubscriptionWithCharges;
      setSubscriptions((prev) => [newSub, ...prev]);
      setShowAddForm(false);
    } catch {
      setError("Netzwerkfehler.");
    } finally {
      setSaving(false);
    }
  }

  async function handleEditSave(subId: string) {
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/subscriptions/${subId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountCHF: parseFloat(editAmount),
          billingMethod: editBillingMethod,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Fehler beim Speichern.");
        return;
      }
      const updated = (await res.json()) as PlatformSubscriptionWithCharges;
      setSubscriptions((prev) => prev.map((s) => (s.id === subId ? updated : s)));
      setEditingId(null);
    } catch {
      setError("Netzwerkfehler.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(subId: string) {
    if (
      !window.confirm(
        "Abonnement endgueltig loeschen? Alle zugehoerigen Monatszeilen (PlatformCharge) werden entfernt. Dies kann nicht rueckgaengig gemacht werden."
      )
    ) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/subscriptions/${subId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Fehler beim Loeschen.");
        return;
      }
      setSubscriptions((prev) => prev.filter((s) => s.id !== subId));
      if (editingId === subId) setEditingId(null);
    } catch {
      setError("Netzwerkfehler.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(subId: string) {
    if (!window.confirm("Abonnement wirklich deaktivieren? Dies stoppt zukuenftige Abrechnungen.")) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/subscriptions/${subId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Fehler beim Deaktivieren.");
        return;
      }
      const updated = (await res.json()) as PlatformSubscriptionWithCharges;
      setSubscriptions((prev) => prev.map((s) => (s.id === subId ? updated : s)));
    } catch {
      setError("Netzwerkfehler.");
    } finally {
      setSaving(false);
    }
  }

  function getMonthLabel(month: number): string {
    return monthOptions.find((m) => m.value === month)?.label ?? String(month);
  }

  return (
    <section className="rounded-2xl border border-blue-100 bg-white shadow-sm p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">Mathetogo Abonnement</h3>
        {!hasActive ? (
          <button
            onClick={openAddForm}
            className="text-sm text-[#4A7FC1] hover:underline"
            disabled={saving}
          >
            Hinzufuegen
          </button>
        ) : (
          <span className="text-xs text-gray-400">Bereits ein aktives Abonnement vorhanden</span>
        )}
      </div>

      {error && (
        <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-600">{error}</p>
      )}

      {/* Add form */}
      {showAddForm && (
        <form onSubmit={(e) => void handleAddSubmit(e)} className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
          <p className="text-xs font-medium text-gray-600 mb-2">Neues Abonnement</p>

          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Betrag (CHF/Monat)</label>
              <input
                type="number"
                min={0}
                step={0.5}
                required
                value={addAmount}
                onChange={(e) => setAddAmount(e.target.value)}
                className="rounded border border-gray-300 px-2 py-1 text-sm w-28"
                placeholder="z.B. 50"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Laufzeit</label>
              <select
                value={addDuration}
                onChange={(e) => setAddDuration(e.target.value as "1" | "6")}
                className="rounded border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="1">1 Monat</option>
                <option value="6">6 Monate</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Zahlungsmethode</label>
              <select
                value={addBillingMethod}
                onChange={(e) => setAddBillingMethod(e.target.value as "invoice" | "direct")}
                className="rounded border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="invoice">Rechnung</option>
                <option value="direct">Ueberweisung</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Startmonat</label>
              <select
                value={addStartMonth}
                onChange={(e) => setAddStartMonth(Number(e.target.value))}
                className="rounded border border-gray-300 px-2 py-1 text-sm"
              >
                {monthOptions.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Startjahr</label>
              <input
                type="number"
                required
                value={addStartYear}
                onChange={(e) => setAddStartYear(Number(e.target.value))}
                className="rounded border border-gray-300 px-2 py-1 text-sm w-24"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-[#4A7FC1] px-3 py-1 text-xs text-white hover:bg-[#3a6fb1] disabled:opacity-50"
            >
              {saving ? "Speichere..." : "Hinzufuegen"}
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-xs text-gray-500 hover:underline"
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}

      {/* Subscription list */}
      {subscriptions.length === 0 && !showAddForm && (
        <p className="text-xs text-gray-400">Kein Abonnement vorhanden.</p>
      )}

      <div className="space-y-3">
        {subscriptions.map((sub) => {
          const chargeRows = buildChargeRows(sub, sub.charges);
          const remaining = monthsRemaining(sub);
          const allScheduled = chargeRows.length > 0 && chargeRows.every((r) => r.status === "scheduled");
          const isEditing = editingId === sub.id;

          return (
            <div key={sub.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Status badge */}
                  {sub.active ? (
                    <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700">
                      Aktiv
                    </span>
                  ) : (
                    <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500">
                      Inaktiv
                    </span>
                  )}
                  <span className="text-sm text-gray-800">{formatCHF(sub.amountCHF)}/Monat</span>
                  <span className="text-xs text-gray-500">
                    {sub.billingMethod === "direct" ? "Ueberweisung (sofort bezahlt)" : "Rechnung"}
                  </span>
                  <span className="text-xs text-gray-500">
                    {remaining > 0 ? `${remaining} Monate verbleibend` : "Abgelaufen"}
                  </span>
                </div>

                {!isEditing && (
                  <div className="flex flex-wrap gap-2">
                    {sub.active && (
                      <>
                        <button
                          type="button"
                          onClick={() => openEditForm(sub)}
                          className="text-xs text-[#4A7FC1] hover:underline"
                          disabled={saving}
                        >
                          Bearbeiten
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeactivate(sub.id)}
                          className="text-xs text-red-500 hover:underline"
                          disabled={saving}
                        >
                          Deaktivieren
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleDelete(sub.id)}
                      className="text-xs text-red-600 hover:underline font-medium"
                      disabled={saving}
                    >
                      Loeschen
                    </button>
                  </div>
                )}
              </div>

              {/* Inline edit form */}
              {isEditing && (
                <div className="mt-2 flex flex-wrap gap-3 items-end rounded bg-white border border-gray-200 p-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500">Betrag (CHF/Monat)</label>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      className="rounded border border-gray-300 px-2 py-1 text-sm w-28"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500">Zahlungsmethode</label>
                    <select
                      value={editBillingMethod}
                      onChange={(e) => setEditBillingMethod(e.target.value as "invoice" | "direct")}
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                    >
                      <option value="invoice">Rechnung</option>
                      <option value="direct">Ueberweisung</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => void handleEditSave(sub.id)}
                      disabled={saving}
                      className="rounded bg-[#4A7FC1] px-3 py-1 text-xs text-white hover:bg-[#3a6fb1] disabled:opacity-50"
                    >
                      {saving ? "Speichere..." : "Speichern"}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-xs text-gray-500 hover:underline"
                    >
                      Abbrechen
                    </button>
                  </div>
                </div>
              )}

              {/* Charge rows table */}
              {chargeRows.length > 0 && (
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-500">
                        <th className="py-1 pr-4">Monat</th>
                        <th className="py-1 pr-4">Betrag</th>
                        <th className="py-1">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {chargeRows.map((row) => (
                        <tr key={`${row.year}-${row.month}`}>
                          <td className="py-1 pr-4">
                            {getMonthLabel(row.month)} {row.year}
                          </td>
                          <td className="py-1 pr-4">
                            {formatCHF(sub.amountCHF)}
                          </td>
                          <td className="py-1">
                            {row.status === "paid" && (
                              <span className="rounded-full px-2 py-0.5 font-medium bg-green-100 text-green-700">
                                Bezahlt
                              </span>
                            )}
                            {row.status === "unpaid" && (
                              <span className="rounded-full px-2 py-0.5 font-medium bg-red-100 text-red-600">
                                Ausstehend
                              </span>
                            )}
                            {row.status === "scheduled" && (
                              <span className="rounded-full px-2 py-0.5 font-medium bg-gray-100 text-gray-500">
                                Geplant
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {sub.billingMethod === "direct" ? (
                    <p className="mt-1 text-xs text-green-800 bg-green-50 border border-green-100 rounded px-2 py-1">
                      Direktzahlung: Monatsliste gruen (bezahlt). Kein Abo auf Schueler-Rechnung/PDF — Einkommen nur in
                      deiner Auswertung (Dashboard, Diagramme).
                    </p>
                  ) : (
                    allScheduled && (
                      <p className="mt-1 text-xs text-gray-400">
                        Abrechnungen werden bei Rechnungserstellung erstellt.
                      </p>
                    )
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
