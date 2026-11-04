/**
 * Personen auf tutor24 (Tutor24Lead) und gesendete Nachrichten (Tutor24Message) — ersetzt followup_log.csv.
 *
 * Nach aussen bleibt das Protokoll eine Liste von LogRow (eine Zeile pro Person mit Kursangebot),
 * damit Pipeline, Plaetze und "Antworten pruefen" unveraendert rechnen. Erst-Nachricht und Nachfassen
 * schreiben beide hierhin: wer auf die Erst-Nachricht zusagt, belegt genauso einen Platz.
 */
import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import { isOfferLevel, splitList, type FollowupSettings, type LeadMap, type LogRow, type PreviewRow } from "./tutor24-followup";

export type LeadStatus = "offen" | "Frage" | "Zusage" | "Bezahlt" | "Absage" | "ignoriert";

type LeadKeys = { id: string; conversationId: string | null; inseratId: string | null };

/** Schluessel im Protokoll: Konversation, sonst Inserat (Erst-Nachricht, Konversation noch unbekannt). */
export const leadKey = (l: LeadKeys) => l.conversationId ?? (l.inseratId ? `inserat:${l.inseratId}` : `lead:${l.id}`);

function whereKey(key: string) {
  if (key.startsWith("inserat:")) return { inseratId: key.slice(8) };
  if (key.startsWith("lead:")) return { id: key.slice(5) };
  return { conversationId: key };
}

export const listingHash = (parts: string[]) => createHash("sha1").update(parts.join("\n")).digest("hex").slice(0, 16);

/** Protokoll wie frueher die CSV: Personen, denen ein Kurs (oder die Stufen-Frage) geschickt wurde. */
export async function loadLog(): Promise<LogRow[]> {
  const leads = await prisma.tutor24Lead.findMany({
    where: { messages: { some: { kursId: { not: null } } } },
    include: { messages: { where: { kursId: { not: null } }, orderBy: { sentAt: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  return leads.map((l) => {
    const last = l.messages[l.messages.length - 1];
    const followedUp = l.messages.some((m) => m.art === "nachfassen");
    return {
      conversation_id: leadKey(l),
      name: l.name,
      zeitstempel: last.sentAt.toISOString(),
      kurs: l.kursId ?? last.kursId ?? "",
      variante: last.variante,
      status: last.status,
      geantwortet: l.geantwortet,
      antwort_datum: l.antwortDatum,
      antwort: l.antwort,
      markierung: l.status === "offen" || l.status === "ignoriert" ? "" : l.status,
      art: followedUp ? "nachfassen" : "erst",
      inserat_id: l.inseratId ?? "",
    };
  });
}

/** Was das Nachfassen pro Person wissen muss (Anrede, Sprache, Kurs und Text der Erst-Nachricht, Stand). */
export async function loadLeadInfo(): Promise<LeadMap> {
  const leads = await prisma.tutor24Lead.findMany({ include: { messages: { where: { art: "erst" }, orderBy: { sentAt: "asc" }, take: 1 } } });
  const out: LeadMap = {};
  for (const l of leads) {
    const erst = l.messages[0];
    const info = {
      quelle: l.quelle, status: l.status, wer: l.wer, kind: l.kind, anrede: l.anrede, sprache: l.sprache,
      erstKursId: erst?.kursId ?? null, erstText: erst?.text ?? "", freigabeKursId: l.freigabeKursId,
    };
    if (l.conversationId) out[l.conversationId] = info;
    if (l.inseratId) out[`inserat:${l.inseratId}`] = info;
  }
  return out;
}

/** Protokoll-Felder → Lead-Felder (geantwortet, Antwort, Markierung, Kurs). */
export async function updateLead(key: string, patch: Partial<LogRow>): Promise<void> {
  const data: Record<string, string> = {};
  if (patch.geantwortet !== undefined) data.geantwortet = patch.geantwortet;
  if (patch.antwort_datum !== undefined) data.antwortDatum = patch.antwort_datum;
  if (patch.antwort !== undefined) data.antwort = patch.antwort;
  if (patch.markierung !== undefined) data.status = patch.markierung || "offen";
  if (patch.kurs !== undefined) data.kursId = patch.kurs;
  const { count } = await prisma.tutor24Lead.updateMany({ where: whereKey(key), data });
  if (!count) throw new Error(`Person ${key} steht nicht im Protokoll.`);
}

export type SendRecord = {
  conversationId?: string | null;
  inseratId?: string | null;
  name: string;
  art: "erst" | "nachfassen";
  kursId: string | null;
  variante: string;
  text: string;
  status: "gesendet" | "unbestaetigt";
  /** Analyse, falls die Person neu ist (Erst-Nachricht) */
  lead?: Partial<LeadFields>;
  sentAt?: Date;
};

export type LeadFields = {
  quelle: string; listingHash: string; faecher: string; stufe: string; kategorie: string; kursgruppe: string;
  sicherheit: string; ausschluss: string; anlass: string; ort: string; ortsname: string; wer: string; anrede: string;
  kind: string | null; sprache: string; grund: string; auszug: string;
};

async function findLead(conversationId?: string | null, inseratId?: string | null) {
  const or = [...(conversationId ? [{ conversationId }] : []), ...(inseratId ? [{ inseratId }] : [])];
  return or.length ? prisma.tutor24Lead.findFirst({ where: { OR: or } }) : null;
}

/** Nachricht speichern; Person anlegen oder ergaenzen. Mit Kurs wird sie zum Kurs in der Pipeline. */
export async function recordSend(r: SendRecord): Promise<void> {
  const existing = await findLead(r.conversationId, r.inseratId);
  const keys = {
    ...(r.conversationId && !existing?.conversationId ? { conversationId: r.conversationId } : {}),
    ...(r.inseratId && !existing?.inseratId ? { inseratId: r.inseratId } : {}),
  };
  const offer = r.kursId ? { kursId: r.kursId, grund: "" } : {};
  const lead = existing
    ? await prisma.tutor24Lead.update({ where: { id: existing.id }, data: { ...keys, ...offer, name: existing.name || r.name } })
    : await prisma.tutor24Lead.create({
        data: { quelle: r.art === "erst" ? "erstnachricht" : "nachfassen", ...r.lead, ...keys, ...offer, name: r.name },
      });
  await prisma.tutor24Message.create({
    data: { leadId: lead.id, art: r.art, kursId: r.kursId, variante: r.variante, text: r.text, status: r.status, ...(r.sentAt ? { sentAt: r.sentAt } : {}) },
  });
}

/** Nachfass-Nachrichten heute (auch "unbestaetigt" zaehlt mit) — fuers Tageslimit. */
export async function sentToday(now = new Date()): Promise<number> {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return prisma.tutor24Message.count({ where: { art: "nachfassen", sentAt: { gte: start } } });
}

/** Inserat-ID → Kurs, der schon in der Erst-Nachricht angeboten wurde. */
export async function offeredCourses(): Promise<Map<string, string>> {
  const msgs = await prisma.tutor24Message.findMany({
    where: { art: "erst", kursId: { not: null }, lead: { inseratId: { not: null } } },
    select: { kursId: true, lead: { select: { inseratId: true } } },
  });
  return new Map(msgs.map((m) => [m.lead.inseratId as string, m.kursId as string]));
}

/** Nachricht zur Person im Protokoll: Variante der letzten Kurs-Nachricht ergaenzen (Zuordnung von Hand). */
export async function appendVariante(key: string, suffix: string): Promise<void> {
  const lead = await prisma.tutor24Lead.findFirst({ where: whereKey(key), include: { messages: { where: { kursId: { not: null } }, orderBy: { sentAt: "desc" }, take: 1 } } });
  const m = lead?.messages[0];
  if (m) await prisma.tutor24Message.update({ where: { id: m.id }, data: { variante: `${m.variante}${suffix}` } });
}

/**
 * Vorschau-Zeilen (Nachfassen) als Personen speichern, damit sie in der Interessentenliste stehen —
 * auch unsichere (Sicherheit mittel/tief). Nicht: ausgeschlossene Stufen, fremde Faecher.
 * Wer schon da ist (z.B. aus der Erst-Nachricht), behaelt seine Analyse; ergaenzt wird nur die Konversation.
 */
export async function syncPreviewLeads(rows: PreviewRow[], settings: FollowupSettings): Promise<{ neu: number; geaendert: number }> {
  const wanted = rows.filter(
    (r) => isOfferLevel(r.kategorie) && !r.ausschluss && splitList(r.faecher).some((f) => settings.mySubjects.includes(f))
  );
  const all = await prisma.tutor24Lead.findMany({ select: { id: true, conversationId: true, inseratId: true, quelle: true, listingHash: true } });
  const byConvo = new Map(all.filter((l) => l.conversationId).map((l) => [l.conversationId as string, l]));
  const byInserat = new Map(all.filter((l) => l.inseratId).map((l) => [l.inseratId as string, l]));
  let neu = 0;
  let geaendert = 0;
  for (const r of wanted) {
    const fields = fromPreview(r);
    const hit = byConvo.get(r.conversation_id) ?? (r.inserat_id ? byInserat.get(r.inserat_id) : undefined);
    if (!hit) {
      // Inserat-ID kann eine andere Konversation schon belegen (zwei Konversationen zum selben Inserat): nur einmal.
      const inseratId = r.inserat_id && !byInserat.has(r.inserat_id) ? r.inserat_id : null;
      const created = await prisma.tutor24Lead.create({ data: { ...fields, conversationId: r.conversation_id, inseratId, name: r.name } });
      byConvo.set(r.conversation_id, created);
      if (inseratId) byInserat.set(inseratId, created);
      neu++;
      continue;
    }
    const data: Record<string, unknown> = {};
    if (!hit.conversationId && !byConvo.has(r.conversation_id)) data.conversationId = r.conversation_id;
    if (!hit.inseratId && r.inserat_id && !byInserat.has(r.inserat_id)) data.inseratId = r.inserat_id;
    // Analyse nur neu, wenn sie aus dem Nachfassen stammt und sich das Ergebnis geaendert hat.
    if (hit.quelle === "nachfassen" && hit.listingHash !== fields.listingHash) Object.assign(data, fields);
    if (Object.keys(data).length) {
      await prisma.tutor24Lead.update({ where: { id: hit.id }, data });
      geaendert++;
    }
  }
  return { neu, geaendert };
}

/** Lead-Felder aus einer Vorschau-Zeile. Die Vorschau kennt Kind und Sprache nicht: du → Schueler, sonst unklar. */
export function fromPreview(r: PreviewRow): LeadFields {
  const f = {
    quelle: "nachfassen",
    faecher: r.faecher, stufe: r.stufe, kategorie: r.kategorie, kursgruppe: r.kursgruppe, sicherheit: r.sicherheit,
    ausschluss: r.ausschluss, anlass: r.anlass, ort: r.ort, ortsname: r.ortsname,
    wer: r.anrede === "du" ? "schueler" : "unklar", anrede: r.anrede === "du" ? "du" : "Sie", kind: null, sprache: "de",
    grund: "", auszug: r.begruendung.slice(0, 300),
  };
  return { ...f, listingHash: listingHash([f.faecher, f.stufe, f.kategorie, f.kursgruppe, f.sicherheit, f.ausschluss, f.anlass, f.ort, f.anrede]) };
}
