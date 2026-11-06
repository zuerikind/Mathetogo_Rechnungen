/**
 * Die einzigen Adressen ohne Login (middleware.ts). Exakter Vergleich, keine Praefixe ausser Login/NextAuth:
 * /api/telegram/webhook/x oder /api/tutor24/watchX brauchen weiterhin eine Sitzung.
 * Beide offenen Routen pruefen selbst ein Geheimnis (secretOk).
 */
const OPEN_EXACT = new Set(["/api/telegram/webhook", "/api/tutor24/watch"]);

export function isOpenPath(pathname: string): boolean {
  return pathname.startsWith("/api/auth") || pathname.startsWith("/login") || OPEN_EXACT.has(pathname);
}

/**
 * Geheimnis-Vergleich in konstanter Zeit; fehlt das erwartete Geheimnis, ist nichts erlaubt.
 * Ohne node:crypto, weil middleware.ts diese Datei einbindet und in der Edge-Laufzeit laeuft.
 */
export function secretOk(given: string | null, expected: string | undefined): boolean {
  if (!expected || !given) return false;
  let diff = given.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (given.charCodeAt(i) | 0);
  return diff === 0;
}
