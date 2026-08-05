"use client";

import { useCallback, useEffect, useState } from "react";
import { formatAmount, formatDate } from "@/lib/invoice-format";

/** Offene Löschvormerkung aus /api/sessions/pending-deletion. */
type PendingDeletionRow = {
  id: string;
  date: string;
  durationMin: number;
  amountCHF: number;
  studentName: string;
  reason: string;
  monthDelivered: boolean;
};

/**
 * Stehendes Band fuer offene Loeschvormerkungen. Bewusst ganz oben und
 * nicht ausklappbar: die Lektionen zaehlen weiter zum Betrag, bis hier
 * entschieden wird. Verschwindet erst, wenn nichts mehr offen ist.
 *
 * Steht auf Dashboard und Rechnungen — der Sync laeuft auf dem Dashboard,
 * also muss der Entscheid dort direkt moeglich sein.
 */
export function PendingDeletionBanner({
  refreshKey,
  onResolved,
}: {
  /** Hochzaehlen (z.B. nach einem Sync), um neu zu laden. */
  refreshKey?: number;
  /** Nach einem Entscheid: die Seite ihre eigenen Daten nachladen lassen. */
  onResolved?: () => void;
}) {
  const [rows, setRows] = useState<PendingDeletionRow[]>([]);
  const [totalCHF, setTotalCHF] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/sessions/pending-deletion");
      if (!r.ok) return;
      const body = (await r.json()) as { rows?: PendingDeletionRow[]; totalCHF?: number };
      setRows(Array.isArray(body.rows) ? body.rows : []);
      setTotalCHF(typeof body.totalCHF === "number" ? body.totalCHF : 0);
    } catch {
      // Das Band ist eine Warnung, kein Kerninhalt — ein Fehlschlag darf die Seite nicht stören.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  /** Entscheid über Vormerkungen; danach Band und Seite neu laden. */
  const resolve = async (action: "confirm" | "reject", sessionIds: string[]) => {
    if (sessionIds.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/sessions/pending-deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sessionIds }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        blockedByDelivered?: { studentName: string }[];
      };
      if (res.redirected || !res.ok) {
        alert(
          res.redirected
            ? "Sitzung abgelaufen — bitte neu anmelden."
            : (body.error ?? "Aktion fehlgeschlagen.")
        );
        return;
      }
      if ((body.blockedByDelivered?.length ?? 0) > 0) {
        alert(
          `${body.blockedByDelivered!.length} Lektion(en) wurden NICHT gelöscht, weil die Rechnung ` +
            `des Monats inzwischen ausgeliefert ist. Die Vormerkung ist aufgehoben; die Abweichung ` +
            `wird über die Abweichungserkennung gemeldet.`
        );
      }
      await load();
      onResolved?.();
    } catch {
      alert("Aktion fehlgeschlagen — keine Änderung vorgenommen.");
    } finally {
      setBusy(false);
    }
  };

  if (rows.length === 0) return null;

  return (
    <section className="rounded-2xl border-2 border-red-300 bg-red-50 p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-red-900">
          ⚠ {rows.length} Lektion{rows.length === 1 ? "" : "en"} sollen entfernt werden
        </h2>
        <span className="text-sm font-semibold text-red-900">{formatAmount(totalCHF)}</span>
      </div>
      <p className="mt-1 text-sm text-red-800">
        Sie zählen weiter zum Betrag, bis du entscheidest.
      </p>

      <ul className="mt-3 space-y-1.5">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-col gap-2 rounded-xl bg-white/70 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="font-medium text-gray-900">{formatDate(new Date(row.date))}</span>
              <span className="text-gray-700">{row.studentName}</span>
              <span className="text-gray-500">{row.durationMin} Min</span>
              <span className="font-semibold text-gray-900">{formatAmount(row.amountCHF)}</span>
              <span className="text-xs text-gray-500">{row.reason}</span>
              {row.monthDelivered ? (
                <span
                  className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900"
                  title="Der Monat ist ausgeliefert — bestätigen löscht hier nicht, sondern gibt den Fall an die Abweichungserkennung."
                >
                  Monat ausgeliefert
                </span>
              ) : null}
            </span>
            <span className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void resolve("confirm", [row.id])}
                className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-40"
              >
                Entfernen
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void resolve("reject", [row.id])}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 transition hover:border-gray-400 disabled:opacity-40"
              >
                Behalten
              </button>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void resolve("confirm", rows.map((r) => r.id))}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-40"
        >
          {busy ? "Läuft…" : `Alle ${rows.length} entfernen`}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void resolve("reject", rows.map((r) => r.id))}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:border-gray-400 disabled:opacity-40"
        >
          Alle behalten
        </button>
      </div>
    </section>
  );
}
