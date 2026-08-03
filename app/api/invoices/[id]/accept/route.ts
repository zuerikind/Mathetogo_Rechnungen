import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { acceptInvoiceChanges, RevisionError } from "@/lib/invoice-revision";

/** "Original bleibt gültig": Alarm weg, Spur bleibt im Audit-Log (P6/P7). */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await acceptInvoiceChanges(params.id, session.user?.email ?? "unbekannt");
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RevisionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Entscheid fehlgeschlagen." },
      { status: 500 }
    );
  }
}
