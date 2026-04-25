import { PrismaClient } from "@prisma/client";
import { MANUAL_BASELINE_YEAR } from "@/lib/manual-revenue";

const prisma = new PrismaClient();

const MONTHLY_AMOUNTS: ReadonlyArray<{
  month: 1 | 2 | 3;
  byStudent: Record<string, number>;
}> = [
  {
    month: 1,
    byStudent: {
      Thilo: 165,
      Ruby: 805,
      Alexandra: 600,
      Sara: 882,
      Elena: 330,
      Liam: 330,
      Poppy: 264,
      "Julienne Messmer": 132,
      Amelie: 867,
      "Nikola/William": 165,
      Nils: 198,
      Joseph: 66,
      Aiyana: 156,
      Vladimir: 0,
      "Juri Düggeli": 130,
      Maximilian: 195,
      Viktor: 260,
      Arno: 130,
      Vincent: 1000,
      Alec: 130,
      Leo: 260,
      "Juri Wolf": 377,
      Flora: 507,
      Olivia: 195,
      Alyssia: 104,
      Harsheeth: 0,
      Kaija: 0,
      Roxane: 0,
      Una: 0,
      Runqian: 0,
      "Khetsün": 0,
    },
  },
  {
    month: 2,
    byStudent: {
      Thilo: 184.8,
      Ruby: 990,
      Alexandra: 198,
      Sara: 0,
      Elena: 0,
      Liam: 132,
      Poppy: 132,
      "Julienne Messmer": 0,
      Amelie: 578,
      "Nikola/William": 55,
      Nils: 0,
      Joseph: 132,
      Aiyana: 507,
      Vladimir: 0,
      "Juri Düggeli": 0,
      Maximilian: 195,
      Viktor: 65,
      Arno: 0,
      Vincent: 325,
      Alec: 0,
      Leo: 195,
      "Juri Wolf": 78,
      Flora: 0,
      Olivia: 0,
      Alyssia: 0,
      Harsheeth: 55,
      Kaija: 156,
      Roxane: 0,
      Una: 0,
      Runqian: 0,
      "Khetsün": 0,
    },
  },
  {
    month: 3,
    byStudent: {
      Thilo: 72,
      Ruby: 0,
      Alexandra: 336,
      Sara: 0,
      Elena: 297,
      Liam: 335.5,
      Poppy: 264,
      "Julienne Messmer": 0,
      Amelie: 0,
      "Nikola/William": 220,
      Nils: 0,
      Joseph: 198,
      Aiyana: 624,
      Vladimir: 0,
      "Juri Düggeli": 156,
      Maximilian: 260,
      Viktor: 195,
      Arno: 0,
      Vincent: 0,
      Alec: 0,
      Leo: 195,
      "Juri Wolf": 384,
      Flora: 0,
      Olivia: 0,
      Alyssia: 0,
      Harsheeth: 0,
      Kaija: 156,
      Roxane: 624,
      Una: 156,
      Runqian: 0,
      "Khetsün": 0,
    },
  },
];

function buildManualCalEventId(studentName: string, month: number): string {
  const safe = studentName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `manual-q1-${MANUAL_BASELINE_YEAR}-${month}-${safe}`;
}

async function main() {
  const students = await prisma.student.findMany({
    where: { name: { in: Array.from(new Set(MONTHLY_AMOUNTS.flatMap((m) => Object.keys(m.byStudent)))) } },
    select: { id: true, name: true, ratePerMin: true },
  });

  const byName = new Map(students.map((s) => [s.name, s]));
  const missingNames: string[] = [];
  let upserted = 0;

  for (const monthRow of MONTHLY_AMOUNTS) {
    for (const [studentName, amountCHF] of Object.entries(monthRow.byStudent)) {
      const student = byName.get(studentName);
      if (!student) {
        missingNames.push(studentName);
        continue;
      }

      const durationMin =
        amountCHF <= 0 || student.ratePerMin <= 0
          ? 0
          : Math.round(amountCHF / student.ratePerMin);

      const date = new Date(MANUAL_BASELINE_YEAR, monthRow.month - 1, 15, 12, 0, 0, 0);
      const calEventId = buildManualCalEventId(studentName, monthRow.month);

      await prisma.session.upsert({
        where: { calEventId },
        update: {
          studentId: student.id,
          date,
          durationMin,
          amountCHF,
          month: monthRow.month,
          year: MANUAL_BASELINE_YEAR,
          notes: "Manuell importiert aus Q1-Tabelle (Jan-Maerz).",
        },
        create: {
          studentId: student.id,
          date,
          durationMin,
          amountCHF,
          calEventId,
          month: monthRow.month,
          year: MANUAL_BASELINE_YEAR,
          notes: "Manuell importiert aus Q1-Tabelle (Jan-Maerz).",
        },
      });
      upserted += 1;
    }
  }

  console.log(`Manual Q1 import complete. Upserted sessions: ${upserted}`);
  if (missingNames.length > 0) {
    console.warn(`Missing students (${missingNames.length}): ${missingNames.join(", ")}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
