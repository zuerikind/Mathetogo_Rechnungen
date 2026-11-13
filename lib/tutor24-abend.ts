/**
 * TAGESBERICHT (20:00, vom Telegram-Bot, neu 13.11.): kurz. Erste Zeile "✅ Alles in Ordnung" oder
 * "⚠️ Handlung nötig: …", dann gesendet heute, Antworten, vom Agenten zurueckgehalten, Durchgaenge gelaufen ja/nein,
 * 2 gesendete Nachrichten eingeklappt (Telegram-HTML) und der Link auf /kurse/texte mit allen Texten des Tages.
 */
import { prisma } from "./prisma";
import { APP_URL, type AutoState, type PassLog } from "./tutor24-autopilot";
import { type AgentEintrag } from "./tutor24-pruefagent";
import { zurichDay } from "./tutor24-rueckfragen";

const NACHFASSEN_KNOPF_BIS = "2026-11-26";
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const zurichMin = (iso: string) => {
  const [h, m] = new Date(iso).toLocaleTimeString("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" }).split(":").map(Number);
  return h * 60 + m;
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type Tagesdaten = {
  tag: string;
  passes: PassLog[];
  zeiten: string[];
  state: Pick<AutoState, "modus" | "gestoppt">;
  agent: AgentEintrag[];
  /** Rueckfragen heute verfallen (unbeantwortet, stehen in der Liste auf /kurse) */
  verfallen: number;
};

/** Text ohne Stichproben (testbar, ohne Datenbank) */
export function tagesberichtText(d: Tagesdaten): string {
  const heute = d.passes.filter((p) => zurichDay(new Date(p.start)) === d.tag);
  const geplant = heute.filter((p) => p.quelle !== "run" && p.quelle !== "freigabe" && p.quelle !== "erst");
  const sum = (f: (p: PassLog) => number) => heute.reduce((n, p) => n + f(p), 0);
  const probe = d.state.modus === "probe" || (heute.length > 0 && heute.every((p) => p.modus === "probe"));

  // Durchgang gelaufen: ein (nicht per /run gestarteter) Durchgang ab 30 min vor der Zeit bis vor die naechste Zeit
  const slots = [...d.zeiten].sort();
  const gelaufen = slots.map((t, i) => {
    const von = toMin(t) - 30;
    const bis = i + 1 < slots.length ? toMin(slots[i + 1]) - 30 : 24 * 60;
    return { t, ok: geplant.some((p) => zurichMin(p.start) >= von && zurichMin(p.start) < bis) };
  });

  const echt = d.agent.filter((e) => e.tag === d.tag && !!e.probe === probe);
  const zurueck = echt.filter((e) => e.urteil !== "ok");
  const nf = d.agent.filter((e) => !e.probe && e.art !== "erst" && e.urteil === "auffaellig");

  const handlung: string[] = [];
  if (d.state.modus === "aus" && d.state.gestoppt && !/\/stop/.test(d.state.gestoppt.grund))
    handlung.push(`Automatik gestoppt (${d.state.gestoppt.grund}) — prüfen, dann /enable`);
  if (d.state.modus !== "aus") for (const g of gelaufen.filter((g) => !g.ok)) handlung.push(`Durchgang ${g.t} ist nicht gelaufen`);
  const fehler = sum((p) => p.fehler.length);
  if (fehler) handlung.push(`${fehler} Fehler in den Durchgängen (/kurse → Protokoll)`);
  if (d.verfallen) handlung.push(`${d.verfallen} Rückfrage${d.verfallen === 1 ? "" : "n"} unbeantwortet (Liste auf /kurse)`);
  if (d.tag <= NACHFASSEN_KNOPF_BIS && nf.length > 2 && nf.some((e) => e.tag === d.tag))
    handlung.push(`seit Start ${nf.length} Nachfassen vom Agenten zurückgehalten: Senden-Knopf fürs Nachfassen neu entscheiden`);

  const w = probe ? "würden gesendet" : "gesendet";
  return [
    `📋 TAGESBERICHT ${d.tag.split("-").reverse().join(".")}${probe ? " (PROBE)" : ""}`,
    handlung.length ? `⚠️ Handlung nötig: ${handlung.join("; ")}` : "✅ Alles in Ordnung",
    `${w[0].toUpperCase()}${w.slice(1)}: ${sum((p) => (probe ? p.erst.wuerde : p.erst.gesendet))} Erst-Nachrichten, ${sum((p) => (probe ? p.nachfassen.wuerde : p.nachfassen.gesendet))} Nachfassen`,
    `Antworten: ${sum((p) => p.antworten)}`,
    `Vom Agenten zurückgehalten: ${zurueck.length}${zurueck.length ? `\n${zurueck.map((e) => `• ${e.titel.slice(0, 50)}: ${e.grund}`).join("\n")}` : ""}`,
    `Durchgänge: ${gelaufen.length ? gelaufen.map((g) => `${g.t} ${g.ok ? "ja" : "nein"}`).join(", ") : "keine geplant"}`,
  ].join("\n");
}

/** 2 zufaellige heute gesendete Nachrichten, eingeklappt (Telegram-HTML, blockquote expandable) */
export async function stichprobe(now = new Date(), n = 2): Promise<string[]> {
  const start = new Date(`${zurichDay(now)}T00:00:00+01:00`);
  const rows = await prisma.tutor24Message.findMany({
    where: { status: "gesendet", sentAt: { gte: start } },
    select: { art: true, text: true, lead: { select: { inseratId: true, conversationId: true } } },
  });
  return rows
    .sort(() => Math.random() - 0.5)
    .slice(0, n)
    .map((r) => {
      const link = r.lead.conversationId ? `https://www.tutor24.ch/de/conversations/${r.lead.conversationId}?tab=sent` : r.lead.inseratId ? `https://tutor24.ch/de/jobs/${r.lead.inseratId}` : "";
      return `${r.art === "erst" ? "Erst-Nachricht" : "Nachfassen"} ${esc(link)}\n<blockquote expandable>${esc(r.text.slice(0, 1500))}</blockquote>`;
    });
}

/** Ganze Meldung als Telegram-HTML (eine einzige Nachricht, unter 4096 Zeichen) */
export async function tagesbericht(d: Tagesdaten, now = new Date()): Promise<string> {
  const proben = await stichprobe(now).catch(() => []);
  return [
    esc(tagesberichtText(d)),
    ...(proben.length ? ["", "Zum Reinschauen:", ...proben] : []),
    "",
    `Alle Texte von heute: ${APP_URL}/kurse/texte?tag=${d.tag}`,
  ].join("\n").slice(0, 4090);
}
