import { openSync, readFileSync, unlinkSync, writeSync, closeSync } from "node:fs";
import { join } from "node:path";

/**
 * Gemeinsame Sperre fuer alles, was mit dem tutor24-Konto arbeitet: die
 * Erst-Nachrichten-Automation (lib/tutor24.ts, im Next.js-Server) und das
 * Nachfass-Skript (scripts/followup_group_offer.mts, eigener Prozess).
 * Ein Speicher-Flag reicht dafuer nicht — die beiden laufen in verschiedenen Prozessen.
 */
export const TUTOR24_LOCK_PATH = join(process.cwd(), ".tutor24.lock");

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: Prozess existiert, gehoert nur jemand anderem.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export type LockHolder = { owner: string; pid: number; startedAt: string };

/** Wer die Sperre gerade haelt — null, wenn frei oder verwaist. */
export function readTutor24Lock(path = TUTOR24_LOCK_PATH): LockHolder | null {
  try {
    const held = JSON.parse(readFileSync(path, "utf8")) as Partial<LockHolder>;
    return held.pid && pidAlive(held.pid)
      ? { owner: held.owner ?? "?", pid: held.pid, startedAt: held.startedAt ?? "" }
      : null;
  } catch {
    return null;
  }
}

/** Holt die Sperre oder wirft mit dem Namen des laufenden Jobs. Gibt die Freigabe zurueck. */
export function acquireTutor24Lock(owner: string, path = TUTOR24_LOCK_PATH): () => void {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // "wx" ist atomar: genau ein Prozess kann die Datei anlegen.
      const fd = openSync(path, "wx");
      writeSync(fd, JSON.stringify({ owner, pid: process.pid, startedAt: new Date().toISOString() }));
      closeSync(fd);
      return () => {
        try {
          unlinkSync(path);
        } catch {
          /* schon weg */
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      let held: { owner?: string; pid?: number; startedAt?: string } = {};
      try {
        held = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        /* unlesbar = verwaist */
      }
      if (held.pid && pidAlive(held.pid)) {
        throw new Error(
          `tutor24 ist gesperrt: „${held.owner ?? "?"}“ läuft seit ${held.startedAt ?? "?"} (PID ${held.pid}). ` +
            `Bitte warten, bis dieser Lauf fertig ist.`
        );
      }
      // Prozess beendet, ohne aufzuraeumen (Absturz): verwaiste Sperre entfernen, neu versuchen.
      unlinkSync(path);
    }
  }
  throw new Error("tutor24-Sperre konnte nicht geholt werden.");
}
