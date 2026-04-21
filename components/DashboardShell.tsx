"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatCHF } from "@/lib/ui-format";

type DashboardShellProps = {
  monthIncome: number;
  ytdIncome: number;
  children: React.ReactNode;
};

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/students", label: "Students" },
  { href: "/invoices", label: "Invoices" },
  { href: "/sync", label: "Sync" },
  { href: "/settings", label: "Settings" },
];

export function DashboardShell({ monthIncome, ytdIncome, children }: DashboardShellProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 p-4 md:grid-cols-[260px_1fr]">
        <aside className="rounded-lg border border-gray-200 bg-white p-4">
          <h1 className="text-xl font-bold text-gray-900">Nachhilfe Tracker</h1>
          <nav className="mt-6 space-y-1">
            {navItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block rounded-md px-3 py-2 text-sm ${
                    active ? "bg-blue-50 font-medium text-[#4A7FC1]" : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-8 space-y-4 rounded-md border border-gray-200 bg-gray-50 p-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Current month income</p>
              <p className="text-lg font-semibold text-gray-900">{formatCHF(monthIncome)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Year-to-date income</p>
              <p className="text-lg font-semibold text-gray-900">{formatCHF(ytdIncome)}</p>
            </div>
          </div>
        </aside>

        <main>{children}</main>
      </div>
    </div>
  );
}
