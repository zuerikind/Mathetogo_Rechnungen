import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof makePrismaClient> | undefined;
};

function databaseUrlWithPoolSettings(url: string | undefined): string | undefined {
  if (!url) return url;
  const defaultConnectionLimit = process.env.NODE_ENV === "production" ? "5" : "10";
  const defaultPoolTimeout = "20";
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(
      "connection_limit",
      process.env.PRISMA_CONNECTION_LIMIT?.trim() || defaultConnectionLimit
    );
    parsed.searchParams.set(
      "pool_timeout",
      process.env.PRISMA_POOL_TIMEOUT?.trim() || defaultPoolTimeout
    );
    return parsed.toString();
  } catch {
    const joiner = url.includes("?") ? "&" : "?";
    let out = url;
    if (!out.includes("connection_limit=")) out += `${joiner}connection_limit=${defaultConnectionLimit}`;
    if (!out.includes("pool_timeout=")) out += `${out.includes("?") ? "&" : "?"}pool_timeout=${defaultPoolTimeout}`;
    return out;
  }
}

type DecimalLike = { toNumber(): number };

/**
 * Result-Extender fuer nicht-nullbare Decimal-Felder: liefert number.
 *
 * Getrennt von decNullable, weil der Rueckgabetyp in die generierten
 * Client-Typen fliesst. Ein gemeinsamer Helfer mit number | null wuerde jede
 * Betragsaddition im Code zu einem Typfehler machen - die Nullbarkeit muss
 * genau der des Schemas entsprechen.
 */
function dec<F extends string>(...felder: F[]) {
  return Object.fromEntries(
    felder.map((f) => [
      f,
      { needs: { [f]: true }, compute: (row: Record<F, DecimalLike>) => row[f].toNumber() },
    ])
  ) as Record<F, { needs: Record<F, true>; compute: (row: Record<F, DecimalLike>) => number }>;
}

/** Wie dec, aber fuer nullbare Felder: null bleibt null. */
function decNullable<F extends string>(...felder: F[]) {
  return Object.fromEntries(
    felder.map((f) => [
      f,
      {
        needs: { [f]: true },
        compute: (row: Record<F, DecimalLike | null>) => {
          const v = row[f];
          return v === null ? null : v.toNumber();
        },
      },
    ])
  ) as Record<
    F,
    { needs: Record<F, true>; compute: (row: Record<F, DecimalLike | null>) => number | null }
  >;
}

function makePrismaClient() {
  const resolvedDbUrl = databaseUrlWithPoolSettings(process.env.DATABASE_URL);
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    ...(resolvedDbUrl ? { datasources: { db: { url: resolvedDbUrl } } } : {}),
  });

  return base.$extends({
    // Grenzkonvertierung fuer die 18 Geldfelder (P2c).
    //
    // Die Datenbank haelt sie als numeric, damit dort keine Float-Artefakte mehr
    // landen - 495.0000000000001 war einer. Prisma liefert dafuer ein Decimal,
    // und genau das darf die Anwendung nie zu sehen bekommen: JSON.stringify
    // macht aus einem Decimal eine ZEICHENKETTE, nicht eine Zahl. Ein
    // reduce((s, r) => s + r.amountCHF, 0) ergaebe dann "05599.5" statt 154.50 -
    // ohne Fehler, ohne Absturz, ohne Typfehler, weil die UI-Typen und die
    // as-Zusicherungen hinter fetch() weiterhin number behaupten.
    //
    // Deshalb wird hier einmal zentral zurueck auf number gewandelt. Der
    // Rueckgabetyp fliesst in die generierten Client-Typen, tsc sieht also
    // number wie bisher, und die uebrigen Dateien bleiben unveraendert.
    //
    // ACHTUNG: $queryRaw umgeht diesen Extender. Rohabfragen muessen ihre
    // Geldwerte selbst wandeln.
    result: {
      session: dec("amountCHF"),
      invoice: dec("totalCHF"),
      invoiceSnapshot: dec("totalCHF"),
      platformSubscription: dec("amountCHF"),
      platformCharge: dec("amountCHF"),
      miscEarning: dec("amountCHF"),
      additionalEarning: dec("amountCHF"),
      monthlyExpense: dec("amountCHF"),
      danceEarning: dec("amountCHF", "amountOriginal", "chfRate"),
      tutorProfile: decNullable("manualQ1M1Chf", "manualQ1M2Chf", "manualQ1M3Chf"),
      student: dec("ratePerMin"),
      studentRateHistory: dec("ratePerMin"),
      fxRateSnapshot: dec("chfPerEur", "chfPerMxn"),
    },
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          try {
            return await query(args);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const isConnReset =
              msg.includes("ConnectionReset") ||
              msg.includes("10054") ||
              msg.includes("ECONNRESET");
            if (!isConnReset) throw err;
            await base.$disconnect();
            await new Promise((r) => setTimeout(r, 500));
            return query(args);
          }
        },
      },
    },
  });
}

export const prisma = globalForPrisma.prisma ?? makePrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
