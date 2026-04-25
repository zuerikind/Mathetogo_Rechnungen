import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Ensure sane Prisma/pgbouncer defaults for local responsiveness.
 * We explicitly override very low connection limits (e.g. `connection_limit=1`)
 * which serialize all requests and cause frequent P2024 timeouts.
 */
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
    // Fallback for unusual URL formats: append conservative defaults if missing.
    const joiner = url.includes("?") ? "&" : "?";
    let out = url;
    if (!out.includes("connection_limit=")) out += `${joiner}connection_limit=${defaultConnectionLimit}`;
    if (!out.includes("pool_timeout=")) out += `${out.includes("?") ? "&" : "?"}pool_timeout=${defaultPoolTimeout}`;
    return out;
  }
}

const resolvedDbUrl = databaseUrlWithPoolSettings(process.env.DATABASE_URL);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    ...(resolvedDbUrl ? { datasources: { db: { url: resolvedDbUrl } } } : {}),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
