"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { formatCHF } from "@/lib/ui-format";

type DashboardShellProps = {
  monthIncome: number;
  ytdIncome: number;
  /** While sessions/subscriptions for KPIs are still loading */
  incomeLoading?: boolean;
  children: React.ReactNode;
};

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/students", label: "Schüler", icon: "👩‍🎓" },
  { href: "/invoices", label: "Rechnungen", icon: "🧾" },
  { href: "/dance", label: "Dance", icon: "💃" },
  { href: "/calendar", label: "Google Kalender", icon: "📅" },
  { href: "/sync", label: "Kalender Sync", icon: "🔄" },
  { href: "/tutor24", label: "Tutor24", icon: "✉️" },
  { href: "/settings", label: "Einstellungen", icon: "⚙️" },
];

export function DashboardShell({ monthIncome, ytdIncome, incomeLoading = false, children }: DashboardShellProps) {
  const pathname = usePathname();
  const currentPath = pathname ?? "";

  return (
    <div className="min-h-screen min-w-0 bg-slate-100/80">
      <div className="mx-auto min-w-0 max-w-7xl space-y-4 px-3 py-4 sm:space-y-5 sm:px-5 sm:py-5">
        <nav className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm">
          <p className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Navigation</p>
          <ul className="flex flex-wrap gap-1.5">
            {navItems.map((item) => {
              const active = currentPath === item.href || currentPath.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex min-w-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all ${
                      active
                        ? "bg-slate-100 font-semibold text-slate-900 ring-1 ring-slate-200"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <span className="shrink-0 text-base">{item.icon}</span>
                    <span className="min-w-0 leading-snug">{item.label}</span>
                    {active && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-slate-700" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Dieser Monat</p>
            <div className="mt-0.5 min-h-[1.75rem]">
              {incomeLoading ? (
                <LoadingSpinner size={22} label="Laden …" />
              ) : (
                <p className="text-lg font-bold text-slate-900 tabular-nums">{formatCHF(monthIncome)}</p>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Jahr gesamt</p>
            <div className="mt-0.5 min-h-[1.75rem]">
              {incomeLoading ? (
                <LoadingSpinner size={22} label="Laden …" />
              ) : (
                <p className="text-lg font-bold text-slate-900 tabular-nums">{formatCHF(ytdIncome)}</p>
              )}
            </div>
          </div>
        </section>

        <main className="min-w-0 max-w-full">{children}</main>
      </div>
    </div>
  );
}
