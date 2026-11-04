/**
 * Personen auf tutor24 (Tutor24Lead) und gesendete Nachrichten (Tutor24Message) — ersetzt followup_log.csv.
 *
 * Nach aussen bleibt das Protokoll eine Liste von LogRow (eine Zeile pro Person mit Kursangebot),
 * damit Pipeline, Plaetze und "Antworten pruefen" unveraendert rechnen. Erst-Nachricht und Nachfassen
 * schreiben beide hierhin: wer auf die Erst-Nachricht zusagt, belegt genauso einen Platz.
 */
import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import {
  GROUP_LABEL,
  OFFER_LABEL,
  capacity,
  courseStats,
  isCourseGroup,
  isOfferLevel,
  pickCourse,
  splitList,
  type Course,
  type CourseSnapshot,
  type FollowupSettings,
  type LeadInfo,
  type LeadMap,
  type LogRow,
  type PreviewRow,
} from "./tutor24-followup";

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
  const leads = await prisma.tutor24Lead.findMany({ include: { messages: { select: { art: true, kursId: true, kursDaten: true }, orderBy: { sentAt: "asc" } } } });
  const out: LeadMap = {};
  for (const l of leads) {
    const erst = l.messages.find((m) => m.art === "erst");
    const info: LeadInfo = {
      quelle: l.quelle, status: l.status, wer: l.wer, kind: l.kind, anrede: l.anrede, sprache: l.sprache,
      erstKursId: erst?.kursId ?? null,
      erstKursDaten: (erst?.kursDaten as Partial<CourseSnapshot> | null) ?? null,
      freigabeKursId: l.freigabeKursId,
      nachgefasst: l.messages.some((m) => m.art === "nachfassen"),
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
  /** Kursdaten zum Zeitpunkt des Sendens (courseSnapshot) */
  kursDaten?: CourseSnapshot | null;
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
    data: {
      leadId: lead.id, art: r.art, kursId: r.kursId, variante: r.variante, text: r.text, status: r.status,
      ...(r.kursDaten ? { kursDaten: r.kursDaten } : {}), ...(r.sentAt ? { sentAt: r.sentAt } : {}),
    },
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
  const all = await prisma.tutor24Lead.findMany({ select: { id: true, conversationId: true, inseratId: true, quelle: true, listingHash: true, createdAt: true } });
  const byConvo = new Map(all.filter((l) => l.conversationId).map((l) => [l.conversationId as string, l]));
  const byInserat = new Map(all.filter((l) => l.inseratId).map((l) => [l.inseratId as string, l]));
  let neu = 0;
  let geaendert = 0;
  // Erst-Nachricht ohne bekannte Konversation: auch Zeilen mit Abbruchgrund (z.B. hat geantwortet) verknuepfen,
  // damit "Antworten pruefen" sie oeffnen kann.
  for (const r of rows) {
    const l = r.inserat_id ? byInserat.get(r.inserat_id) : undefined;
    if (l && !l.conversationId && !byConvo.has(r.conversation_id)) {
      await prisma.tutor24Lead.update({ where: { id: l.id }, data: { conversationId: r.conversation_id } });
      l.conversationId = r.conversation_id;
      byConvo.set(r.conversation_id, l);
      geaendert++;
    }
  }
  for (const r of wanted) {
    const fields = fromPreview(r);
    const hit = byConvo.get(r.conversation_id) ?? (r.inserat_id ? byInserat.get(r.inserat_id) : undefined);
    // Datum der Person: meine letzte Nachricht laut Vorschau (beim Nachfassen ist das die Erst-Nachricht).
    const contacted = previewDate(r.letzte_nachricht);
    if (!hit) {
      // Inserat-ID kann eine andere Konversation schon belegen (zwei Konversationen zum selben Inserat): nur einmal.
      const inseratId = r.inserat_id && !byInserat.has(r.inserat_id) ? r.inserat_id : null;
      const created = await prisma.tutor24Lead.create({
        data: { ...fields, conversationId: r.conversation_id, inseratId, name: r.name, ...(contacted ? { createdAt: contacted } : {}) },
      });
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
    if (hit.quelle === "nachfassen" && contacted && contacted < hit.createdAt) data.createdAt = contacted;
    if (Object.keys(data).length) {
      await prisma.tutor24Lead.update({ where: { id: hit.id }, data });
      geaendert++;
    }
  }
  return { neu, geaendert };
}

/** "26.10.26, 12:00" (Vorschau-Spalte letzte_nachricht) → Datum; sonst null. */
export function previewDate(s: string): Date | null {
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return null;
  const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
  return new Date(y, Number(m[2]) - 1, Number(m[1]));
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

// ── Interessentenliste (/kurse) ───────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Montag der Kalenderwoche, ISO-Datum: Schluessel der 8-Wochen-Uebersicht. */
function weekStart(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return isoDay(x);
}

export type InterestPerson = {
  id: string;
  name: string;
  datum: string;
  stufe: string;
  kategorie: string;
  anlass: string;
  ort: string;
  /** "du", "Sie (Eltern, Tochter)", "Sie (unklar)" */
  anrede: string;
  sprache: string;
  sicher: boolean;
  /** Sicherheit "tief" oder Stufe ohne Jahr: standardmaessig eingeklappt ("+ N ohne Klassenangabe") */
  tief: boolean;
  grund: string;
  inseratUrl: string | null;
  konversationUrl: string | null;
  geantwortet: boolean;
  einzelunterricht: boolean;
  status: string;
  quelle: string;
  /** passender offener Kurs (pickCourse), dem ich die Person freigeben kann */
  passtZu: string | null;
  freigabeKursId: string | null;
};

/** sicher = Sicherheit hoch, unsicher = mittel, tief = ohne Klassenangabe. perWeek zaehlt sicher + unsicher. */
export type InterestGroup = {
  key: string; kursgruppe: string; label: string; fach: string; sicher: number; unsicher: number; tief: number; perWeek: number[]; people: InterestPerson[];
};

export type CourseFunnel = { courseId: string; angeboten: number; geantwortet: number; angemeldet: number; frei: number; passend: number; freigegeben: number };

/**
 * Wer (noch) keinen offenen Kurs angeboten bekam: gruppiert nach Kursgruppe + Fach.
 * Ausgeschlossene Stufen und fremde Faecher fehlen; unsichere Stufe (mittel/tief) steht drin, markiert.
 * Angeboten, angemeldet oder ignoriert → nicht in der Liste (Verlauf bleibt in der Datenbank).
 * Kurs der Person abgesagt, pausiert oder Anmeldeschluss vorbei → sie steht wieder in der Liste.
 */
export async function interestList(courses: Course[], settings: FollowupSettings, log: LogRow[], now = new Date(), showIgnored = false) {
  const leads = await prisma.tutor24Lead.findMany({ orderBy: { createdAt: "desc" } });
  return buildInterestList(leads, courses, settings, log, now, showIgnored);
}

/** Felder eines Tutor24Lead, die die Liste braucht (auch fuer den Testlauf ohne Datenbank). */
export type LeadRow = {
  id: string; name: string; createdAt: Date; inseratId: string | null; conversationId: string | null; quelle: string;
  stufe: string; kategorie: string; kursgruppe: string; sicherheit: string; ausschluss: string; faecher: string; anlass: string;
  ort: string; ortsname: string; wer: string; anrede: string; kind: string | null; sprache: string; kursId: string | null;
  freigabeKursId: string | null; status: string; geantwortet: string; einzelunterricht: boolean;
};

/** Reine Rechnung der Interessentenliste aus Lead-Zeilen. */
export function buildInterestList(leads: LeadRow[], courses: Course[], settings: FollowupSettings, log: LogRow[], now = new Date(), showIgnored = false) {
  const today = isoDay(now);
  const open = (id: string | null) => {
    const c = id ? courses.find((x) => x.id === id) : null;
    return !!c && c.active && (c.gruppe === "offen" || c.deadline >= today);
  };
  const weeks = Array.from({ length: 8 }, (_, i) => weekStart(new Date(now.getTime() - (7 - i) * 7 * DAY)));
  const groups = new Map<string, InterestGroup>();
  const passend = new Map<string, { passend: number; freigegeben: number }>();

  for (const l of leads) {
    if (!isOfferLevel(l.kategorie) || l.ausschluss) continue;
    const mine = splitList(l.faecher).filter((f) => settings.mySubjects.includes(f));
    if (!mine.length) continue;
    if (["Frage", "Zusage", "Bezahlt", "Absage"].includes(l.status)) continue;
    if (l.status === "ignoriert" && !showIgnored) continue;
    if (open(l.kursId)) continue;

    const offer = pickCourse(l, courses, settings, log, now);
    const passtZu = offer.kind === "kurs" ? offer.course.id : null;
    if (passtZu) {
      const p = passend.get(passtZu) ?? { passend: 0, freigegeben: 0 };
      p.passend++;
      if (l.freigabeKursId === passtZu) p.freigegeben++;
      passend.set(passtZu, p);
    }
    const kursgruppe = isCourseGroup(l.kursgruppe) ? l.kursgruppe : "offen";
    const fach = mine[0];
    const key = `${kursgruppe}|${fach}`;
    const g = groups.get(key) ?? { key, kursgruppe, label: GROUP_LABEL[kursgruppe], fach, sicher: 0, unsicher: 0, tief: 0, perWeek: weeks.map(() => 0), people: [] };
    const tief = l.sicherheit === "tief" || kursgruppe === "offen";
    const sicher = !tief && l.sicherheit === "hoch";
    if (tief) g.tief++;
    else {
      if (sicher) g.sicher++;
      else g.unsicher++;
      const w = weeks.indexOf(weekStart(l.createdAt));
      if (w > -1) g.perWeek[w]++;
    }
    g.people.push({
      id: l.id,
      name: l.name,
      datum: isoDay(l.createdAt),
      stufe: l.stufe,
      kategorie: l.kategorie,
      anlass: l.anlass,
      ort: [l.ort, l.ortsname].filter((x) => x && x !== "unbekannt").join(", "),
      anrede: l.anrede === "du" ? "du" : l.wer === "eltern" ? `Sie (Eltern${l.kind ? `, ${l.kind}` : ""})` : "Sie (unklar)",
      sprache: l.sprache,
      sicher,
      tief,
      grund:
        offer.kind === "kurs" ? "passender Kurs offen" : offer.kind === "nachfrage" ? OFFER_LABEL[offer.grund] ?? offer.grund : offer.grund === "stufe_ohne_jahr" ? "Stufe ohne Jahr" : offer.grund,
      inseratUrl: l.inseratId ? `https://www.tutor24.ch/de/jobs/${l.inseratId}` : null,
      konversationUrl: l.conversationId ? `https://www.tutor24.ch/de/conversations/${l.conversationId}?tab=sent` : null,
      geantwortet: l.geantwortet === "ja",
      einzelunterricht: l.einzelunterricht,
      status: l.status,
      quelle: l.quelle,
      passtZu,
      freigabeKursId: l.freigabeKursId,
    });
    groups.set(key, g);
  }

  const funnel: CourseFunnel[] = courses
    .filter((c) => c.gruppe !== "offen")
    .map((c) => {
      const st = courseStats(c, log, now);
      const p = passend.get(c.id) ?? { passend: 0, freigegeben: 0 };
      return { courseId: c.id, angeboten: st.angeschrieben, geantwortet: st.geantwortet, angemeldet: st.zusagen, frei: Math.max(0, capacity(c) - st.zusagen), ...p };
    });
  return { weeks, groups: Array.from(groups.values()).sort((a, b) => b.sicher - a.sicher || b.unsicher - a.unsicher || b.tief - a.tief), funnel };
}

/** Status-Knoepfe pro Person und pro Liste. freigabeKursId: ich gebe die Person fuer diesen Kurs frei (null = zurueck). */
export async function updateLeads(ids: string[], patch: { status?: "offen" | "ignoriert"; einzelunterricht?: boolean; freigabeKursId?: string | null }) {
  const data: Record<string, unknown> = {};
  if (patch.status === "offen" || patch.status === "ignoriert") data.status = patch.status;
  if (typeof patch.einzelunterricht === "boolean") data.einzelunterricht = patch.einzelunterricht;
  if (patch.freigabeKursId !== undefined) data.freigabeKursId = patch.freigabeKursId;
  if (!ids.length || !Object.keys(data).length) return 0;
  // Nur Personen der Liste: Angemeldete/Abgesagte aendert hier niemand aus Versehen.
  const { count } = await prisma.tutor24Lead.updateMany({ where: { id: { in: ids }, status: { in: ["offen", "ignoriert"] } }, data });
  return count;
}
