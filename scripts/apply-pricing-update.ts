/**
 * One-off: set 60 CHF/class tariffs and scale active platform subscriptions.
 * Run: npx dotenv-cli -e .env.local -- npx tsx scripts/apply-pricing-update.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  CLASS_PRICE_CHF,
  defaultRatePerMinForStudent,
  LONG_SESSION_STUDENT_NAMES,
} from "@/lib/pricing";

const prisma = new PrismaClient();

const OLD_TO_NEW_SUBSCRIPTION: Record<number, number> = {
  50: 55,
  40: 44,
  32: 35,
};

async function main() {
  const students = await prisma.student.findMany({
    where: { active: true },
    select: { id: true, name: true, ratePerMin: true },
  });

  let studentUpdates = 0;
  for (const s of students) {
    const nextRate = defaultRatePerMinForStudent(s.name);
    if (s.ratePerMin === nextRate) continue;
    await prisma.student.update({
      where: { id: s.id },
      data: { ratePerMin: nextRate },
    });
    studentUpdates += 1;
    console.log(`Student ${s.name}: ${s.ratePerMin} → ${nextRate} CHF/min`);
  }

  const subs = await prisma.platformSubscription.findMany({
    where: { active: true },
    select: { id: true, amountCHF: true, student: { select: { name: true } } },
  });

  let subUpdates = 0;
  for (const sub of subs) {
    const nextAmount = OLD_TO_NEW_SUBSCRIPTION[sub.amountCHF];
    if (nextAmount === undefined || nextAmount === sub.amountCHF) continue;
    await prisma.platformSubscription.update({
      where: { id: sub.id },
      data: { amountCHF: nextAmount },
    });
    subUpdates += 1;
    console.log(
      `Subscription ${sub.student.name}: ${sub.amountCHF} → ${nextAmount} CHF/Monat`
    );
  }

  console.log(
    `\nDone. ${studentUpdates} student rate(s), ${subUpdates} subscription(s) updated.`
  );
  console.log(
    `Standard: ${CLASS_PRICE_CHF} CHF / ${LONG_SESSION_STUDENT_NAMES.has("Thilo") ? "50 or 60" : "50"} min.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
