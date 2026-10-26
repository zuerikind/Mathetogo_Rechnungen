import type { AcademigoResult } from "./academigo-types";
import type { Tutor24Result } from "./tutor24-types";

export const tutor24JobState: {
  running: boolean;
  shouldStop: boolean;
  result: Tutor24Result | null;
  startedAt: Date | null;
} = { running: false, shouldStop: false, result: null, startedAt: null };

export const academigoJobState: {
  running: boolean;
  shouldStop: boolean;
  mode: "teachers" | "students" | null;
  result: AcademigoResult | null;
  startedAt: Date | null;
} = { running: false, shouldStop: false, mode: null, result: null, startedAt: null };

/** Nachfassen Gruppenkurs (lib/tutor24-followup-runner.ts) — Live-Status fuer den Tab. */
export const followupJobState: {
  running: boolean;
  shouldStop: boolean;
  mode: "preview" | "send" | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  /** z.B. "Lea (33216546), 12 von 150" */
  progress: string;
  done: number;
  total: number;
  log: string[];
  /** Abbruchmeldung (429, Captcha, Login …); null = sauber beendet */
  error: string | null;
} = {
  running: false,
  shouldStop: false,
  mode: null,
  startedAt: null,
  finishedAt: null,
  progress: "",
  done: 0,
  total: 0,
  log: [],
  error: null,
};

export function assertNoAutomationRunning(except?: "tutor24" | "academigo") {
  if (except !== "tutor24" && tutor24JobState.running) {
    throw new Error("Tutor24 automation is already running");
  }
  if (except !== "academigo" && academigoJobState.running) {
    throw new Error("Academigo automation is already running");
  }
}
