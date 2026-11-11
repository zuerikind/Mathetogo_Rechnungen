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

/** Heute als "sicher" gesendete Erst-Nachrichten mit Anrede unklar (volle Texte), bis UNKLAR_ZEIGEN_BIS */
export async function unklarTexte(now = new Date()): Promise<string[]> {
  if (zurichDay(now) > UNKLAR_ZEIGEN_BIS) return [];
  const start = new Date(`${zurichDay(now)}T00:00:00+01:00`);
  const rows = await prisma.tutor24Message.findMany({
    where: { art: "erst", status: "gesendet", sentAt: { gte: start }, lead: { wer: "unklar" } },
    select: { text: true, lead: { select: { name: true, inseratId: true } } },
    orderBy: { sentAt: "asc" },
  });
  return rows.map((r) => `${r.lead.inseratId ? `https://tutor24.ch/de/jobs/${r.lead.inseratId}` : r.lead.name}\n\n${r.text}`);
}

export async function abendZusammenfassung(now = new Date()): Promise<{ text: string; texte: string[] }> {
  const tag = zurichDay(now);
  const log = await loadLog().catch(() => []);
  const texte = await unklarTexte(now).catch(() => []);
  const text = abendText(tag, readPassLog(50), tagesStand(tag), loadCourses(), log, now) + (texte.length ? `\n\nAnrede unklar, als sicher gesendet (${texte.length}): die Texte folgen einzeln.` : "");
  return { text, texte };
}
