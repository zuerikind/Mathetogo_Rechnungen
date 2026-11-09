"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DashboardShell } from "@/components/DashboardShell";
import { Tutor24Followup, type KurseTab } from "@/components/Tutor24Followup";
import { InterestList } from "@/components/InterestList";
import { BatchPanel } from "@/components/BatchPanel";
import { useGlobalIncomeSummary } from "@/hooks/useGlobalIncomeSummary";

const TABS: Array<[KurseTab, string]> = [
  ["uebersicht", "Übersicht"],
  ["batch", "Batch"],
  ["kurse", "Kurse"],
  ["interessenten", "Interessenten"],
  ["einstellungen", "Einstellungen"],
  ["protokoll", "Protokoll"],
];
const isTab = (h: string): h is KurseTab => TABS.some(([t]) => t === h);

/**
 * /kurse: Reiter Übersicht · Batch · Kurse · Interessenten · Einstellungen · Protokoll (#hash merkt den Reiter).
 * ?course=<id>: "Kurs anlegen" im Nachfassen-Tab von /tutor24 springt direkt auf die Kursseite.
 * Tutor24Followup bleibt ueber alle Reiter hinweg geladen: ungespeicherte Eingaben gehen beim Wechsel nicht verloren.
 */
function Courses() {
  const course = useSearchParams()?.get("course") ?? null;
  const [tab, setTabState] = useState<KurseTab>(course ? "kurse" : "uebersicht");
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1);
      if (isTab(h)) setTabState(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const setTab = (t: KurseTab) => {
    setTabState(t);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${t}`);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Kurse &amp; Automatik</h1>
        <nav className="mt-3 overflow-x-auto border-b border-gray-200" aria-label="Bereiche">
          <ul className="flex min-w-max gap-1" role="tablist">
            {TABS.map(([t, label]) => (
              <li key={t}>
                <button
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`border-b-2 px-3 py-2.5 text-sm font-semibold ${tab === t ? "border-[#4A7FC1] text-gray-900" : "border-transparent text-gray-500 hover:text-gray-800"}`}
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <Tutor24Followup key={course ?? "kurse"} view="kurse" tab={tab} onTab={setTab} focusCourse={course} />
      {tab === "interessenten" && <InterestList />}
      {tab === "batch" && <BatchPanel />}
    </div>
  );
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
