"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { formatCHF, getCurrentMonthYear } from "@/lib/ui-format";

type DashboardShellProps = {
  monthIncome: number;
  ytdIncome: number;
  children: React.ReactNode;
};

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/students", label: "Schüler", icon: "👩‍🎓" },
  { href: "/invoices", label: "Rechnungen", icon: "🧾" },
  { href: "/calendar", label: "Google Kalender", icon: "📅" },
  { href: "/sync", label: "Kalender Sync", icon: "🔄" },
  { href: "/settings", label: "Einstellungen", icon: "⚙️" },
];

const AUTO_SYNC_MS = 15 * 60 * 1000;
const LOCK_TTL_MS = 2 * 60 * 1000;
const LAST_SYNC_KEY = "mtg:auto-sync:last";
const LOCK_KEY = "mtg:auto-sync:lock";

export function DashboardShell({ monthIncome, ytdIncome, children }: DashboardShellProps) {
  const pathname = usePathname();
  const tabIdRef = useRef<string>(`tab-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    let mounted = true;

    const releaseLock = () => {
      try {
        const raw = window.localStorage.getItem(LOCK_KEY);
        if (!raw) return;
        const lock = JSON.parse(raw) as { owner: string };
        if (lock.owner === tabIdRef.current) {
          window.localStorage.removeItem(LOCK_KEY);
        }
      } catch {
        // ignore localStorage JSON issues
      }
    };

    const tryAcquireLock = (): boolean => {
      const now = Date.now();
      try {
        const raw = window.localStorage.getItem(LOCK_KEY);
        if (raw) {
          const lock = JSON.parse(raw) as { owner: string; expiresAt: number };
          if (lock.expiresAt > now && lock.owner !== tabIdRef.current) return false;
        }
        window.localStorage.setItem(
          LOCK_KEY,
          JSON.stringify({ owner: tabIdRef.current, expiresAt: now + LOCK_TTL_MS })
        );
        return true;
      } catch {
        // If localStorage is blocked, still allow sync in this tab.
        return true;
      }
    };

    const shouldRunNow = () => {
      try {
        const last = Number(window.localStorage.getItem(LAST_SYNC_KEY) ?? "0");
        return Date.now() - last >= AUTO_SYNC_MS;
      } catch {
        return true;
      }
    };

    const syncCurrentMonth = async () => {
      if (!mounted || document.visibilityState !== "visible") return;
      if (!shouldRunNow()) return;
      if (!tryAcquireLock()) return;

      const { year, month } = getCurrentMonthYear();
      try {
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year, month }),
        });
        if (res.ok) {
          try {
            window.localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
          } catch {
            // ignore localStorage write errors
          }
        }
      } catch {
        // Silent background sync: ignore network errors.
      } finally {
        releaseLock();
      }
    };

    // Keep invoicing/session data near-real-time while app is open.
    // Do it only on primary work views to reduce duplicate traffic.
    const allowAutoSync =
      pathname === "/dashboard" ||
      pathname.startsWith("/students") ||
      pathname.startsWith("/invoices") ||
      pathname === "/sync";

    if (allowAutoSync) void syncCurrentMonth();
    const id = window.setInterval(() => {
      if (!allowAutoSync) return;
      void syncCurrentMonth();
    }, AUTO_SYNC_MS);
    return () => {
      mounted = false;
      window.clearInterval(id);
      releaseLock();
    };
  }, [pathname]);

  return (
    <div className="min-h-screen min-w-0 bg-[#F0F5FF]">
      <div className="mx-auto min-w-0 max-w-7xl space-y-4 px-3 py-4 sm:space-y-5 sm:px-5 sm:py-5">
        <nav className="rounded-2xl border border-blue-100 bg-white p-3 shadow-sm">
          <p className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Navigation</p>
          <ul className="flex flex-wrap gap-1.5">
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
                    <span className="min-w-0 leading-snug">{item.label}</span>
                    {active && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-[#4A7FC1]" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[#4A7FC1]">Dieser Monat</p>
            <p className="mt-0.5 text-lg font-bold text-[#4A7FC1]">{formatCHF(monthIncome)}</p>
          </div>
          <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[#7B6CB5]">Jahr gesamt</p>
            <p className="mt-0.5 text-lg font-bold text-[#7B6CB5]">{formatCHF(ytdIncome)}</p>
          </div>
        </section>

        <main className="min-w-0 max-w-full">{children}</main>
      </div>
    </div>
  );
}
