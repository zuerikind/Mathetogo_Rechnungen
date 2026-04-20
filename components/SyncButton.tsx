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
        body: JSON.stringify({ year, month }),
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
      className="rounded-md bg-[#0F6E56] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? "Synchronisiere..." : "Sync from Google Calendar"}
    </button>
  );
}
