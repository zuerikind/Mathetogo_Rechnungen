import type { Metadata } from "next";
import Link from "next/link";
import { ReactNode } from "react";
import { signOut } from "@/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nachhilfe Tracker",
  description: "Track tutoring sessions and generate invoices",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>
        <header
          style={{
            background: "#0F6E56",
            color: "white",
            padding: "12px 20px",
            display: "flex",
            gap: 16,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", gap: 16 }}>
            <Link href="/" style={{ color: "white" }}>Dashboard</Link>
            <Link href="/invoices" style={{ color: "white" }}>Rechnungen</Link>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              style={{ color: "white", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}
            >
              Abmelden
            </button>
          </form>
        </header>
        {children}
      </body>
    </html>
  );
}
