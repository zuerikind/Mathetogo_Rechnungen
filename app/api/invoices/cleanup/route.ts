import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { pruneStaleInvoicesInScope } from "@/lib/invoice-stale";

/**
 * Ausdrueckliches Aufraeumen: Entwuerfe ohne abrechenbaren Inhalt entfernen.
 *
 * Lief bisher als Nebenwirkung im GET von /api/invoices — ein Lesezugriff, der
 * Zeilen und PDFs loeschte. Dieselbe Arbeit, aber nur noch auf Zuruf. Die
 * Schutzbedingungen liegen unveraendert in lib/invoice-stale: gesendete,
 * bezahlte und heruntergeladene (also ausgelieferte) Rechnungen werden dort
 * ausgenommen und bleiben es.
 *
 * Der Kalender-Sync ruft dieselbe Funktion weiterhin selbst auf; dieser Endpunkt
 * ist fuer den Fall, dass man ausserhalb eines Syncs aufraeumen will.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    year?: unknown;
    month?: unknown;
    studentIds?: unknown;
  };

  const yearRaw = Number(body.year);
  const monthRaw = Number(body.month);
  const year = Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100 ? yearRaw : undefined;
  const month = Number.isInteger(monthRaw) && monthRaw >= 1 && monthRaw <= 12 ? monthRaw : undefined;
  const studentIds = Array.isArray(body.studentIds)
    ? body.studentIds.filter((v): v is string => typeof v === "string")
    : undefined;

  try {
    const removed = await pruneStaleInvoicesInScope({
      year,
      month,
      studentIds: studentIds?.length ? studentIds : undefined,
    });
    return NextResponse.json({ removed, scope: { year, month, studentIds } });
  } catch (error) {
    // Loeschende Mutation: Fehler wird gemeldet, nicht geschluckt.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Aufraeumen fehlgeschlagen." },
      { status: 500 }
    );
  }
}
