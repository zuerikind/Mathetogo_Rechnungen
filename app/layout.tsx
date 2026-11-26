import type { Metadata } from "next";
import Image from "next/image";
import { ReactNode } from "react";
import { signOut } from "@/auth";
import { NavigationProgress } from "@/components/NavigationProgress";
import "@fontsource-variable/manrope";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mathetogo",
  description: "Track tutoring sessions and generate invoices",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>
        <NavigationProgress />
        <div className="glass-backdrop" aria-hidden="true" />
        <div className="glass-header-wrap">
          <header className="glass-bar mx-auto flex max-w-7xl items-center justify-between gap-2 py-1.5 pl-4 pr-1.5 sm:pl-5">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
              <Image
                src="/mathetogo-logo-clean.png"
                alt="Mathetogo"
                width={170}
                height={40}
                className="h-7 w-auto max-w-[min(100%,9.5rem)] shrink-0 sm:h-8 sm:max-w-none"
                priority
              />
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                className="glass-control shrink-0 rounded-full border px-4 py-2 text-xs font-semibold text-slate-700 transition hover:text-red-600"
              >
                Abmelden
              </button>
            </form>
          </header>
        </div>
        {children}
      </body>
    </html>
  );
}
