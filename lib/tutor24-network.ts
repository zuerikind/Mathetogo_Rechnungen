/**
 * Netz vor einem Durchgang (scripts/autopilot.mts): haengt der Laptop am iPhone-Hotspot, und ist Internet da?
 * Prueft nur Windows (netsh) und Telegram, nie tutor24.
 */
import { execFileSync } from "node:child_process";

/** SSID aus `netsh wlan show interfaces` (deutsch/englisch); null = kein WLAN (Kabel oder getrennt). */
export function parseSsid(netsh: string): string | null {
  return netsh.match(/^\s*SSID\s*:\s*(.+?)\s*$/m)?.[1] ?? null;
}

/** ponytail: am Namen erkannt ("Omids iPhone (2)"); ein umbenannter Hotspot faellt durch */
export const isHotspot = (ssid: string | null) => !!ssid && /iphone|android|hotspot/i.test(ssid);

export function currentSsid(): string | null {
  try {
    return parseSsid(execFileSync("netsh", ["wlan", "show", "interfaces"], { encoding: "utf8", timeout: 10_000 }));
  } catch {
    return null;
  }
}

/** Internet da? Eine Antwort von Telegram reicht (das brauchen die Meldungen ohnehin). */
export async function hasInternet(): Promise<boolean> {
  try {
    await fetch("https://api.telegram.org", { method: "HEAD", signal: AbortSignal.timeout(8_000) });
    return true;
  } catch {
    return false;
  }
}

/** Bytes, die der ganze Laptop bisher uebers Netz geschickt/empfangen hat (alle Adapter, 64-bit-Zaehler;
 * `netstat -e` zaehlt nur bis 4 GB und springt dann zurueck). null = nicht lesbar. */
export function netBytes(): number | null {
  try {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "(Get-NetAdapterStatistics | ForEach-Object { $_.ReceivedBytes + $_.SentBytes } | Measure-Object -Sum).Sum"],
      { encoding: "utf8", timeout: 20_000 }
    ).trim();
    return /^\d+$/.test(out) ? Number(out) : null;
  } catch {
    return null;
  }
}

/** Datenmenge eines Durchgangs in MB (ganzer Laptop, also eher etwas zu hoch); null = unbekannt. */
export const megabytes = (before: number | null, after: number | null) =>
  before !== null && after !== null && after >= before ? Math.round((after - before) / 1e6) : null;
