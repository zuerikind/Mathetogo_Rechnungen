import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getEffectiveManualBaseline } from "@/lib/manual-revenue";
import { defaultQ1Year, normalizeQ1Targets, q1ReconciliationRows } from "@/lib/q1-reconciliation";
import { prisma } from "@/lib/prisma";
import { getTutorProfile } from "@/lib/tutor-profile";

const tutorSelectBase = {
  id: true,
  name: true,
  email: true,
  address: true,
  phone: true,
  iban: true,
  bankName: true,
} as const;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getTutorProfile();

  let row: {
    manualQ1Year: number | null;
    manualQ1M1Chf: number | null;
    manualQ1M2Chf: number | null;
    manualQ1M3Chf: number | null;
  } | null = null;
  try {
    const rows = await prisma.$queryRaw<
      {
        manualQ1Year: number | null;
        manualQ1M1Chf: number | null;
        manualQ1M2Chf: number | null;
        manualQ1M3Chf: number | null;
      }[]
    >`SELECT "manualQ1Year", "manualQ1M1Chf", "manualQ1M2Chf", "manualQ1M3Chf" FROM "TutorProfile" WHERE id = 'default' LIMIT 1`;
    row = rows[0] ?? null;
  } catch {
    row = null;
  }

  const manual = getEffectiveManualBaseline(
    row
      ? {
          manualQ1Year: row.manualQ1Year,
          manualQ1M1Chf: row.manualQ1M1Chf,
          manualQ1M2Chf: row.manualQ1M2Chf,
          manualQ1M3Chf: row.manualQ1M3Chf,
        }
      : null
  );

  const miscYearParam = req.nextUrl.searchParams.get("miscYear");
  const miscYearParsed = Number(miscYearParam);
  const miscYear =
    Number.isFinite(miscYearParsed) && miscYearParsed >= 2000 && miscYearParsed <= 2100
      ? Math.floor(miscYearParsed)
      : manual.year;
  let miscEarnings: Array<{
    id: string;
    year: number;
    month: number;
    amountCHF: number;
    label: string | null;
    source: "manual" | "q1_adjustment";
  }> = [];
  try {
    const rows = await prisma.miscEarning.findMany({
      where: { year: miscYear },
      orderBy: [{ month: "asc" }, { createdAt: "asc" }],
    });
    miscEarnings = rows.map((r) => ({
      id: r.id,
      year: r.year,
      month: r.month,
      amountCHF: r.amountCHF,
      label: r.label,
      source: r.source as "manual" | "q1_adjustment",
    }));
  } catch {
    miscEarnings = [];
  }
  const q1Rows = q1ReconciliationRows(
    manual.year,
    normalizeQ1Targets({
      m1: manual.entries[0]?.amountCHF ?? null,
      m2: manual.entries[1]?.amountCHF ?? null,
      m3: manual.entries[2]?.amountCHF ?? null,
    })
  );

  return NextResponse.json({
    ...profile,
    manualQ1: {
      year: manual.year,
      m1: manual.entries[0]!.amountCHF,
      m2: manual.entries[1]!.amountCHF,
      m3: manual.entries[2]!.amountCHF,
      fromDatabase: manual.fromDatabase,
    },
    miscYear,
    miscEarnings: miscEarnings.map((r) => ({
      id: r.id,
      year: r.year,
      month: r.month,
      amountCHF: r.amountCHF,
      label: r.label ?? "",
      source: r.source,
    })),
    q1Reconciliation: q1Rows,
  });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as Partial<{
    name: string;
    email: string;
    address: string;
    phone: string;
    iban: string;
    bankName: string;
    manualQ1: {
      year: number;
      m1: number;
      m2: number;
      m3: number;
    } | null;
    miscEarningUpsert: {
      id?: string;
      year: number;
      month: number;
      amountCHF: number;
      label?: string;
    };
    miscEarningDeleteId: string;
  }>;

  const current = await prisma.tutorProfile.findUnique({
    where: { id: "default" },
    select: tutorSelectBase,
  });

  const dataTutor = {
    name: body.name?.trim() ?? current?.name ?? "Max Mustermann",
    email: body.email?.trim() ?? current?.email ?? "max@example.ch",
    address: body.address?.trim() ?? current?.address ?? "Musterstrasse 1, 8000 Zürich",
    phone: body.phone?.trim() ?? current?.phone ?? "+41 79 000 00 00",
    iban: body.iban?.trim() ?? current?.iban ?? "CH00 0000 0000 0000 0000 0",
    bankName: body.bankName?.trim() ?? current?.bankName ?? "Zürcher Kantonalbank",
  };

  const updatePayload: Record<string, unknown> = { ...dataTutor };
  let manualPayload:
    | {
        year: number;
        m1: number;
        m2: number;
        m3: number;
      }
    | null
    | undefined = undefined;
  let miscUpsertPayload:
    | {
        id?: string;
        year: number;
        month: number;
        amountCHF: number;
        label: string;
      }
    | undefined = undefined;
  let miscDeleteId: string | undefined;

  if (body.manualQ1 === null) {
    manualPayload = null;
  } else if (body.manualQ1) {
    const y = Math.floor(Number(body.manualQ1.year));
    const m1 = Number(body.manualQ1.m1);
    const m2 = Number(body.manualQ1.m2);
    const m3 = Number(body.manualQ1.m3);
    if (y < 2000 || y > 2100 || ![m1, m2, m3].every((n) => Number.isFinite(n) && n >= 0)) {
      return NextResponse.json({ error: "Ungueltige manuelle Werte." }, { status: 400 });
    }
    manualPayload = { year: y, m1, m2, m3 };
  }
  if (body.miscEarningUpsert) {
    const y = Math.floor(Number(body.miscEarningUpsert.year));
    const m = Math.floor(Number(body.miscEarningUpsert.month));
    const amount = Number(body.miscEarningUpsert.amountCHF);
    const label = (body.miscEarningUpsert.label ?? "").trim();
    if (y < 2000 || y > 2100 || m < 1 || m > 12 || !Number.isFinite(amount)) {
      return NextResponse.json({ error: "Ungueltige sonstige Einnahme." }, { status: 400 });
    }
    miscUpsertPayload = {
      id: body.miscEarningUpsert.id,
      year: y,
      month: m,
      amountCHF: Number(amount.toFixed(2)),
      label,
    };
  }
  if (body.miscEarningDeleteId) {
    miscDeleteId = String(body.miscEarningDeleteId);
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.tutorProfile.upsert({
        where: { id: "default" },
        update: updatePayload,
        create: { id: "default", ...dataTutor },
      });

      if (manualPayload === null) {
        await tx.$executeRaw`
          UPDATE "TutorProfile"
          SET "manualQ1Year" = NULL,
              "manualQ1M1Chf" = NULL,
              "manualQ1M2Chf" = NULL,
              "manualQ1M3Chf" = NULL
          WHERE id = 'default'
        `;
      } else if (manualPayload) {
        await tx.$executeRaw`
          UPDATE "TutorProfile"
          SET "manualQ1Year" = ${manualPayload.year},
              "manualQ1M1Chf" = ${manualPayload.m1},
              "manualQ1M2Chf" = ${manualPayload.m2},
              "manualQ1M3Chf" = ${manualPayload.m3}
          WHERE id = 'default'
        `;
      }

      const shouldTouchMisc =
        manualPayload !== undefined || miscUpsertPayload !== undefined || miscDeleteId !== undefined;
      if (!shouldTouchMisc) return;

      if (miscUpsertPayload) {
        if (miscUpsertPayload.id) {
          const result = await tx.miscEarning.updateMany({
            where: { id: miscUpsertPayload.id, source: "manual" },
            data: {
              year: miscUpsertPayload.year,
              month: miscUpsertPayload.month,
              amountCHF: miscUpsertPayload.amountCHF,
              label: miscUpsertPayload.label,
            },
          });
          if (result.count === 0) {
            throw new Error("Nur manuelle Eintraege duerfen bearbeitet werden.");
          }
        } else {
          await tx.miscEarning.create({
            data: {
              year: miscUpsertPayload.year,
              month: miscUpsertPayload.month,
              amountCHF: miscUpsertPayload.amountCHF,
              label: miscUpsertPayload.label,
              source: "manual",
            },
          });
        }
      }
      if (miscDeleteId) {
        await tx.miscEarning.deleteMany({
          where: { id: miscDeleteId, source: "manual" },
        });
      }

      const fallbackTargets = normalizeQ1Targets({ m1: null, m2: null, m3: null });
      const currentManualRow = await tx.$queryRaw<
        {
          manualQ1Year: number | null;
          manualQ1M1Chf: number | null;
          manualQ1M2Chf: number | null;
          manualQ1M3Chf: number | null;
        }[]
      >`SELECT "manualQ1Year", "manualQ1M1Chf", "manualQ1M2Chf", "manualQ1M3Chf" FROM "TutorProfile" WHERE id = 'default' LIMIT 1`;
      const live = currentManualRow[0] ?? null;
      const resolvedManual = live
        ? {
            year: live.manualQ1Year ?? defaultQ1Year(),
            m1: live.manualQ1M1Chf ?? fallbackTargets[1],
            m2: live.manualQ1M2Chf ?? fallbackTargets[2],
            m3: live.manualQ1M3Chf ?? fallbackTargets[3],
          }
        : {
            year: defaultQ1Year(),
            m1: fallbackTargets[1],
            m2: fallbackTargets[2],
            m3: fallbackTargets[3],
          };
      const q1Rows = q1ReconciliationRows(
        resolvedManual.year,
        normalizeQ1Targets({
          m1: resolvedManual.m1,
          m2: resolvedManual.m2,
          m3: resolvedManual.m3,
        })
      );
      await tx.miscEarning.deleteMany({
        where: { source: "q1_adjustment", year: { not: resolvedManual.year } },
      });
      for (const rowQ1 of q1Rows) {
        await tx.miscEarning.upsert({
          where: {
            year_month_source: {
              year: rowQ1.year,
              month: rowQ1.month,
              source: "q1_adjustment",
            },
          },
          update: {
            amountCHF: rowQ1.deltaCHF,
            label: "Q1 Abgleich (Ziel minus PDF)",
          },
          create: {
            year: rowQ1.year,
            month: rowQ1.month,
            amountCHF: rowQ1.deltaCHF,
            label: "Q1 Abgleich (Ziel minus PDF)",
            source: "q1_adjustment",
          },
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (
      body.manualQ1 !== undefined ||
      body.miscEarningUpsert !== undefined ||
      body.miscEarningDeleteId !== undefined
    ) {
      return NextResponse.json(
        {
          error:
            "Manuelle Werte brauchen eine Datenbank-Migration. Bitte im Projektordner: npx prisma migrate deploy (bzw. migrate dev) ausfuehren.",
        },
        { status: 503 }
      );
    }
    throw e;
  }
}
