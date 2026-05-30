export type AcademigoMode = "teachers" | "students";

/** Max. Stundenlohn (CHF) für Lehrer-Outreach auf tutor24.ch */
export const ACADEMIGO_MAX_TEACHER_HOURLY_CHF = 35;

export type AcademigoResult = {
  messaged: number;
  skipped: number;
  errors: string[];
  log: string[];
  newContacts: { name: string; tutor24Id: string; profileUrl: string; contactType: "teacher" | "student" }[];
};
