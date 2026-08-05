// Der erweiterte Client aus lib/prisma.ts, nicht ein eigener: nur er wandelt die
// Decimal-Geldfelder an der Grenze zurueck auf number (P2c).
import { prisma } from "@/lib/prisma";
import { subscriptionProrationForMonth } from "@/lib/subscription-billing";

// Source-of-truth from PDF (student breakdown only, excluding subscriptions).
const PDF_TUTORING_TOTALS: Record<1 | 2 | 3, number> = {
  1: 8248,
  2: 3977.8,
  3: 4472.5,
};

async function main() {
  const subscriptions = await prisma.platformSubscription.findMany({
    select: {
      id: true,
      studentId: true,
      amountCHF: true,
      billingMethod: true,
      durationMonths: true,
      startMonth: true,
      startYear: true,
    },
  });

  // Bewusst kein $queryRaw: Rohabfragen umgehen den Decimal-Extender und
  // liefern fuer die manualQ1*-Betraege ein Decimal, das als number getippt waere.
  const manual = await prisma.tutorProfile.findUnique({
    where: { id: "default" },
    select: {
      manualQ1Year: true,
      manualQ1M1Chf: true,
      manualQ1M2Chf: true,
      manualQ1M3Chf: true,
    },
  });
  const year = manual?.manualQ1Year ?? 2026;

  for (const month of [1, 2, 3] as const) {
    const chargeAgg = await prisma.platformCharge.aggregate({
      where: { year, month },
      _sum: { amountCHF: true },
    });
    const chargesForMonth = chargeAgg._sum.amountCHF ?? 0;
    const tutoring = PDF_TUTORING_TOTALS[month];
    const subscriptionsForMonth = subscriptionProrationForMonth(subscriptions, year, month);
    const combined = tutoring + subscriptionsForMonth;
    const combinedWithCharges = tutoring + chargesForMonth;
    const manualValue =
      month === 1
        ? manual?.manualQ1M1Chf ?? 0
        : month === 2
          ? manual?.manualQ1M2Chf ?? 0
          : manual?.manualQ1M3Chf ?? 0;

    console.log(
      JSON.stringify({
        year,
        month,
        pdfTutoringCHF: tutoring,
        subscriptionsCHF: subscriptionsForMonth,
        combinedCHF: combined,
        platformChargesCHF: chargesForMonth,
        combinedWithChargesCHF: combinedWithCharges,
        manualQ1CHF: manualValue,
        deltaCHF: Number((combined - manualValue).toFixed(6)),
        deltaWithChargesCHF: Number((combinedWithCharges - manualValue).toFixed(6)),
      })
    );
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
