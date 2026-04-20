import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const students = [
    // 72 CHF / 60 min = 1.2
    { name: "Thilo",            ratePerMin: 1.2, currency: "CHF" },
    // 60 CHF / 50 min = 1.2
    { name: "Alexandra",        ratePerMin: 1.2, currency: "CHF" },
    // 65 CHF / 50 min, explicit rate 1.2
    { name: "Sara",             ratePerMin: 1.2, currency: "CHF" },
    // 60 CHF / 50 min = 1.2
    { name: "Joseph",           ratePerMin: 1.2, currency: "CHF" },
    // 55 CHF / 50 min = 1.1
    { name: "Ruby",             ratePerMin: 1.1, currency: "CHF" },
    { name: "Elena",            ratePerMin: 1.1, currency: "CHF" },
    { name: "Liam",             ratePerMin: 1.1, currency: "CHF" },
    { name: "Poppy",            ratePerMin: 1.1, currency: "CHF" },
    { name: "Julienne Messmer", ratePerMin: 1.1, currency: "CHF" },
    { name: "Amelie",           ratePerMin: 1.1, currency: "CHF" },
    { name: "Nikola/William",   ratePerMin: 1.1, currency: "CHF" },
    { name: "Nils",             ratePerMin: 1.1, currency: "CHF" },
    // 65 CHF / 50 min = 1.3
    { name: "Aiyana",           ratePerMin: 1.3, currency: "CHF" },
    { name: "Vladimir",         ratePerMin: 1.3, currency: "CHF" },
    { name: "Juri Düggeli",     ratePerMin: 1.3, currency: "CHF" },
    { name: "Maximilian",       ratePerMin: 1.3, currency: "CHF" },
    { name: "Viktor",           ratePerMin: 1.3, currency: "CHF" },
    { name: "Arno",             ratePerMin: 1.3, currency: "CHF" },
    { name: "Vincent",          ratePerMin: 1.3, currency: "CHF" },
    { name: "Alec",             ratePerMin: 1.3, currency: "CHF" },
    { name: "Leo",              ratePerMin: 1.3, currency: "CHF" },
    { name: "Juri Wolf",        ratePerMin: 1.3, currency: "CHF" },
    { name: "Flora",            ratePerMin: 1.3, currency: "CHF" },
    { name: "Olivia",           ratePerMin: 1.3, currency: "CHF" },
    { name: "Alyssia",          ratePerMin: 1.3, currency: "CHF" },
    { name: "Harsheeth",        ratePerMin: 1.3, currency: "CHF" },
    { name: "Kaija",            ratePerMin: 1.3, currency: "CHF" },
    { name: "Roxane",           ratePerMin: 1.3, currency: "CHF" },
    { name: "Una",              ratePerMin: 1.3, currency: "CHF" },
    { name: "Runqian",          ratePerMin: 1.3, currency: "CHF" },
    { name: "Khetsün",          ratePerMin: 1.3, currency: "CHF" },
  ];

  for (const student of students) {
    await prisma.student.upsert({
      where: { name: student.name },
      update: { ratePerMin: student.ratePerMin, currency: student.currency },
      create: { ...student, subject: "Mathe" },
    });
  }

  // Deactivate old placeholder students no longer in the list
  await prisma.student.updateMany({
    where: { name: { in: ["Johanna", "Alena", "Flurina"] } },
    data: { active: false },
  });

  console.log(`Seed complete: ${students.length} students upserted.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
