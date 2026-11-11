/**
 * Abend-Zusammenfassung (20:00, vom Telegram-Bot verschickt, 11.11.): Durchgaenge des Tages, Rueckfragen
 * (offen, freigegeben, gesendet, uebersprungen, verfallen), Stand der aktiven Kurse, und bis UNKLAR_ZEIGEN_BIS
 * die vollstaendigen Texte der heute als "sicher" gesendeten Nachrichten mit Anrede unklar (Omids Kontrolle).
 */
import { prisma } from "./prisma";
import { daySummary, readPassLog } from "./tutor24-autopilot";
import { capacity, courseStats } from "./tutor24-followup";
import { loadCourses } from "./tutor24-followup-store";
import { loadLog } from "./tutor24-leads";
import { UNKLAR_ZEIGEN_BIS, tagesStand, zurichDay } from "./tutor24-rueckfragen";
import { AGENT_DETAIL_BIS, loadAgentLog, type AgentEintrag } from "./tutor24-pruefagent";

const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;

/** Erster Teil: Zahlen (ohne Datenbank, testbar) */
export function abendText(tag: string, passes = readPassLog(50), stand = tagesStand(tag), courses = loadCourses(), log: Array<Partial<import("./tutor24-followup").LogRow>> = [], now = new Date()): string {
  const rf = `Rückfragen: ${stand.gesendet} gesendet, ${stand.uebersprungen} übersprungen, ${stand.freigegeben} freigegeben (warten auf den nächsten Lauf), ${stand.offen} offen, ${stand.verfallen} verfallen`;
  const kurse = courses
    .filter((c) => c.active)
    .map((c) => {
      const st = courseStats(c, log, now);
      return `• ${c.name}: ${st.zusagen} von ${capacity(c)} angemeldet (mind. ${c.minParticipants}), ${st.angeschrieben} angeschrieben, ${st.geantwortet} geantwortet, Anmeldeschluss ${dm(c.deadline)}`;
    });
  return [daySummary(tag, passes), rf, kurse.length ? `Kurse:\n${kurse.join("\n")}` : "Kurse: keiner aktiv"].join("\n");
}

/** Pruef-Agent: heute durchgelassen/zurueckgehalten mit Grund; erste Woche zusaetzlich die Summe seit Start */
export function agentText(tag: string, eintraege: AgentEintrag[] = loadAgentLog()): string {
  const echt = eintraege.filter((e) => !e.probe);
  if (!echt.length) return "";
  const heute = echt.filter((e) => e.tag === tag);
  const nicht = heute.filter((e) => e.urteil !== "ok");
  const zeilen = [`Prüf-Agent heute: ${heute.length - nicht.length} mit ok durchgelassen, ${nicht.length} zurückgehalten${nicht.length ? ":" : "."}`];
  for (const e of nicht) zeilen.push(`• ${e.art === "erst" ? "Erst-Nachricht" : "Nachfassen"} ${e.titel.slice(0, 50)}: ${e.grund}`);
  if (tag <= AGENT_DETAIL_BIS)
    zeilen.push(
      `Seit Start insgesamt: ${echt.filter((e) => e.urteil === "ok").length} ok, ${echt.filter((e) => e.urteil === "auffaellig").length} auffällig, ` +
        `${echt.filter((e) => e.urteil === "fehler").length} Agent nicht erreichbar.`
    );
  return zeilen.join("\n");
}

/** 2 zufaellig gewaehlte heute gesendete Nachrichten, vollstaendig (Omid schaut ab und zu selbst rein) */
export async function stichprobe(now = new Date(), n = 2): Promise<string[]> {
  const start = new Date(`${zurichDay(now)}T00:00:00+01:00`);
  const rows = await prisma.tutor24Message.findMany({
    where: { status: "gesendet", sentAt: { gte: start } },
    select: { art: true, text: true, lead: { select: { name: true, inseratId: true, conversationId: true } } },
  });
  return rows
    .sort(() => Math.random() - 0.5)
    .slice(0, n)
    .map((r, i, a) => {
      const link = r.lead.conversationId ? `https://www.tutor24.ch/de/conversations/${r.lead.conversationId}?tab=sent` : r.lead.inseratId ? `https://tutor24.ch/de/jobs/${r.lead.inseratId}` : r.lead.name;
      return `🔎 Stichprobe ${i + 1}/${a.length} (${r.art === "erst" ? "Erst-Nachricht" : "Nachfassen"}, heute gesendet)\n${link}\n\n${r.text}`;
    });
}

/** Heute als "sicher" gesendete Erst-Nachrichten mit Anrede unklar (volle Texte), bis UNKLAR_ZEIGEN_BIS */
export async function unklarTexte(now = new Date()): Promise<string[]> {
  if (zurichDay(now) > UNKLAR_ZEIGEN_BIS) return [];
  const start = new Date(`${zurichDay(now)}T00:00:00+01:00`);
  const rows = await prisma.tutor24Message.findMany({
    where: { art: "erst", status: "gesendet", sentAt: { gte: start }, lead: { wer: "unklar" } },
    select: { text: true, lead: { select: { name: true, inseratId: true } } },
    orderBy: { sentAt: "asc" },
  });
  return rows.map((r, i, a) => `Anrede unklar ${i + 1}/${a.length} (heute gesendet)\n${r.lead.inseratId ? `https://tutor24.ch/de/jobs/${r.lead.inseratId}` : r.lead.name}\n\n${r.text}`);
}

export async function abendZusammenfassung(now = new Date()): Promise<{ text: string; texte: string[] }> {
  const tag = zurichDay(now);
  const log = await loadLog().catch(() => []);
  const unklar = await unklarTexte(now).catch(() => []);
  const proben = await stichprobe(now).catch(() => []);
  const agent = agentText(tag);
  const text =
    abendText(tag, readPassLog(50), tagesStand(tag), loadCourses(), log, now) +
    (agent ? `\n\n${agent}` : "") +
    (proben.length ? `\n\n${proben.length} zufällig gewählte gesendete Nachrichten folgen vollständig.` : "") +
    (unklar.length ? `\n\nAnrede unklar gesendet (${unklar.length}): die Texte folgen einzeln.` : "");
  return { text, texte: [...proben, ...unklar] };
}
