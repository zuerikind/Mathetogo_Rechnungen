import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/** Longer wait when pool has a single slot (e.g. Supabase `connection_limit=1`) and sync holds it. */
function databaseUrlWithPoolTimeout(url: string | undefined): string | undefined {
  if (!url || url.includes("pool_timeout=")) return url;
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}pool_timeout=120`;
}

const resolvedDbUrl = databaseUrlWithPoolTimeout(process.env.DATABASE_URL);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    ...(resolvedDbUrl ? { datasources: { db: { url: resolvedDbUrl } } } : {}),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
