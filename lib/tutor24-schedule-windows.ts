/** Windows-Aufgabe der Automatik auf die eingestellten Uhrzeiten stellen (nur Laptop, saveConfig). */
import { execFileSync } from "node:child_process";
import { TASK_NAME, normTimes, timesProblem } from "./tutor24-schedule";

/** Windows-Aufgabe auf diese Zeiten stellen (nur Laptop). Wirft bei Fehler — dann wird nicht gespeichert. */
export function applyWindowsSchedule(times: string[]): void {
  const t = normTimes(times);
  if (!t || timesProblem(t)) throw new Error("ungültige Uhrzeiten");
  // t ist geprueft (nur HH:MM), darum sicher im Befehl
  const triggers = t.map((x) => `New-ScheduledTaskTrigger -Daily -At '${x}'`).join("; ");
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", `$t = @(${triggers}); Set-ScheduledTask -TaskName '${TASK_NAME}' -Trigger $t | Out-Null`],
    { stdio: "pipe", timeout: 30_000 }
  );
}
