import type { AcademigoMode } from "./academigo-types";
import { prisma } from "./prisma";
import {
  DEFAULT_ACADEMIGO_STUDENT_TEMPLATE,
  DEFAULT_ACADEMIGO_TEACHER_TEMPLATE,
} from "./academigo-message-prompt";

export type AcademigoTemplates = {
  teachers: string;
  students: string;
};

export async function getAcademigoTemplates(): Promise<AcademigoTemplates> {
  try {
    const row = await prisma.academigoSettings.findUnique({ where: { id: "default" } });
    if (row) {
      return {
        teachers: row.messageTemplate?.trim() || DEFAULT_ACADEMIGO_TEACHER_TEMPLATE,
        students: row.messageTemplateStudent?.trim() || DEFAULT_ACADEMIGO_STUDENT_TEMPLATE,
      };
    }
  } catch {
    /* table may not exist yet */
  }
  return {
    teachers: DEFAULT_ACADEMIGO_TEACHER_TEMPLATE,
    students: DEFAULT_ACADEMIGO_STUDENT_TEMPLATE,
  };
}

export async function getAcademigoMessageTemplate(mode: AcademigoMode): Promise<string> {
  const templates = await getAcademigoTemplates();
  return mode === "teachers" ? templates.teachers : templates.students;
}

export async function saveAcademigoMessageTemplate(
  target: AcademigoMode,
  messageTemplate: string
): Promise<void> {
  const trimmed = messageTemplate.trim();
  if (!trimmed) throw new Error("Nachrichtenvorlage darf nicht leer sein.");

  const current = await getAcademigoTemplates();

  if (target === "teachers") {
    await prisma.academigoSettings.upsert({
      where: { id: "default" },
      update: { messageTemplate: trimmed },
      create: {
        id: "default",
        messageTemplate: trimmed,
        messageTemplateStudent: current.students,
      },
    });
  } else {
    await prisma.academigoSettings.upsert({
      where: { id: "default" },
      update: { messageTemplateStudent: trimmed },
      create: {
        id: "default",
        messageTemplate: current.teachers,
        messageTemplateStudent: trimmed,
      },
    });
  }
}
