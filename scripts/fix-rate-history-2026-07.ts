/**
 * Einmal-Korrektur: am 10.07.2026 blieb bei Runqian und Vincent ein Verlaufseintrag
 * "1.20/Min ab 01.07.2026" stehen. Die Korrektur "1.30/Min ab 01.06.2026" wurde
 * rueckwirkend erfasst und hob ihn deshalb nicht auf (rateAtDate nimmt den
 * juengsten Eintrag <= Lektionsdatum). Folge: jede seither NEU synchronisierte
 * Lektion wurde mit 1.20 statt 1.30 bepreist.
 *
 * Das Skript macht, was der reparierte PATCH-Endpunkt heute taete: Verlauf ab
 * Stichtag ersetzen, betroffene Lektionen neu bepreisen. Ausgelieferte Rechnungen
 * werden NICHT ueberschrieben — sie laufen ueber die Abweichungserkennung (P5/P7).
 *
 * Trockenlauf:  npx dotenv -e .env.local -- npx tsx scripts/fix-rate-history-2026-07.ts
 * Anwenden:     ... scripts/fix-rate-history-2026-07.ts --apply
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const NAMES = ["Runqian", "Vincent"];
const CORRECT_RATE = 1.3;
/** 01.06.2026 00:00 Zuerich — der Stichtag, den die Korrektur damals treffen wollte. */
const EFFECTIVE_FROM = new Date("2026-05-31T22:00:00.000Z");

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "== ANWENDEN ==" : "== TROCKENLAUF (--apply zum Schreiben) ==");

  for (const name of NAMES) {
    const student = await prisma.student.findUnique({
      where: { name },
      include: { rateHistory: { orderBy: { effectiveFrom: "asc" } } },
    });
    if (!student) throw new Error(`Schueler ${name} nicht gefunden`);
    if (student.ratePerMin !== CORRECT_RATE) {
      throw new Error(`${name}: ratePerMin ist ${student.ratePerMin}, erwartet ${CORRECT_RATE}`);
    }

    const doomed = student.rateHistory.filter((r) => r.effectiveFrom >= EFFECTIVE_FROM);
    const sessions = await prisma.session.findMany({
      where: { studentId: student.id, date: { gte: EFFECTIVE_FROM } },
      orderBy: { date: "asc" },
      select: { id: true, date: true, durationMin: true, amountCHF: true, year: true, month: true },
    });
    const wrong = sessions.filter(
      (s) => Math.abs(s.amountCHF - s.durationMin * CORRECT_RATE) > 0.005
    );
    const diff = wrong.reduce((a, s) => a + (s.durationMin * CORRECT_RATE - s.amountCHF), 0);

    console.log(`\n### ${name}`);
    for (const r of doomed)
      console.log(`  Verlauf ersetzt: ab ${r.effectiveFrom.toISOString().slice(0, 10)} -> ${r.ratePerMin}`);
    for (const s of wrong)
      console.log(
        `  ${s.date.toISOString().slice(0, 10)} ${String(s.durationMin).padStart(4)}min  ` +
          `${s.amountCHF} -> ${Math.round(s.durationMin * CORRECT_RATE * 100) / 100}`
      );
    console.log(`  ${wrong.length} Lektionen, Nachbelastung CHF ${diff.toFixed(2)}`);

    if (!apply) continue;

    await prisma.$transaction([
      prisma.studentRateHistory.deleteMany({
        where: { studentId: student.id, effectiveFrom: { gte: EFFECTIVE_FROM } },
      }),
      prisma.studentRateHistory.create({
        data: { studentId: student.id, ratePerMin: CORRECT_RATE, effectiveFrom: EFFECTIVE_FROM },
      }),
      ...wrong.map((s) =>
        prisma.session.update({
          where: { id: s.id },
          data: { amountCHF: Math.round(s.durationMin * CORRECT_RATE * 100) / 100 },
        })
      ),
    ]);

    // Nachkontrolle: kein Eintrag ausser 1.30 darf ab Stichtag noch greifen.
    const after = await prisma.studentRateHistory.findMany({
      where: { studentId: student.id, effectiveFrom: { gte: EFFECTIVE_FROM } },
    });
    if (after.length !== 1 || after[0].ratePerMin !== CORRECT_RATE) {
      throw new Error(`${name}: Verlauf nach der Korrektur unerwartet: ${JSON.stringify(after)}`);
    }
    const stillWrong = await prisma.session.findMany({
      where: { studentId: student.id, date: { gte: EFFECTIVE_FROM } },
      select: { durationMin: true, amountCHF: true },
    });
    const bad = stillWrong.filter(
      (s) => Math.abs(s.amountCHF - s.durationMin * CORRECT_RATE) > 0.005
    );
    if (bad.length > 0) throw new Error(`${name}: ${bad.length} Lektionen weiterhin falsch bepreist`);
    console.log("  OK");
  }

  if (apply) {
    // Die Juli-Rechnungen sind ausgeliefert und bleiben unangetastet. Ein
    // Kalender-Sync fuer Juli 2026 in der App markiert sie als abweichend
    // (needsReview) und protokolliert den Diff — dort wird ueber die Revision
    // entschieden. Die Abweichungserkennung ist "server-only" und laeuft
    // deshalb nicht aus diesem Skript heraus.
    console.log("\nNaechster Schritt: Kalender-Sync fuer Juli 2026 ausfuehren.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
