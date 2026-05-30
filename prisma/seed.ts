import { PrismaClient } from "@prisma/client";
import { defaultRatePerMinForStudent } from "@/lib/pricing";

const prisma = new PrismaClient();

const STUDENT_NAMES = [
  "Thilo",
  "Alexandra",
  "Sara",
  "Joseph",
  "Ruby",
  "Elena",
  "Liam",
  "Poppy",
  "Julienne Messmer",
  "Amelie",
  "Nikola/William",
  "Nils",
  "Aiyana",
  "Vladimir",
  "Juri Düggeli",
  "Maximilian",
  "Viktor",
  "Arno",
  "Vincent",
  "Alec",
  "Leo",
  "Juri Wolf",
  "Flora",
  "Olivia",
  "Alyssia",
  "Harsheeth",
  "Kaija",
  "Roxane",
  "Una",
  "Runqian",
  "Khetsün",
  "Aditya",
  "Raffael",
  "Vincent/Aurel",
] as const;

async function main() {
  for (const name of STUDENT_NAMES) {
    const ratePerMin = defaultRatePerMinForStudent(name);
    await prisma.student.upsert({
      where: { name },
      update: { ratePerMin, currency: "CHF" },
      create: { name, subject: "Mathe", ratePerMin, currency: "CHF" },
    });
  }

  await prisma.student.updateMany({
    where: { name: { in: ["Johanna", "Alena", "Flurina"] } },
    data: { active: false },
  });

  console.log(`Seed complete: ${STUDENT_NAMES.length} students at 60 CHF/class.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
