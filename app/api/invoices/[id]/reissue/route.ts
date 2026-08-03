import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { reissueInvoice, RevisionError } from "@/lib/invoice-revision";

/** Neuausstellung unter gleicher Nummer — alte Fassung bleibt erhalten (P6). */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await reissueInvoice(params.id, session.user?.email ?? "unbekannt");
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RevisionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Neuausstellung fehlgeschlagen." },
      { status: 500 }
    );
  }
}
