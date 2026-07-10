import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { AcademigoContactType } from "@prisma/client";
import {
  getAcademigoMessageTemplate,
  getAcademigoTemplates,
  resetAcademigoTemplatesToDefault,
  saveAcademigoMessageTemplate,
} from "@/lib/academigo-settings";
import { academigoJobState, runAcademigoMessaging, type AcademigoMode } from "@/lib/academigo";
import { prisma } from "@/lib/prisma";
import { tutor24JobState } from "@/lib/automation-state";

export const runtime = "nodejs";
export const maxDuration = 300;

function parseContactType(param: string | null): AcademigoContactType | undefined {
  if (param === "teacher") return AcademigoContactType.teacher;
  if (param === "student") return AcademigoContactType.student;
  return undefined;
}

/** GET — job status, templates, contacts */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const typeFilter = parseContactType(req.nextUrl.searchParams.get("type"));
  const templates = await getAcademigoTemplates();

  const where = typeFilter ? { contactType: typeFilter } : undefined;

  const [contacts, contactTotal] = await Promise.all([
    prisma.academigoContact.findMany({
      where,
      orderBy: { messagedAt: "desc" },
      take: 200,
    }),
    prisma.academigoContact.count({ where }),
  ]);

  return NextResponse.json({
    running: academigoJobState.running,
    mode: academigoJobState.mode,
    startedAt: academigoJobState.startedAt,
    result: academigoJobState.result,
    messageTemplate: templates.teachers,
    messageTemplateTeachers: templates.teachers,
    messageTemplateStudents: templates.students,
    contacts,
    contactTotal,
    tutor24Running: tutor24JobState.running,
  });
}

/** PATCH — reset template(s) to built-in default */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { templateTarget?: AcademigoMode | "both" };
  const target =
    body.templateTarget === "students" || body.templateTarget === "teachers"
      ? body.templateTarget
      : "both";

  try {
    const templates = await resetAcademigoTemplatesToDefault(target);
    return NextResponse.json({ ok: true, templateTarget: target, ...templates });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

/** PUT — save one template (teachers | students) */
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    messageTemplate?: string;
    templateTarget?: AcademigoMode;
  };

  if (typeof body.messageTemplate !== "string") {
    return NextResponse.json({ error: "messageTemplate required" }, { status: 400 });
  }

  const target = body.templateTarget === "students" ? "students" : "teachers";

  try {
    await saveAcademigoMessageTemplate(target, body.messageTemplate);
    return NextResponse.json({ ok: true, templateTarget: target });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

/** POST — start automation */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (academigoJobState.running) {
    return NextResponse.json({ error: "Academigo automation is already running" }, { status: 409 });
  }
  if (tutor24JobState.running) {
    return NextResponse.json({ error: "Tutor24 automation is already running" }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    mode?: AcademigoMode;
    headless?: boolean;
    maxPages?: number;
    messageTemplate?: string;
  };

  const mode = body.mode;
  if (mode !== "teachers" && mode !== "students") {
    return NextResponse.json({ error: "mode must be teachers or students" }, { status: 400 });
  }

  const headless = body.headless ?? false;
  const maxPages = typeof body.maxPages === "number" ? body.maxPages : 10;

  let messageTemplate = await getAcademigoMessageTemplate(mode);
  if (typeof body.messageTemplate === "string" && body.messageTemplate.trim()) {
    messageTemplate = body.messageTemplate.trim();
    try {
      await saveAcademigoMessageTemplate(mode, messageTemplate);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 }
      );
    }
  }

  runAcademigoMessaging({ mode, headless, maxPages, messageTemplate }).catch((err) => {
    console.error("[academigo] automation error:", err);
    academigoJobState.running = false;
    academigoJobState.mode = null;
    academigoJobState.result = {
      messaged: 0,
      skipped: 0,
      errors: [err instanceof Error ? err.message : String(err)],
      log: ["Fatal error — see server console"],
      newContacts: [],
    };
  });

  return NextResponse.json({ started: true, mode });
}

/** DELETE — stop automation */
export async function DELETE() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  academigoJobState.shouldStop = true;
  return NextResponse.json({ stopping: true });
}
