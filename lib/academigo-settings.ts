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

/** Stored templates from before the «Schule und Lernplattform» update — auto-upgrade on load. */
function isLegacyTeacherTemplate(text: string): boolean {
  return (
    text.includes("einer neuen Academy und Lernplattform") ||
    text.includes("Aktuell bauen wir unser Lehrpersonen-Netzwerk auf")
  );
}

/** Teacher template without salary tiers — upgrade to current default. */
function needsTeacherSalarySection(text: string): boolean {
  return (
    text.includes("neuen Schule und Lernplattform") &&
    !text.includes("drei Vergütungsstufen") &&
    !text.includes("CHF 30 pro Lektion")
  );
}

function isLegacyStudentTemplate(text: string): boolean {
  return (
    text.includes("Ich bin Omid, Gründer von Academigo. Wir bauen in der Schweiz eine Academy") ||
    text.includes("Academy und Lernplattform") ||
    text.includes("einer neuen Schule und Lernplattform")
  );
}

async function migrateLegacyTemplates(row: {
  messageTemplate: string | null;
  messageTemplateStudent: string | null;
}): Promise<AcademigoTemplates> {
  let teachers = row.messageTemplate?.trim() || DEFAULT_ACADEMIGO_TEACHER_TEMPLATE;
  let students = row.messageTemplateStudent?.trim() || DEFAULT_ACADEMIGO_STUDENT_TEMPLATE;
  let changed = false;

  if (isLegacyTeacherTemplate(teachers)) {
    teachers = DEFAULT_ACADEMIGO_TEACHER_TEMPLATE;
    changed = true;
  } else if (needsTeacherSalarySection(teachers)) {
    teachers = DEFAULT_ACADEMIGO_TEACHER_TEMPLATE;
    changed = true;
  }
  if (isLegacyStudentTemplate(students)) {
    students = DEFAULT_ACADEMIGO_STUDENT_TEMPLATE;
    changed = true;
  }

  if (changed) {
    await prisma.academigoSettings.update({
      where: { id: "default" },
      data: { messageTemplate: teachers, messageTemplateStudent: students },
    });
  }

  return { teachers, students };
}

export async function getAcademigoTemplates(): Promise<AcademigoTemplates> {
  try {
    const row = await prisma.academigoSettings.findUnique({ where: { id: "default" } });
    if (row) {
      if (
        isLegacyTeacherTemplate(row.messageTemplate ?? "") ||
        isLegacyStudentTemplate(row.messageTemplateStudent ?? "") ||
        needsTeacherSalarySection(row.messageTemplate ?? "")
      ) {
        return migrateLegacyTemplates(row);
      }
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

export async function resetAcademigoTemplatesToDefault(
  target: AcademigoMode | "both" = "both"
): Promise<AcademigoTemplates> {
  const current = await getAcademigoTemplates();
  const teachers = target === "students" ? current.teachers : DEFAULT_ACADEMIGO_TEACHER_TEMPLATE;
  const students = target === "teachers" ? current.students : DEFAULT_ACADEMIGO_STUDENT_TEMPLATE;

  await prisma.academigoSettings.upsert({
    where: { id: "default" },
    update: {
      ...(target !== "students" ? { messageTemplate: teachers } : {}),
      ...(target !== "teachers" ? { messageTemplateStudent: students } : {}),
    },
    create: {
      id: "default",
      messageTemplate: teachers,
      messageTemplateStudent: students,
    },
  });

  return { teachers, students };
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
