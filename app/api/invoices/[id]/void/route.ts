import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { RevisionError, voidInvoice } from "@/lib/invoice-revision";

/**
 * Storno einer ausgelieferten Rechnung — nicht-destruktiv.
 *
 * Nicht zu verwechseln mit POST /api/invoices/void: das entfernt einen
 * Rechnungs-Entwurf samt PDF. Hier bleibt alles bestehen, nur der Status
 * wechselt.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3) {
    return NextResponse.json(
      { error: "Bitte eine Begründung angeben — sie ist der einzige Nachweis, warum storniert wurde." },
      { status: 400 }
    );
  }

  try {
    const result = await voidInvoice(params.id, session.user?.email ?? "unbekannt", reason);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RevisionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Storno fehlgeschlagen." },
      { status: 500 }
    );
  }
}
