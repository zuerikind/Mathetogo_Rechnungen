"use client";

import { useCallback, useEffect, useReducer } from "react";

export type ReminderTemplates = { stage1: string; stage2: string; stage3: string };
type Status = "idle" | "loading" | "ready" | "error";

/**
 * Ein einziger Fetch der Singleton-Vorlagen, geteilt über einen Modul-Cache:
 * Editor und die vielen Zeilen-Kopierknöpfe lesen dieselben Daten ohne N Requests.
 */
let cache: ReminderTemplates | null = null;
let status: Status = "idle";
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

async function load(force = false) {
  if (!force && (status === "loading" || status === "ready")) return;
  status = "loading";
  emit();
  try {
    const res = await fetch("/api/reminder-templates");
    if (!res.ok) throw new Error("load");
    const body = (await res.json()) as Partial<ReminderTemplates>;
    cache = {
      stage1: body.stage1 ?? "",
      stage2: body.stage2 ?? "",
      stage3: body.stage3 ?? "",
    };
    status = "ready";
  } catch {
    status = "error";
  }
  emit();
}

export function useReminderTemplates() {
  const [, force] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    listeners.add(force);
    void load();
    return () => {
      listeners.delete(force);
    };
  }, []);

  const save = useCallback(async (next: ReminderTemplates) => {
    const res = await fetch("/api/reminder-templates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? "Speichern fehlgeschlagen.");
    }
    const body = (await res.json()) as ReminderTemplates;
    cache = { stage1: body.stage1, stage2: body.stage2, stage3: body.stage3 };
    status = "ready";
    emit();
  }, []);

  const reload = useCallback(() => void load(true), []);

  return { templates: cache, status, ready: status === "ready" && cache !== null, save, reload };
}
