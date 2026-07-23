"use client";

import { useCallback, useRef, useState } from "react";

export type CopyKind = "ok" | "error";
export type CopyState = { key: string; kind: CopyKind } | null;

/**
 * Gemeinsame Zwischenablage-Logik: try/catch, Guard für fehlende API
 * (unsicherer Kontext / verweigerte Berechtigung) und ein "key"-basierter
 * Flash-Zustand ("ok"/"error"), der nach resetMs zurückgesetzt wird.
 */
export function useCopyToClipboard(resetMs = 2000) {
  const [state, setState] = useState<CopyState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (key: string, text: string): Promise<CopyKind> => {
      let kind: CopyKind;
      try {
        if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
        await navigator.clipboard.writeText(text);
        kind = "ok";
      } catch {
        kind = "error";
      }
      setState({ key, kind });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setState((s) => (s && s.key === key ? null : s));
      }, resetMs);
      return kind;
    },
    [resetMs]
  );

  return { state, copy };
}
