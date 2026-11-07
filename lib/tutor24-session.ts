/**
 * tutor24-Sitzung zwischen den Laeufen behalten (wie ein Browser, der eingeloggt bleibt), damit nicht
 * jeder Lauf neu anmeldet (7.11.: 4 Anmeldungen in 33 min, dann 429).
 * Datei: %LOCALAPPDATA%\Mathetogo\tutor24-sitzung.json — ausserhalb des Projekts (nie im Git), Ordner und
 * Datei nur fuer den eigenen Windows-Benutzer lesbar. Inhalt so heikel wie das Passwort.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import type { Page } from "playwright";
import { loginToTutor24 } from "./tutor24-messaging";

export const SESSION_PATH = join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Mathetogo", "tutor24-sitzung.json");

/** Fuer newContext/newPage({ storageState }): Pfad, wenn die Datei lesbar ist; sonst ohne Sitzung starten. */
export function savedSession(path = SESSION_PATH): string | undefined {
  try {
    const s = JSON.parse(readFileSync(path, "utf8")) as { cookies?: unknown[] };
    return Array.isArray(s.cookies) ? path : undefined;
  } catch {
    return undefined;
  }
}

/** Nur mein Benutzer: Vererbung weg, Vollzugriff nur fuer ihn (Windows). */
function onlyMe(target: string, dir = false): void {
  if (process.platform !== "win32") return;
  execFileSync("icacls", [target, "/inheritance:r", "/grant:r", `${userInfo().username}:${dir ? "(OI)(CI)F" : "F"}`], { stdio: "ignore", timeout: 10_000 });
}

export async function saveSession(page: Page, path = SESSION_PATH): Promise<void> {
  if (!existsSync(dirname(path))) {
    mkdirSync(dirname(path), { recursive: true });
    onlyMe(dirname(path), true);
  }
  await page.context().storageState({ path });
  onlyMe(path);
}

export function dropSession(path = SESSION_PATH): void {
  try {
    unlinkSync(path);
  } catch {
    /* schon weg */
  }
}

/**
 * Anmelden mit gespeicherter Sitzung. Passt sie nicht (abgelaufen, unerwartete Seite): Cookies weg und
 * hoechstens EINMAL neu anmelden. Klappt das nicht, wirft es (Lauf bricht ab, Telegram meldet) und die
 * Sitzung wird geloescht. Rueckgabe fuers Protokoll.
 */
export async function signIn(page: Page, email: string, password: string, path = SESSION_PATH): Promise<string> {
  const had = (await page.context().cookies()).length > 0;
  const lines: string[] = [];
  const login = () => loginToTutor24(page, email, password, (s) => lines.push(s));
  let result: string;
  try {
    await login();
    result = lines.some((l) => l.includes("Bereits angemeldet")) ? "Sitzung wiederverwendet (keine neue Anmeldung)." : had ? "Sitzung abgelaufen — neu angemeldet." : "Neu angemeldet (keine gespeicherte Sitzung).";
  } catch (err) {
    if (!had) {
      dropSession(path);
      throw err;
    }
    // Gespeicherte Sitzung fuehrte auf eine unerwartete Seite: einmal frisch anmelden.
    await page.context().clearCookies();
    try {
      await login();
    } catch (err2) {
      dropSession(path);
      throw new Error(`Anmeldung fehlgeschlagen (auch neu angemeldet): ${err2 instanceof Error ? err2.message : String(err2)}`);
    }
    result = `Gespeicherte Sitzung passte nicht (${err instanceof Error ? err.message.slice(0, 80) : "?"}) — neu angemeldet.`;
  }
  try {
    await saveSession(page, path);
  } catch (err) {
    result += ` Sitzung nicht gespeichert: ${err instanceof Error ? err.message : String(err)}`;
  }
  return result;
}
