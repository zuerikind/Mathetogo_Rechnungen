import { timingSafeEqual } from "node:crypto";

/**
 * Die einzigen Adressen ohne Login (middleware.ts). Exakter Vergleich, keine Praefixe ausser Login/NextAuth:
 * /api/telegram/webhook/x oder /api/tutor24/watchX brauchen weiterhin eine Sitzung.
 * Beide offenen Routen pruefen selbst ein Geheimnis (secretOk).
 */
const OPEN_EXACT = new Set(["/api/telegram/webhook", "/api/tutor24/watch"]);

export function isOpenPath(pathname: string): boolean {
  return pathname.startsWith("/api/auth") || pathname.startsWith("/login") || OPEN_EXACT.has(pathname);
}

/** Geheimnis-Vergleich in konstanter Zeit; fehlt das erwartete Geheimnis, ist nichts erlaubt. */
export function secretOk(given: string | null, expected: string | undefined): boolean {
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
