"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { DashboardShell } from "@/components/DashboardShell";
import { Tutor24Followup } from "@/components/Tutor24Followup";
import { useGlobalIncomeSummary } from "@/hooks/useGlobalIncomeSummary";

/** ?course=<id>: "Kurs anlegen" im Nachfassen-Tab springt mit dem neuen Kurs ausgewaehlt hierher. */
function Courses() {
  const course = useSearchParams()?.get("course") ?? null;
  return <Tutor24Followup key={course ?? "kurse"} view="kurse" focusCourse={course} />;
}

export default function KursePage() {
  const { monthIncome, ytdIncome, loading: incomeLoading } = useGlobalIncomeSummary();
  return (
    <DashboardShell monthIncome={monthIncome} ytdIncome={ytdIncome} incomeLoading={incomeLoading}>
      {/* useSearchParams braucht in Next 14 eine Suspense-Grenze */}
      <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl border border-blue-100 bg-white" />}>
        <Courses />
      </Suspense>
    </DashboardShell>
  );
}
