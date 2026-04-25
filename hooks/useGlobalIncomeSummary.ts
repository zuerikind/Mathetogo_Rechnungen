"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export function useGlobalIncomeSummary() {
  const now = useMemo(() => new Date(), []);
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [monthIncome, setMonthIncome] = useState(0);
  const [ytdIncome, setYtdIncome] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch(`/api/income-summary?year=${year}&month=${month}`);
      if (!res.ok) throw new Error("income-summary");
      const body = (await res.json()) as { monthIncome?: number; ytdIncome?: number };
      setMonthIncome(Number.isFinite(body.monthIncome) ? Number(body.monthIncome) : 0);
      setYtdIncome(Number.isFinite(body.ytdIncome) ? Number(body.ytdIncome) : 0);
    } catch {
      setError("Einkommen konnte nicht geladen werden.");
      setMonthIncome(0);
      setYtdIncome(0);
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    void load();
  }, [load]);

  return { monthIncome, ytdIncome, loading, error, refresh: load };
}
