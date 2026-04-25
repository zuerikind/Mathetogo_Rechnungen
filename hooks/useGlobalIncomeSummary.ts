"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type IncomeSummary = {
  monthIncome: number;
  ytdIncome: number;
};

const SUMMARY_TTL_MS = 15_000;
const summaryCache = new Map<string, { at: number; value: IncomeSummary }>();
const inFlight = new Map<string, Promise<IncomeSummary>>();

export function useGlobalIncomeSummary() {
  const now = useMemo(() => new Date(), []);
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [monthIncome, setMonthIncome] = useState(0);
  const [ytdIncome, setYtdIncome] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const key = `${year}-${month}`;
  const load = useCallback(async () => {
    try {
      const cached = summaryCache.get(key);
      if (cached && Date.now() - cached.at < SUMMARY_TTL_MS) {
        setMonthIncome(cached.value.monthIncome);
        setYtdIncome(cached.value.ytdIncome);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      let req = inFlight.get(key);
      if (!req) {
        req = fetch(`/api/income-summary?year=${year}&month=${month}`)
          .then(async (res) => {
            if (!res.ok) throw new Error("income-summary");
            const body = (await res.json()) as { monthIncome?: number; ytdIncome?: number };
            return {
              monthIncome: Number.isFinite(body.monthIncome) ? Number(body.monthIncome) : 0,
              ytdIncome: Number.isFinite(body.ytdIncome) ? Number(body.ytdIncome) : 0,
            };
          })
          .finally(() => {
            inFlight.delete(key);
          });
        inFlight.set(key, req);
      }
      const value = await req;
      summaryCache.set(key, { at: Date.now(), value });
      setMonthIncome(value.monthIncome);
      setYtdIncome(value.ytdIncome);
    } catch {
      setError("Einkommen konnte nicht geladen werden.");
      setMonthIncome(0);
      setYtdIncome(0);
    } finally {
      setLoading(false);
    }
  }, [key, month, year]);

  useEffect(() => {
    void load();
  }, [load]);

  return { monthIncome, ytdIncome, loading, error, refresh: load };
}
