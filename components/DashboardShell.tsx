"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  BookOpen,
  CalendarDays,
  LayoutDashboard,
  Mail,
  Music2,
  ReceiptText,
  RefreshCw,
  School,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { formatCHF } from "@/lib/ui-format";

type DashboardShellProps = {
  monthIncome: number;
  ytdIncome: number;
  /** While sessions/subscriptions for KPIs are still loading */
  incomeLoading?: boolean;
  children: React.ReactNode;
};

const navItems: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/students", label: "Schüler", icon: Users },
  { href: "/invoices", label: "Rechnungen", icon: ReceiptText },
  { href: "/dance", label: "Dance", icon: Music2 },
  { href: "/calendar", label: "Google Kalender", icon: CalendarDays },
  { href: "/sync", label: "Kalender Sync", icon: RefreshCw },
  { href: "/tutor24", label: "Tutor24", icon: Mail },
  { href: "/kurse", label: "Kurse", icon: BookOpen },
  { href: "/academigo", label: "Academigo", icon: School },
  { href: "/settings", label: "Einstellungen", icon: Settings },
];

/** Glas-Navigation mit gleitendem Indikator (aus glassy-dashboard übernommen). */
function GlassNav({ currentPath }: { currentPath: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const container = scroller.current;
    const indicator = marker.current;
    if (!container || !indicator) return;
    const adjust = () => {
      const current = container.querySelector<HTMLElement>('[aria-current="page"]');
      if (!current) {
        indicator.style.visibility = "hidden";
        return;
      }
      indicator.style.visibility = "";
      indicator.style.width = `${current.offsetWidth}px`;
      indicator.style.height = `${current.offsetHeight}px`;
      indicator.style.transform = `translate(${current.offsetLeft}px, ${current.offsetTop}px)`;
      indicator.dataset.ready = "true";
    };
    const observer = new ResizeObserver(adjust);
    observer.observe(container);
    container.querySelectorAll("a").forEach((link) => observer.observe(link));
    adjust();
    // Aktiven Punkt auf kleinen Bildschirmen in den sichtbaren Bereich holen
    container.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "center" });
    return () => observer.disconnect();
  }, [currentPath]);

  return (
    <nav className="glass-bar glass-nav p-1.5" aria-label="Hauptnavigation">
      <div ref={scroller} className="glass-nav-scroll">
        <span ref={marker} className="glass-nav-indicator" aria-hidden="true" />
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = currentPath === href || currentPath.startsWith(`${href}/`);
          return (
            <Link key={href} href={href} className="glass-nav-link" aria-current={active ? "page" : undefined}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function Figure({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <div className="glass-panel min-w-0 p-3.5 sm:p-5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</p>
      <div className="mt-1 min-h-[2.25rem]">
        {loading ? (
          <LoadingSpinner size={22} label="Laden …" />
        ) : (
          <p className="glass-figure truncate text-lg sm:text-3xl">{formatCHF(value)}</p>
        )}
      </div>
    </div>
  );
}

export function DashboardShell({ monthIncome, ytdIncome, incomeLoading = false, children }: DashboardShellProps) {
  const pathname = usePathname();
  const currentPath = pathname ?? "";

  return (
    <div className="glass-scope min-h-screen min-w-0">
      <div className="mx-auto min-w-0 max-w-7xl space-y-4 px-3 py-3 sm:space-y-5 sm:px-5 sm:py-4">
        <GlassNav currentPath={currentPath} />

        <section className="glass-stagger grid grid-cols-2 gap-3">
          <Figure label="Dieser Monat" value={monthIncome} loading={incomeLoading} />
          <Figure label="Jahr gesamt" value={ytdIncome} loading={incomeLoading} />
        </section>

        <main className="min-w-0 max-w-full">{children}</main>
      </div>
    </div>
  );
}
