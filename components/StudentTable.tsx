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
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr className="text-left text-gray-600">
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Subject</th>
            <th className="px-4 py-3">Rate (CHF/min)</th>
            <th className="px-4 py-3">Rate (CHF/hr)</th>
            <th className="px-4 py-3">Total earned</th>
            <th className="px-4 py-3">Sessions</th>
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {students.map((s) => (
            <tr key={s.id}>
              <td className="px-4 py-3 font-medium text-gray-900">
                <Link href={`/students/${s.id}`} className="text-[#0F6E56] hover:underline">
                  {s.name}
                </Link>
              </td>
              <td className="px-4 py-3">{s.subject}</td>
              <td className="px-4 py-3">{s.ratePerMin.toFixed(2)}</td>
              <td className="px-4 py-3">{(s.ratePerMin * 60).toFixed(2)}</td>
              <td className="px-4 py-3">{formatCHF(s.totalEarned)}</td>
              <td className="px-4 py-3">{s.sessions}</td>
              <td className="px-4 py-3">
                <div className="flex gap-2">
                  <button
                    onClick={() => onEdit(s)}
                    className="rounded border border-gray-300 px-2 py-1 text-xs"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onDeactivate(s.id)}
                    className="rounded border border-orange-300 px-2 py-1 text-xs text-orange-700"
                  >
                    Deactivate
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
