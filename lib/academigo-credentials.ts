import type { AcademigoMode } from "./academigo-types";

export function getAcademigoCredentials(mode: AcademigoMode): { email: string; password: string } {
  if (mode === "teachers") {
    const email = process.env.ACADEMIGO_TEACHER_EMAIL ?? process.env.ACADEMIGO_EMAIL;
    const password = process.env.ACADEMIGO_TEACHER_PASSWORD ?? process.env.ACADEMIGO_PASSWORD;
    if (!email || !password) {
      throw new Error(
        "ACADEMIGO_TEACHER_EMAIL and ACADEMIGO_TEACHER_PASSWORD must be set in .env.local (or legacy ACADEMIGO_EMAIL / ACADEMIGO_PASSWORD)"
      );
    }
    return { email, password };
  }

  const email = process.env.ACADEMIGO_STUDENT_EMAIL;
  const password = process.env.ACADEMIGO_STUDENT_PASSWORD;
  if (!email || !password) {
    throw new Error("ACADEMIGO_STUDENT_EMAIL and ACADEMIGO_STUDENT_PASSWORD must be set in .env.local");
  }
  return { email, password };
}
