"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { StudentTable } from "@/components/StudentTable";
import type { SessionWithStudent, Student } from "@/lib/ui-types";

type EditableStudent = Student & { totalEarned: number; sessions: number };

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [sessions, setSessions] = useState<SessionWithStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<EditableStudent | null>(null);
  const [form, setForm] = useState({ name: "", subject: "", ratePerMin: "", email: "" });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const [studentsRes, sessionsRes] = await Promise.all([
        fetch("/api/students"),
        fetch(`/api/sessions?year=${new Date().getFullYear()}`),
      ]);
      if (!studentsRes.ok || !sessionsRes.ok) throw new Error("Fehler");
      setStudents((await studentsRes.json()) as Student[]);
      setSessions((await sessionsRes.json()) as SessionWithStudent[]);
    } catch {
      setError("Fehler beim Laden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    return students
      .filter((s) => s.active !== false)
      .map((student) => {
        const own = sessions.filter((ses) => ses.studentId === student.id);
        return {
          ...student,
          totalEarned: own.reduce((acc, s) => acc + s.amountCHF, 0),
          sessions: own.length,
        };
      });
  }, [students, sessions]);

  const monthIncome = sessions
    .filter((s) => s.month === new Date().getMonth() + 1 && s.year === new Date().getFullYear())
    .reduce((acc, s) => acc + s.amountCHF, 0);
  const ytd = sessions
    .filter((s) => s.year === new Date().getFullYear())
    .reduce((acc, s) => acc + s.amountCHF, 0);

  const resetForm = () => setForm({ name: "", subject: "", ratePerMin: "", email: "" });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { ...form, ratePerMin: Number(form.ratePerMin) };
    const url = editing ? `/api/students/${editing.id}` : "/api/students";
    const method = editing ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setPanelOpen(false);
      setEditing(null);
      resetForm();
      void load();
    }
  };

  return (
    <DashboardShell monthIncome={monthIncome} ytdIncome={ytd}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Students</h2>
          <button
            onClick={() => {
              setEditing(null);
              resetForm();
              setPanelOpen(true);
            }}
            className="rounded-md bg-[#0F6E56] px-4 py-2 text-sm font-medium text-white"
          >
            Add student
          </button>
        </div>

        {loading ? (
          <div className="h-64 animate-pulse rounded-lg border border-gray-200 bg-white" />
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error} <button className="underline" onClick={() => void load()}>Retry</button>
          </div>
        ) : (
          <StudentTable
            students={rows}
            onEdit={(student) => {
              setEditing(student);
              setForm({
                name: student.name,
                subject: student.subject,
                ratePerMin: String(student.ratePerMin),
                email: student.email ?? "",
              });
              setPanelOpen(true);
            }}
            onDeactivate={async (studentId) => {
              await fetch(`/api/students/${studentId}`, { method: "DELETE" });
              void load();
            }}
          />
        )}
      </div>

      {panelOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20">
          <div className="h-full w-full max-w-md border-l border-gray-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{editing ? "Edit student" : "Add student"}</h3>
              <button onClick={() => setPanelOpen(false)} className="text-sm text-gray-500">
                Close
              </button>
            </div>
            {editing ? (
              <p className="mt-3 rounded-md border border-orange-200 bg-orange-50 p-3 text-xs text-orange-700">
                Make sure this matches the Google Calendar event title exactly.
              </p>
            ) : null}
            <form onSubmit={onSubmit} className="mt-4 space-y-3">
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Name"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                required
                value={form.subject}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                placeholder="Subject"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                required
                type="number"
                step="0.01"
                value={form.ratePerMin}
                onChange={(e) => setForm((f) => ({ ...f, ratePerMin: e.target.value }))}
                placeholder="Rate per min"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="Email (optional)"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <button className="rounded-md bg-[#0F6E56] px-4 py-2 text-sm font-medium text-white">
                Save
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </DashboardShell>
  );
}
