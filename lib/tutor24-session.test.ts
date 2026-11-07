import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const login = vi.fn();
vi.mock("./tutor24-messaging", () => ({ loginToTutor24: (...a: unknown[]) => login(...a) }));
import { savedSession, signIn } from "./tutor24-session";

function fakePage(cookies: number) {
  const ctx = {
    cookies: async () => Array.from({ length: cookies }, () => ({})),
    clearCookies: vi.fn(async () => {}),
    storageState: vi.fn(async ({ path }: { path: string }) => writeFileSync(path, JSON.stringify({ cookies: [{}], origins: [] }))),
  };
  return { page: { context: () => ctx } as never, ctx };
}

describe("tutor24-Sitzung", () => {
  let file: string;
  beforeEach(() => {
    login.mockReset();
    file = join(mkdtempSync(join(tmpdir(), "t24sess-")), "tutor24-sitzung.json");
  });

  it("ohne Datei: ohne Sitzung starten; kaputte Datei ebenso", () => {
    expect(savedSession(file)).toBeUndefined();
    writeFileSync(file, "kaputt");
    expect(savedSession(file)).toBeUndefined();
  });

  it("gespeicherte Sitzung gilt: wiederverwendet, keine Anmeldung, wieder gespeichert", async () => {
    login.mockImplementation(async (_p, _e, _pw, log: (s: string) => void) => log("09:00 Bereits angemeldet"));
    const { page, ctx } = fakePage(5);
    expect(await signIn(page, "e", "p", file)).toBe("Sitzung wiederverwendet (keine neue Anmeldung).");
    expect(login).toHaveBeenCalledTimes(1);
    expect(ctx.clearCookies).not.toHaveBeenCalled();
    expect(savedSession(file)).toBe(file);
  });

  it("ohne Sitzung: normal anmelden und speichern", async () => {
    login.mockResolvedValue(undefined);
    expect(await signIn(fakePage(0).page, "e", "p", file)).toBe("Neu angemeldet (keine gespeicherte Sitzung).");
    expect(existsSync(file)).toBe(true);
  });

  it("unerwartete Seite mit alter Sitzung: Cookies weg, genau einmal neu anmelden", async () => {
    login.mockRejectedValueOnce(new Error("Timeout 15000ms #login-form")).mockResolvedValueOnce(undefined);
    const { page, ctx } = fakePage(5);
    expect(await signIn(page, "e", "p", file)).toMatch(/passte nicht .* neu angemeldet\.$/);
    expect(ctx.clearCookies).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledTimes(2);
  });

  it("auch die neue Anmeldung scheitert: abbrechen (wirft), kein dritter Versuch, Sitzung geloescht", async () => {
    writeFileSync(file, JSON.stringify({ cookies: [{}] }));
    login.mockRejectedValue(new Error("Login fehlgeschlagen: Passwort falsch"));
    await expect(signIn(fakePage(5).page, "e", "p", file)).rejects.toThrow(/^Anmeldung fehlgeschlagen \(auch neu angemeldet\): Login fehlgeschlagen/);
    expect(login).toHaveBeenCalledTimes(2);
    expect(existsSync(file)).toBe(false);
  });
});
