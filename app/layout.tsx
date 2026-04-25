import type { Metadata } from "next";
import Image from "next/image";
import { ReactNode } from "react";
import { signOut } from "@/auth";
import { NavigationProgress } from "@/components/NavigationProgress";
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
        <header className="sticky top-0 z-50 border-b border-blue-100 bg-white/80 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
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
                className="shrink-0 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition hover:border-red-200 hover:text-red-600 sm:px-4"
              >
                Abmelden
              </button>
            </form>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
