import { openSync, readFileSync, unlinkSync, writeFileSync, writeSync, closeSync } from "node:fs";
import { join } from "node:path";

/**
 * Gemeinsame Sperre fuer alles, was mit dem tutor24-Konto arbeitet: die
 * Erst-Nachrichten-Automation (lib/tutor24.ts, im Next.js-Server) und das
 * Nachfass-Skript (scripts/followup_group_offer.mts, eigener Prozess).
 * Ein Speicher-Flag reicht dafuer nicht — die beiden laufen in verschiedenen Prozessen.
 */
export const TUTOR24_LOCK_PATH = join(process.cwd(), ".tutor24.lock");
/** Ein ganzer Automatik-Durchgang (scripts/autopilot.mts): die einzelnen Laeufe darin holen TUTOR24_LOCK_PATH nacheinander. */
export const AUTOPILOT_LOCK_PATH = join(process.cwd(), ".autopilot.lock");

/** Ende des letzten tutor24-Laufs (jede Sitzung mit TUTOR24_LOCK_PATH) — fuer den Mindestabstand. */
export const LAST_RUN_PATH = join(process.cwd(), "tutor24-followup", "letzter-lauf.json");
/** Mindestabstand zwischen zwei tutor24-Laeufen, ab Ende des letzten (Entscheid 7.11. nach dem 429 von 9:42). */
export const MIN_GAP_MS = 2 * 3_600_000;

export function lastRunEnd(path = LAST_RUN_PATH): Date | null {
  try {
    const d = new Date((JSON.parse(readFileSync(path, "utf8")) as { ende?: string }).ende ?? "");
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}
/** Frühester Start des naechsten Laufs, null = jetzt erlaubt. */
export function earliestNext(now = new Date(), path = LAST_RUN_PATH): Date | null {
  const end = lastRunEnd(path);
  const next = end && new Date(end.getTime() + MIN_GAP_MS);
  return next && next > now ? next : null;
}
export const tooSoonText = (d: Date) =>
  `Nächster Lauf frühestens um ${d.toLocaleTimeString("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" })} (2 Stunden Abstand zum letzten Lauf).`;

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

/**
 * Holt die Sperre oder wirft mit dem Namen des laufenden Jobs. Gibt die Freigabe zurueck.
 * Fuer TUTOR24_LOCK_PATH zusaetzlich: Mindestabstand zum letzten Lauf (wirft "Nächster Lauf frühestens um …"),
 * ausser innerhalb des eigenen Automatik-Durchgangs (der hat den Abstand beim Start geprueft); die Freigabe
 * merkt sich das Ende.
 */
export function acquireTutor24Lock(owner: string, path = TUTOR24_LOCK_PATH, lastRunPath = LAST_RUN_PATH): () => void {
  const tutor24 = path === TUTOR24_LOCK_PATH;
  if (tutor24 && readTutor24Lock(AUTOPILOT_LOCK_PATH)?.pid !== process.pid) {
    const soon = earliestNext(new Date(), lastRunPath);
    if (soon) throw new Error(tooSoonText(soon));
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // "wx" ist atomar: genau ein Prozess kann die Datei anlegen.
      const fd = openSync(path, "wx");
      writeSync(fd, JSON.stringify({ owner, pid: process.pid, startedAt: new Date().toISOString() }));
      closeSync(fd);
      return () => {
        try {
          if (tutor24) writeFileSync(lastRunPath, JSON.stringify({ ende: new Date().toISOString(), owner }));
        } catch {
          /* Ordner fehlt: kein Abstand gemerkt */
        }
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
