"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { SubscriptionSection } from "@/components/SubscriptionSection";
import { formatCHF, formatDate, formatDuration, monthOptions } from "@/lib/ui-format";
import type { PlatformSubscriptionWithCharges, SessionWithStudent, Student } from "@/lib/ui-types";

export default function StudentDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : params.id?.[0] ?? "";

  const [student, setStudent] = useState<Student | null>(null);
  const [allSessions, setAllSessions] = useState<SessionWithStudent[]>([]);
  const [subscriptions, setSubscriptions] = useState<PlatformSubscriptionWithCharges[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      setError("Ungueltige Schueler-ID.");
      return;
    }
    try {
      setLoading(true);
      setError("");
      const [studentRes, sessionsRes, subscriptionsRes] = await Promise.all([
        fetch(`/api/students/${id}`),
        fetch(`/api/sessions?studentId=${encodeURIComponent(id)}`),
        fetch(`/api/subscriptions?studentId=${encodeURIComponent(id)}`),
      ]);
      if (!studentRes.ok || !sessionsRes.ok || !subscriptionsRes.ok) throw new Error("load failed");
      setStudent((await studentRes.json()) as Student);
      setAllSessions((await sessionsRes.json()) as SessionWithStudent[]);
      setSubscriptions((await subscriptionsRes.json()) as PlatformSubscriptionWithCharges[]);
    } catch {
      setError("Fehler beim Laden.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const sessionsForYear = useMemo(
    () => allSessions.filter((s) => s.year === year),
    [allSessions, year]
  );

  const now = new Date();
  const monthIncome = allSessions
    .filter((s) => s.month === now.getMonth() + 1 && s.year === now.getFullYear())
    .reduce((acc, s) => acc + s.amountCHF, 0);
  const ytd = sessionsForYear.reduce((acc, s) => acc + s.amountCHF, 0);

  const monthBreakdown = useMemo(() => {
    return monthOptions.map((m) => {
      const rows = sessionsForYear.filter((s) => s.month === m.value);
      const totalMinutes = rows.reduce((acc, s) => acc + s.durationMin, 0);
      const totalCHF = rows.reduce((acc, s) => acc + s.amountCHF, 0);
      return { month: m, sessions: rows.length, hours: totalMinutes / 60, chf: totalCHF };
    });
  }, [sessionsForYear]);

  const totalAllTime = allSessions.reduce((acc, s) => acc + s.amountCHF, 0);

  return (
    <DashboardShell monthIncome={monthIncome} ytdIncome={ytd}>
      {loading ? (
        <div className="h-96 animate-pulse rounded-lg border border-gray-200 bg-white" />
      ) : error || !student ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error || "Student nicht gefunden"}{" "}
          <button className="underline" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <header className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="text-xl font-semibold text-gray-900">{student.name}</h2>
            <p className="mt-1 text-sm text-gray-600">
              {student.subject} · {student.ratePerMin.toFixed(2)} CHF/min · Total earned all time:{" "}
              {formatCHF(totalAllTime)}
            </p>
          </header>

          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-sm text-gray-600">Year</span>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="rounded-md border border-gray-300 px-3 py-1 text-sm"
              >
                {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <h3 className="mb-2 text-sm font-medium text-gray-700">Monthly breakdown</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2">Month</th>
                    <th className="py-2">Sessions</th>
                    <th className="py-2">Hours</th>
                    <th className="py-2">CHF</th>
                    <th className="py-2">Invoice</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {monthBreakdown.map((m) => (
                    <tr key={m.month.value}>
                      <td className="py-2">{m.month.label}</td>
                      <td className="py-2">{m.sessions}</td>
                      <td className="py-2">{m.hours.toFixed(2)}</td>
                      <td className="py-2">{formatCHF(m.chf)}</td>
                      <td className="py-2">
                        <Link
                          href={`/invoice/${student.id}/${year}/${m.month.value}`}
                          className="text-[#4A7FC1] underline"
                        >
                          Generate Invoice
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-2 text-sm font-medium text-gray-700">Full session history</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2">Date</th>
                    <th className="py-2">Duration</th>
                    <th className="py-2">CHF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sessionsForYear.map((s) => (
                    <tr key={s.id}>
                      <td className="py-2">{formatDate(s.date)}</td>
                      <td className="py-2">{formatDuration(s.durationMin)}</td>
                      <td className="py-2">{formatCHF(s.amountCHF)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <SubscriptionSection studentId={id} initialSubscriptions={subscriptions} />
        </div>
      )}
    </DashboardShell>
  );
}
