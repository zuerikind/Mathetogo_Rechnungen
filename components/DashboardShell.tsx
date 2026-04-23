"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatCHF } from "@/lib/ui-format";

type DashboardShellProps = {
  monthIncome: number;
  ytdIncome: number;
  children: React.ReactNode;
};

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/students", label: "Schüler", icon: "👩‍🎓" },
  { href: "/invoices", label: "Rechnungen", icon: "🧾" },
  { href: "/sync", label: "Kalender Sync", icon: "🔄" },
  { href: "/settings", label: "Einstellungen", icon: "⚙️" },
];

export function DashboardShell({ monthIncome, ytdIncome, children }: DashboardShellProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen min-w-0 bg-[#F0F5FF]">
      <div className="mx-auto grid min-w-0 max-w-7xl grid-cols-1 gap-4 px-3 py-4 sm:gap-5 sm:px-5 sm:py-5 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
        {/* Sidebar */}
        <aside className="flex min-w-0 flex-col gap-4">
          <div className="hidden rounded-2xl border border-blue-100 bg-white px-4 py-3 shadow-sm md:block">
            <Image
              src="/mathetogo-logo-clean.png"
              alt="Mathetogo"
              width={190}
              height={46}
              className="h-9 w-auto max-w-full"
              priority
            />
          </div>
          <nav className="rounded-2xl border border-blue-100 bg-white p-3 shadow-sm">
            <p className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Navigation</p>
            <ul className="space-y-0.5">
              {navItems.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-all ${
                        active
                          ? "bg-[#EBF4FF] font-semibold text-[#4A7FC1]"
                          : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                      }`}
                    >
                      <span className="shrink-0 text-base">{item.icon}</span>
                      <span className="min-w-0 flex-1 leading-snug">{item.label}</span>
                      {active && (
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#4A7FC1]" />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Stats cards */}
          <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Einnahmen</p>
            <div className="space-y-3">
              <div className="rounded-xl bg-[#EBF4FF] px-3 py-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[#4A7FC1]">Dieser Monat</p>
                <p className="mt-0.5 text-lg font-bold text-[#4A7FC1]">{formatCHF(monthIncome)}</p>
              </div>
              <div className="rounded-xl bg-[#F3F0FF] px-3 py-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[#7B6CB5]">Jahr gesamt</p>
                <p className="mt-0.5 text-lg font-bold text-[#7B6CB5]">{formatCHF(ytdIncome)}</p>
              </div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 max-w-full">{children}</main>
      </div>
    </div>
  );
}
