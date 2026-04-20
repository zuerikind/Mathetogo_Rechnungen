import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const year = searchParams.get("year");
  const studentId = searchParams.get("studentId");
  const status = searchParams.get("status");

  const invoices = await prisma.invoice.findMany({
    where: {
      ...(year ? { year: Number(year) } : {}),
      ...(studentId ? { studentId } : {}),
      ...(status === "sent"
        ? { sentAt: { not: null } }
        : status === "created"
          ? { sentAt: null, pdfPath: { not: null } }
          : status === "pending"
            ? { sentAt: null, pdfPath: null }
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

  return NextResponse.json(invoices);
}
