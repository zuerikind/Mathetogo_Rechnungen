/**
 * Bericht ueber die Probetage (nur lesend):  npx tsx scripts/probe-report.mts [--telegram]
 * Durchgaenge seit tutor24-followup/probe-baseline.json, was gesendet worden waere, Fehler/429,
 * und der Nachweis: keine neue Nachricht und kein neuer Kontakt in der Datenbank.
 */
import { readFileSync } from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local" });

const { fmtZurich, is429, notify, passResult, readPassLog } = await import("../lib/tutor24-autopilot");
const { prisma } = await import("../lib/prisma");

const base = JSON.parse(readFileSync("tutor24-followup/probe-baseline.json", "utf8")) as { am: string; nachrichten: number; kontakte: number };
const since = new Date(base.am);
const passes = readPassLog(500).filter((p) => new Date(p.start) >= since);
const [nachrichten, kontakte, neu] = await Promise.all([
  prisma.tutor24Message.count(),
  prisma.tutor24Contact.count(),
  prisma.tutor24Message.count({ where: { sentAt: { gte: since } } }),
]);
await prisma.$disconnect();

const sum = (f: (p: (typeof passes)[number]) => number) => passes.reduce((n, p) => n + f(p), 0);
const wouldSend = passes.flatMap((p) => p.probe ?? []);
const lines = [
  `Probetage seit ${fmtZurich(since)}: ${passes.length} Durchgänge (${passes.filter((p) => p.modus === "probe").length} Probe, ${passes.filter((p) => p.modus === "an").length} AN)`,
  ...passes.map((p) => `• ${fmtZurich(new Date(p.start))} ${p.modus}: ${passResult(p)} · würde ${p.erst.wuerde} Erst + ${p.nachfassen.wuerde} Nachfassen`),
  "",
  `Würde gesendet: ${sum((p) => p.erst.wuerde)} Erst-Nachrichten, ${sum((p) => p.nachfassen.wuerde)} Nachfassen (Einträge mit Wiederholungen: ${wouldSend.length})`,
  ...[...new Set(wouldSend)].map((x) => `  - ${x}`),
  `Übersprungen: ${sum((p) => p.erst.uebersprungen + p.nachfassen.uebersprungen)} · Prüfung nicht bestanden: ${sum((p) => p.erst.pruefungFehler + p.nachfassen.pruefungFehler)}`,
  `Fehler: ${sum((p) => p.fehler.length)} · 429: ${passes.filter((p) => is429(p.stopp ?? "") || p.fehler.some(is429)).length} · Stopps: ${passes.filter((p) => p.stopp).length}`,
  `Neue Antworten gemeldet: ${sum((p) => p.antworten)}`,
  "",
  `Datenbank: Nachrichten ${base.nachrichten} → ${nachrichten} (neu seit Beginn: ${neu}), Kontakte ${base.kontakte} → ${kontakte}`,
  neu === 0 && nachrichten === base.nachrichten && kontakte === base.kontakte
    ? "✓ Nichts gesendet und nichts als gesendet gespeichert."
    : "⚠ Die Datenbank hat sich verändert — bitte prüfen (auch Läufe von Hand zählen mit).",
];
const text = lines.join("\n");
console.log(text);
if (process.argv.includes("--telegram")) await notify(text.slice(0, 4000));
process.exit(0);
