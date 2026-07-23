"use client";

import { useState } from "react";
import { useReminderTemplates } from "@/hooks/useReminderTemplates";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { renderReminder, type ReminderTokenInput } from "@/lib/reminder-tokens";

/** Nur die Felder, die für die Token-Ersetzung einer Zeile gebraucht werden. */
export type ReminderRow = {
  studentName: string;
  invoiceNumber: string;
  totalCHF: number;
  year: number;
  month: number;
};

type Stage = 1 | 2 | 3;

const STAGE_LABELS: Record<Stage, string> = { 1: "1. Erinnerung", 2: "2. Erinnerung", 3: "Mahnung" };

export function ReminderCopyButtons({ row }: { row: ReminderRow }) {
  const { templates, status, ready } = useReminderTemplates();
  const { state, copy } = useCopyToClipboard();
  // Zuletzt kopierte Stufe bleibt markiert (setzt sich nicht nach dem 2s-Flash zurück).
  const [copiedStage, setCopiedStage] = useState<Stage | null>(null);

  const input: ReminderTokenInput = {
    name: row.studentName,
    totalCHF: row.totalCHF,
    invoiceNumber: row.invoiceNumber,
    month: row.month,
    year: row.year,
  };

  async function onCopy(stage: Stage) {
    // Kein Kopieren, wenn die Vorlagen nicht geladen sind — nie einen leeren String kopieren.
    if (!ready || !templates) return;
    const kind = await copy(String(stage), renderReminder(templates[`stage${stage}`], input));
    if (kind === "ok") setCopiedStage(stage);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1.5">
        {([1, 2, 3] as Stage[]).map((stage) => {
          const flashing = state?.key === String(stage);
          const copied = copiedStage === stage;
          const cls =
            flashing && state?.kind === "ok"
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : flashing && state?.kind === "error"
                ? "border-red-300 bg-red-50 text-red-700"
                : copied
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-800";
          return (
            <button
              key={stage}
              type="button"
              disabled={!ready}
              title={ready ? `${STAGE_LABELS[stage]} in die Zwischenablage kopieren` : "Vorlagen nicht geladen"}
              onClick={() => void onCopy(stage)}
              className={`rounded-lg border px-2 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${cls}`}
            >
              {flashing && state?.kind === "ok"
                ? "Kopiert ✓"
                : flashing && state?.kind === "error"
                  ? "Fehler ✕"
                  : copied
                    ? `${stage} ✓`
                    : stage}
            </button>
          );
        })}
      </div>
      {status === "error" && (
        <span className="text-[10px] text-red-600">Vorlagen konnten nicht geladen werden.</span>
      )}
    </div>
  );
}
