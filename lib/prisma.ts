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

function makePrismaClient() {
  const resolvedDbUrl = databaseUrlWithPoolSettings(process.env.DATABASE_URL);
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    ...(resolvedDbUrl ? { datasources: { db: { url: resolvedDbUrl } } } : {}),
  });

  return base.$extends({
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
