/**
 * Prueft die Geldpfade, die der result-Extender in lib/prisma.ts NICHT erreicht:
 * aggregate und groupBy.
 *
 * Hintergrund: der result-Extender greift nur auf Feldern eines Datensatzes.
 * aggregate/groupBy liefern _sum/_avg statt eines Datensatzes, dort kam das
 * Decimal roh durch und wurde von JSON.stringify zur ZEICHENKETTE. Sichtbar
 * war das als Summen-Kachel auf CHF 0.00 und als Diagrammachse bis 60'000'000.
 *
 * Geprueft wird deshalb der TYP NACH JSON-Rundlauf, nicht nur der Wert — im
 * Server-Speicher ist ein Decimal unauffaellig, kaputt geht es erst im Transport.
 *
 * Die Sollwerte kommen aus der Datenbank selbst (SUM mit ::float8), nicht aus
 * festen Zahlen: feste Betraege veralten beim naechsten Sync oder jeder
 * bestaetigten Loeschung und melden dann einen Fehler, wo keiner ist.
 *
 * Lauf: npx dotenv -e .env.local -- npx tsx scripts/verify-money-types.ts
 */
import { MANUAL_Q1_SELECT } from "@/lib/manual-revenue";
import { prisma } from "@/lib/prisma";

let fehler = 0;

/** Wert nach JSON-Rundlauf: muss eine Zahl sein und dem SQL-Sollwert entsprechen. */
function pruefe(name: string, wert: unknown, soll?: number) {
  const nachTransport = JSON.parse(JSON.stringify({ v: wert })).v;
  const typOk = nachTransport === null || typeof nachTransport === "number";
  const wertOk = soll === undefined || Math.abs(Number(nachTransport) - soll) < 0.005;
  if (!typOk || !wertOk) fehler += 1;
  console.log(
    `${typOk && wertOk ? "OK  " : "FEHL"} ${name.padEnd(36)} typ=${typeof nachTransport}` +
      ` wert=${JSON.stringify(nachTransport)}${soll !== undefined ? ` soll=${soll}` : ""}`
  );
}

async function sqlSumme(tabelle: string, spalte: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ s: number | null }[]>(
    `SELECT COALESCE(SUM("${spalte}"), 0)::float8 AS s FROM "${tabelle}"`
  );
  return Number(rows[0]?.s ?? 0);
}

async function main() {
  for (const [tabelle, spalte] of [
    ["Session", "amountCHF"],
    ["Invoice", "totalCHF"],
    ["InvoiceSnapshot", "totalCHF"],
    ["MonthlyExpense", "amountCHF"],
    ["DanceEarning", "amountCHF"],
    ["AdditionalEarning", "amountCHF"],
  ] as const) {
    const soll = await sqlSumme(tabelle, spalte);
    const modell = (prisma as unknown as Record<string, {
      aggregate(a: unknown): Promise<{ _sum: Record<string, unknown> }>;
    }>)[tabelle.charAt(0).toLowerCase() + tabelle.slice(1)];
    const agg = await modell.aggregate({ _sum: { [spalte]: true } });
    pruefe(`${tabelle}.aggregate _sum`, agg._sum[spalte] ?? 0, soll);
  }

  // groupBy speist die beiden Diagramme auf dem Dashboard.
  const gruppen = await prisma.session.groupBy({
    by: ["year", "month"],
    _sum: { amountCHF: true },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });
  const keineZahl = gruppen.filter(
    (g) => typeof JSON.parse(JSON.stringify({ v: g._sum.amountCHF })).v !== "number"
  );
  if (keineZahl.length > 0) fehler += 1;
  console.log(
    `${keineZahl.length === 0 ? "OK  " : "FEHL"} ${"session.groupBy _sum".padEnd(36)}` +
      ` ${gruppen.length} Gruppen, ${keineZahl.length} keine Zahl`
  );
  pruefe(
    "groupBy Summe = SQL-Summe",
    gruppen.reduce((s, g) => s + (g._sum.amountCHF ?? 0), 0),
    await sqlSumme("Session", "amountCHF")
  );

  // Diese vier Felder liefen frueher ueber $queryRaw und umgingen jede Konvertierung.
  const q1 = await prisma.tutorProfile.findUnique({
    where: { id: "default" },
    select: MANUAL_Q1_SELECT,
  });
  for (const feld of ["manualQ1M1Chf", "manualQ1M2Chf", "manualQ1M3Chf"] as const) {
    pruefe(`tutorProfile.${feld}`, q1?.[feld] ?? null);
  }

  console.log(fehler === 0 ? "\nALLES GRUEN" : `\n${fehler} FEHLER`);
  await prisma.$disconnect();
  process.exit(fehler === 0 ? 0 : 1);
}

void main();
