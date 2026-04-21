import type { Metadata } from "next";
import Image from "next/image";
import { ReactNode } from "react";
import { signOut } from "@/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mathetogo",
  description: "Track tutoring sessions and generate invoices",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>
        <header className="sticky top-0 z-50 border-b border-blue-100 bg-white/80 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <Image
                src="/mathetogo-logo-clean.png"
                alt="Mathetogo"
                width={170}
                height={40}
                className="h-8 w-auto"
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
                className="rounded-full border border-gray-200 bg-white px-4 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition hover:border-red-200 hover:text-red-600"
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
