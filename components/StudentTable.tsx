"use client";

import Link from "next/link";
import { formatCHF } from "@/lib/ui-format";
import type { Student } from "@/lib/ui-types";

type StudentWithStats = Student & {
  totalEarned: number;
  sessions: number;
};

type StudentTableProps = {
  students: StudentWithStats[];
  onEdit: (student: StudentWithStats) => void;
  onDeactivate: (studentId: string) => void;
};

export function StudentTable({ students, onEdit, onDeactivate }: StudentTableProps) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-blue-100 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-gray-100 text-sm">
        <thead>
          <tr className="text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            <th className="px-5 py-3.5">Name</th>
            <th className="px-5 py-3.5">Fach</th>
            <th className="px-5 py-3.5">CHF/Min</th>
            <th className="px-5 py-3.5">CHF/Std</th>
            <th className="px-5 py-3.5">Verdient</th>
            <th className="px-5 py-3.5">Sessions</th>
            <th className="px-5 py-3.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {students.map((s) => (
            <tr key={s.id} className="transition-colors hover:bg-[#F8FBFF]">
              <td className="px-5 py-3 font-semibold">
                <Link href={`/students/${s.id}`} className="text-[#4A7FC1] hover:underline">
                  {s.name}
                </Link>
              </td>
              <td className="px-5 py-3 text-gray-600">{s.subject}</td>
              <td className="px-5 py-3 text-gray-600">{s.ratePerMin.toFixed(2)}</td>
              <td className="px-5 py-3 text-gray-600">{(s.ratePerMin * 60).toFixed(2)}</td>
              <td className="px-5 py-3 font-medium text-gray-800">{formatCHF(s.totalEarned)}</td>
              <td className="px-5 py-3 text-gray-600">{s.sessions}</td>
              <td className="px-5 py-3">
                <div className="flex min-w-0 max-w-[16rem] flex-wrap gap-2 sm:max-w-none">
                  <button
                    onClick={() => onEdit(s)}
                    className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-[#4A7FC1] hover:text-[#4A7FC1]"
                  >
                    Bearbeiten
                  </button>
                  <button
                    onClick={() => onDeactivate(s.id)}
                    className="rounded-lg border border-red-100 px-2.5 py-1 text-xs font-medium text-red-500 transition hover:border-red-300 hover:bg-red-50"
                  >
                    Deaktivieren
                  </button>
                  <Link
                    href={`/students/${s.id}`}
                    className="rounded-lg border border-blue-100 px-2.5 py-1 text-xs font-medium text-[#4A7FC1] transition hover:border-[#4A7FC1] hover:bg-blue-50"
                  >
                    Abonnement
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
