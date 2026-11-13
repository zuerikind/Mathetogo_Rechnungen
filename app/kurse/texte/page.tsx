import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Texte zum Nachlesen (13.11., Link aus Telegram): ?lauf=<id> = alle Erst-Nachrichten eines Probe-Durchgangs
 * (tutor24_run.daten.texte), ?tag=YYYY-MM-DD = an diesem Tag gesendete Nachrichten. Login wie alle Seiten (middleware).
 */
export default async function TextePage({ searchParams }: { searchParams: { lauf?: string; tag?: string } }) {
  let titel = "";
  let texte: string[] = [];
  if (searchParams.lauf) {
    const run = await prisma.tutor24Run.findUnique({ where: { id: searchParams.lauf } });
    const d = (run?.daten ?? {}) as { texte?: string[] };
    titel = run ? `Probe-Durchgang ${run.startedAt.toLocaleString("de-CH", { timeZone: "Europe/Zurich" })} · ${run.ergebnis}` : "Durchgang nicht gefunden";
    texte = d.texte ?? [];
  } else if (searchParams.tag && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.tag)) {
    const start = new Date(`${searchParams.tag}T00:00:00+01:00`);
    const rows = await prisma.tutor24Message.findMany({
      where: { status: "gesendet", sentAt: { gte: start, lt: new Date(start.getTime() + 86_400_000) } },
      include: { lead: { select: { inseratId: true, conversationId: true, name: true } } },
      orderBy: { sentAt: "asc" },
    });
    titel = `Gesendet am ${searchParams.tag.split("-").reverse().join(".")} (${rows.length})`;
    texte = rows.map((r) => {
      const link = r.lead.conversationId ? `https://www.tutor24.ch/de/conversations/${r.lead.conversationId}?tab=sent` : r.lead.inseratId ? `https://tutor24.ch/de/jobs/${r.lead.inseratId}` : r.lead.name;
      return `${r.art === "erst" ? "Erst-Nachricht" : "Nachfassen"} · ${r.sentAt.toLocaleTimeString("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" })}\n${link}\n\n${r.text}`;
    });
  } else titel = "Kein Durchgang und kein Tag angegeben";

  return (
    <main className="mx-auto max-w-3xl space-y-4 bg-white px-4 py-6 text-gray-900">
      <h1 className="text-lg font-bold">{titel}</h1>
      {!texte.length && <p className="text-sm text-gray-500">Keine Texte.</p>}
      {texte.map((t, i) => (
        <pre key={i} className="whitespace-pre-wrap break-words rounded-xl border border-gray-200 bg-gray-50 p-4 font-sans text-sm leading-relaxed">
          {`${i + 1}/${texte.length} · ${t}`}
        </pre>
      ))}
    </main>
  );
}
