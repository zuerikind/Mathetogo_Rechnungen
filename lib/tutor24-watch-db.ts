/**
 * Datenbank fuer Lebenszeichen und Waechter: Tutor24Run, Tutor24Signal, Tutor24Command.
 * Laptop (Durchgang, Bot) schreibt, Vercel (Waechter, Webhook) liest — und umgekehrt fuer Befehle.
 */
import { prisma } from "./prisma";
import { is429, passResult, type PassLog } from "./tutor24-autopilot";
import type { LaptopSignal, RunRow } from "./tutor24-watch";

// ── Durchgaenge ───────────────────────────────────────────────────────────────

export async function startRun(modus: string, quelle: string): Promise<string> {
  return (await prisma.tutor24Run.create({ data: { modus, quelle } })).id;
}

export async function finishRun(id: string, p: PassLog): Promise<void> {
  await prisma.tutor24Run.update({
    where: { id },
    data: {
      endedAt: new Date(p.ende),
      ergebnis: passResult(p),
      stopp: p.stopp,
      is429: is429(p.stopp ?? "") || p.fehler.some(is429),
      gesendet: p.erst.gesendet + p.nachfassen.gesendet,
      wuerde: p.erst.wuerde + p.nachfassen.wuerde,
      daten: p as unknown as object,
    },
  });
}

export async function runsSince(since: Date): Promise<(RunRow & { daten: unknown })[]> {
  return prisma.tutor24Run.findMany({
    where: { startedAt: { gte: since } },
    orderBy: { startedAt: "asc" },
    select: { startedAt: true, endedAt: true, ergebnis: true, stopp: true, is429: true, daten: true },
  });
}

/** Protokolle der letzten Durchgaenge (fuer /status auf Vercel) */
export async function lastPasses(n = 20): Promise<PassLog[]> {
  // Laufende Durchgaenge haben noch kein Protokoll (daten null): fallen unten weg.
  const rows = await prisma.tutor24Run.findMany({ orderBy: { startedAt: "desc" }, take: n, select: { daten: true } });
  return rows.flatMap((r) => (r.daten ? [r.daten as unknown as PassLog] : [])).reverse();
}

// ── Signale ───────────────────────────────────────────────────────────────────

async function readSignal<T>(key: string): Promise<T | null> {
  return ((await prisma.tutor24Signal.findUnique({ where: { key } }))?.value as T | undefined) ?? null;
}
async function writeSignal(key: string, value: unknown): Promise<void> {
  const v = value as object;
  await prisma.tutor24Signal.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

export const readLaptop = () => readSignal<LaptopSignal>("laptop");
export const writeLaptop = (s: LaptopSignal) => writeSignal("laptop", s);

/** Schon geschickte Erinnerungen (Schluessel "YYYY-MM-DD 09:45"), nur die letzten 30 */
export const readReminders = async () => (await readSignal<string[]>("erinnerungen")) ?? [];
export async function markReminder(key: string): Promise<void> {
  await writeSignal("erinnerungen", [...(await readReminders()), key].slice(-30));
}

// ── Befehle Telegram → Laptop ─────────────────────────────────────────────────

/** id = Telegram update_id: ein doppelt zugestelltes Update legt keinen zweiten Befehl an. false = gab es schon */
export async function queueCommand(id: string, cmd: string): Promise<boolean> {
  try {
    await prisma.tutor24Command.create({ data: { id, cmd } });
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return false;
    throw err;
  }
}

/** Offene Befehle uebernehmen (jeder nur einmal, auch bei zwei Lesern). */
export async function takeCommands(): Promise<{ id: string; cmd: string; createdAt: Date }[]> {
  const open = await prisma.tutor24Command.findMany({ where: { takenAt: null }, orderBy: { createdAt: "asc" }, take: 20 });
  const mine = [];
  for (const c of open) {
    const { count } = await prisma.tutor24Command.updateMany({ where: { id: c.id, takenAt: null }, data: { takenAt: new Date() } });
    if (count === 1) mine.push(c);
  }
  return mine;
}

/** Nur offene /stop uebernehmen (Durchgang beim Start: ein Stopp vom Handy gilt, bevor irgendetwas laeuft). */
export async function takeStops(): Promise<number> {
  const { count } = await prisma.tutor24Command.updateMany({ where: { cmd: "/stop", takenAt: null }, data: { takenAt: new Date(), result: "vom Durchgang angewendet" } });
  return count;
}

/** Stand eines Befehls fuer die Website (/kurse): null = unbekannt; takenAt null = Laptop hat ihn noch nicht abgeholt */
export async function commandStatus(id: string) {
  return prisma.tutor24Command.findUnique({ where: { id }, select: { cmd: true, createdAt: true, takenAt: true, result: true } });
}

export async function commandResult(id: string, result: string): Promise<void> {
  await prisma.tutor24Command.update({ where: { id }, data: { result } }).catch(() => {});
}
