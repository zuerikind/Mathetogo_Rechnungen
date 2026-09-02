"use client";

import { useState } from "react";
import type { SyncResponse } from "@/lib/ui-types";

type SyncButtonProps = {
  year: number;
  month: number;
  onSynced: (result: SyncResponse) => void;
};

export function SyncButton({ year, month, onSynced }: SyncButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleSync = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Die alte Waisen-Bereinigung ist abgeschaltet: keine Loeschvormerkungen
        // mehr und kein Aufraeumen von Entwurfsrechnungen. Im Kalender geloeschte
        // Termine laufen ausschliesslich ueber die neue Soft-Stornierung, die
        // unabhaengig von diesem Schalter arbeitet — sie storniert weich statt zu
        // loeschen, nimmt Vergangenes und Fakturiertes aus und hebt sich selbst
        // auf, sobald der Termin wieder auftaucht.
        //
        // Bewusst ausgeschrieben statt weggelassen: der Server leitet
        // `allowPruneOrphans` mit `pruneOrphans === true` ab, ein fehlendes Feld
        // waere also ebenfalls false. Aber ein Schalter, der stillschweigend
        // durch Abwesenheit wirkt, laedt dazu ein, ihn versehentlich wieder zu
        // setzen. Hier steht, was gilt.
        body: JSON.stringify({ year, month, pruneOrphans: false }),
      });
      const json = (await res.json()) as SyncResponse & { error?: string };
      if (!res.ok) {
        onSynced({
          synced: 0,
          skipped: 0,
          unmatched: [],
          clientError: json.error ?? `Sync fehlgeschlagen (HTTP ${res.status}).`,
        });
        return;
      }
      onSynced(json);
    } catch {
      onSynced({
        synced: 0,
        skipped: 0,
        unmatched: [],
        clientError: "Netzwerkfehler oder ungueltige Antwort.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleSync}
      disabled={loading}
      className="rounded-xl bg-[#4A7FC1] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? "Synchronisiere..." : "Sync from Google Calendar"}
    </button>
  );
}
