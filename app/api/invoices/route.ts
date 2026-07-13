import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getEffectiveManualBaseline, mergeManualBaselineSessions } from "@/lib/manual-revenue";
import { pruneStaleInvoicesInScope } from "@/lib/invoice-stale";
import { prisma } from "@/lib/prisma";
import { getSubscriptionInvoiceLines } from "@/lib/subscription-billing";
import { MANUAL_BASELINE_STUDENT_ID } from "@/lib/ui-types";

export async function GET(req: NextRequest) {
  const authSession = await auth();
  if (!authSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const year = searchParams.get("year");
  const month = searchParams.get("month");
  const studentId = searchParams.get("studentId");
  const status = searchParams.get("status");

  // Familienrechnung: Sessions/Abos von verlinkten Geschwistern zählen zur Rechnung des Hauptschülers.
  const allStudents = await prisma.student.findMany({
    select: { id: true, name: true, subject: true, billedToId: true },
  });
  const studentById = new Map(allStudents.map((s) => [s.id, s]));
  const billTarget = (id: string) => studentById.get(id)?.billedToId ?? id;
  // Schüler-Filter schliesst die ganze Rechnungsgruppe ein (auch wenn ein Kind gewählt wurde).
  const rootId = studentId ? billTarget(studentId) : null;
  const groupIds = rootId
    ? [rootId, ...allStudents.filter((s) => s.billedToId === rootId).map((s) => s.id)]
    : null;
  const studentFilter = groupIds ? { studentId: { in: groupIds } } : {};

  const invoices = await prisma.invoice.findMany({
    where: {
      ...(year ? { year: Number(year) } : {}),
      ...(month ? { month: Number(month) } : {}),
      ...studentFilter,
      ...(status === "paid"
        ? { paidAt: { not: null } }
        : status === "sent"
          ? { sentAt: { not: null }, paidAt: null }
        : status === "created"
          ? { sentAt: null, paidAt: null, pdfPath: { not: null } }
          : status === "pending"
            ? { sentAt: null, paidAt: null, pdfPath: null }
            : {}),
    },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          subject: true,
        },
      },
    },
    orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
  });

  // For pending/all views, also expose month/student combos that have sessions
  // but no generated invoice yet, so the invoice tab is useful before first create.
  if (status === "sent" || status === "created") {
    return NextResponse.json(invoices);
  }

  await pruneStaleInvoicesInScope({
    year: year ? Number(year) : undefined,
    month: month ? Number(month) : undefined,
    studentIds: groupIds ?? undefined,
  });

  const invoicesAfterPrune = await prisma.invoice.findMany({
    where: {
      ...(year ? { year: Number(year) } : {}),
      ...(month ? { month: Number(month) } : {}),
      ...studentFilter,
    },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          subject: true,
        },
      },
    },
    orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
  });

  const sessionRowsRaw = await prisma.session.findMany({
    where: {
      ...(year ? { year: Number(year) } : {}),
      ...(month ? { month: Number(month) } : {}),
      ...studentFilter,
    },
    select: {
      id: true,
      studentId: true,
      year: true,
      month: true,
      amountCHF: true,
      notes: true,
      date: true,
      durationMin: true,
      calEventId: true,
      createdAt: true,
      student: {
        select: {
          id: true,
          name: true,
          subject: true,
        },
      },
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  let tutorRow: {
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
    tutorRow = rows[0] ?? null;
  } catch {
    tutorRow = null;
  }

  const baseline = getEffectiveManualBaseline(tutorRow);
  const sessionRows = mergeManualBaselineSessions(sessionRowsRaw, { studentId, year, month }, {
    year: baseline.year,
    entries: baseline.entries,
  });

  const existingKeys = new Set(invoicesAfterPrune.map((i) => `${i.studentId}-${i.year}-${i.month}`));
  // Monate, in denen ein Schüler bereits eine eigene gesendete/bezahlte Rechnung hat
  // (z. B. vor der Familien-Verknüpfung): seine Beträge bleiben bei ihm statt beim Hauptschüler.
  const separatelyBilledKeys = new Set(
    invoicesAfterPrune
      .filter((i) => i.sentAt || i.paidAt)
      .map((i) => `${i.studentId}-${i.year}-${i.month}`)
  );
  const effTarget = (id: string, y: number, m: number) =>
    separatelyBilledKeys.has(`${id}-${y}-${m}`) ? id : billTarget(id);
  const virtualMap = new Map<
    string,
    {
      id: string;
      studentId: string;
      year: number;
      month: number;
      totalCHF: number;
      sessionIds: string;
      sentAt: null;
      paidAt: null;
      pdfPath: null;
      invoiceNumber: null;
      isVirtual: true;
      student: { id: string; name: string; subject: string };
    }
  >();

  for (const row of sessionRows) {
    if (row.studentId === MANUAL_BASELINE_STUDENT_ID) continue;
    const targetId = effTarget(row.studentId, row.year, row.month);
    const target = studentById.get(targetId);
    const key = `${targetId}-${row.year}-${row.month}`;
    if (existingKeys.has(key)) continue;
    if (!virtualMap.has(key)) {
      virtualMap.set(key, {
        id: `virtual-${key}`,
        studentId: targetId,
        year: row.year,
        month: row.month,
        totalCHF: 0,
        sessionIds: "[]",
        sentAt: null,
        paidAt: null,
        pdfPath: null,
        invoiceNumber: null,
        isVirtual: true,
        student: {
          id: targetId,
          name: target?.name ?? row.student.name,
          subject: target?.subject ?? row.student.subject,
        },
      });
    }
    const current = virtualMap.get(key);
    if (current) {
      current.totalCHF += row.amountCHF;
      current.sessionIds = JSON.stringify([
        ...JSON.parse(current.sessionIds),
        row.id,
      ]);
    }
  }

  const platformSubs = await prisma.platformSubscription.findMany({
    // Gruppen-Filter wie bei Sessions/Invoices: Abos der ganzen Familie mitladen.
    where: { ...studentFilter },
    select: {
      id: true,
      studentId: true,
      amountCHF: true,
      billingMethod: true,
      durationMonths: true,
      startMonth: true,
      startYear: true,
      student: { select: { id: true, name: true, subject: true } },
    },
  });

  // Rechnung-Abos put the full contract price on the start-month invoice, so a
  // start month without sessions still needs a virtual invoice row.
  for (const s of platformSubs) {
    if (s.billingMethod !== "invoice") continue;
    if (year && s.startYear !== Number(year)) continue;
    if (month && s.startMonth !== Number(month)) continue;
    const targetId = effTarget(s.studentId, s.startYear, s.startMonth);
    const target = studentById.get(targetId);
    const key = `${targetId}-${s.startYear}-${s.startMonth}`;
    if (existingKeys.has(key) || virtualMap.has(key)) continue;
    virtualMap.set(key, {
      id: `virtual-${key}`,
      studentId: targetId,
      year: s.startYear,
      month: s.startMonth,
      totalCHF: 0,
      sessionIds: "[]",
      sentAt: null,
      paidAt: null,
      pdfPath: null,
      invoiceNumber: null,
      isVirtual: true,
      student: target
        ? { id: target.id, name: target.name, subject: target.subject }
        : s.student,
    });
  }

  for (const v of Array.from(virtualMap.values())) {
    const lines = getSubscriptionInvoiceLines(
      platformSubs.filter((s) => effTarget(s.studentId, v.year, v.month) === v.studentId),
      v.year,
      v.month
    );
    v.totalCHF += lines.reduce((acc, l) => acc + l.amountCHF, 0);
  }

  const effectiveTotals = new Map<string, number>();
  for (const row of sessionRows) {
    // effTarget lässt Fremd-IDs (manuelle Baseline) unverändert.
    const key = `${effTarget(row.studentId, row.year, row.month)}-${row.year}-${row.month}`;
    effectiveTotals.set(key, (effectiveTotals.get(key) ?? 0) + row.amountCHF);
  }
  if (platformSubs.length > 0) {
    const keys = new Set<string>([
      ...Array.from(effectiveTotals.keys()),
      ...invoicesAfterPrune.map((i) => `${i.studentId}-${i.year}-${i.month}`),
    ]);
    for (const key of Array.from(keys)) {
      const [sid, yRaw, mRaw] = key.split("-");
      const y = Number(yRaw);
      const m = Number(mRaw);
      const sub = getSubscriptionInvoiceLines(
        platformSubs.filter((s) => effTarget(s.studentId, y, m) === sid),
        y,
        m
      ).reduce((acc, l) => acc + l.amountCHF, 0);
      effectiveTotals.set(key, (effectiveTotals.get(key) ?? 0) + sub);
    }
  }

  const realRows = invoicesAfterPrune
    .map((invoice) => {
      const key = `${invoice.studentId}-${invoice.year}-${invoice.month}`;
      const nextTotal = effectiveTotals.get(key);
      const liveTotal =
        typeof nextTotal === "number" ? Math.round(nextTotal * 100) / 100 : null;
      // Sent/paid invoices show what was actually billed; only drafts track live data.
      const locked = Boolean(invoice.sentAt || invoice.paidAt);
      const totalCHF = locked ? invoice.totalCHF : liveTotal ?? invoice.totalCHF;
      const divergesFromLive =
        locked && liveTotal !== null && Math.abs(liveTotal - invoice.totalCHF) > 0.005;
      return {
        ...invoice,
        totalCHF,
        divergesFromLive,
        liveTotalCHF: liveTotal,
        isVirtual: false as const,
      };
    })
    .filter((row) => row.totalCHF > 0 || row.sentAt || row.paidAt);

  const virtualRows = Array.from(virtualMap.values()).filter((row) => row.totalCHF > 0);

  const merged = [...realRows, ...virtualRows].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    if (a.month !== b.month) return b.month - a.month;
    return a.student.name.localeCompare(b.student.name, "de-CH");
  });

  return NextResponse.json(merged);
}
