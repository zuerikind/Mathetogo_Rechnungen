"use client";

import { useCallback, useEffect, useState } from "react";
import { formatAmount, formatDate } from "@/lib/invoice-format";
import { formatUnmatchedHeadline, unmatchedActionHint, type SyncUnmatchedEvent } from "@/lib/sync-unmatched";

/** Offene Löschvormerkung aus /api/sessions/pending-deletion. */
type PendingDeletionRow = {
  id: string;
  date: string;
  durationMin: number;
  amountCHF: number;
  studentName: string;
  reason: string;
  monthDelivered: boolean;
};

/** Offener Kalender-Befund aus /api/calendar-issues. */
type CalendarIssueRow = {
  id: string;
  externalEventId: string;
  reason: SyncUnmatchedEvent["reason"] | IntegrityReason;
  title: string;
  startAt: string | null;
  endAt: string | null;
  calendarId: string | null;
  detailsJson: {
    suggestions?: string[];
    ambiguousStudents?: string[];
    inactiveStudents?: string[];
    // Integritaetsbefunde
    studentName?: string;
    amountCHF?: number;
    parts?: { durationMin: number; amountCHF: number }[];
    monthDelivered?: boolean;
    staleCalEventId?: string;
    // Identitaetsbefunde (Stage 2)
    preserved?: { field: string; historic: number; incoming: number }[];
    newCalEventId?: string;
  } | null;
};

/** Befunde der Integritaets- und Identitaetspruefung — eigener Abschnitt. */
type IntegrityReason =
  | "session_orphan"
  | "duplicate_slot"
  | "identity_ambiguous"
  | "identity_conflict";
const INTEGRITY_REASONS: IntegrityReason[] = [
  "session_orphan",
  "duplicate_slot",
  "identity_ambiguous",
  "identity_conflict",
];
const isIntegrityRow = (row: CalendarIssueRow): boolean =>
  (INTEGRITY_REASONS as string[]).includes(row.reason);

/** Kurzes deutsches Etikett je Grund — kein Rohwert in der Oberfläche. */
const ISSUE_REASON_LABEL: Record<CalendarIssueRow["reason"], string> = {
  no_match: "Kein Treffer",
  ambiguous: "Mehrdeutig",
  inactive_match: "Schüler deaktiviert",
  session_orphan: "Kalendertermin fehlt",
  duplicate_slot: "Mögliche doppelte Lektion",
  identity_ambiguous: "Zuordnung unklar",
  identity_conflict: "Rechnung bleibt wie ausgeliefert",
};

/** Was der Nutzer bei einem Integritaetsbefund tun kann — ohne Fachjargon. */
const INTEGRITY_HINT: Record<IntegrityReason, string> = {
  session_orphan:
    "Diese Lektion steht in der App, hat im Kalender aber keinen Termin mehr — " +
    "etwa weil er verschoben, gelöscht oder in eine Serie umgewandelt wurde. " +
    "Sie zählt weiter zum Betrag. Bitte im Kalender prüfen.",
  duplicate_slot:
    "Für diesen Zeitpunkt stehen mehrere Lektionen in der App — das ergibt einen " +
    "zu hohen Betrag. Meist bleibt beim Ändern eines Termins die alte Zeile zurück.",
  identity_ambiguous:
    "Ein Kalendertermin hat eine neue ID bekommen, und mehrere bestehende Lektionen " +
    "kämen als dieselbe in Frage. Es wurde nichts zusammengelegt und nichts gelöscht — " +
    "bitte im Kalender klären, welche Lektion gemeint ist.",
  identity_conflict:
    "Der Kalendertermin wurde wieder mit der bestehenden Lektion verknüpft, sieht dort " +
    "aber inzwischen anders aus. Weil die Rechnung dieses Monats bereits ausgeliefert ist, " +
    "bleiben Dauer und Betrag wie fakturiert. Korrektur nur über \"Neu ausstellen\".",
};

const zurichDayTime = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const zurichTime = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  hour: "2-digit",
  minute: "2-digit",
});

/** «Mi, 05.08.2026, 14:00–15:00» — leer, wenn Google keine Startzeit geliefert hat. */
function formatIssueWhen(startAt: string | null, endAt: string | null): string {
  if (!startAt) return "";
  const start = new Date(startAt);
  if (!Number.isFinite(start.getTime())) return "";
  const base = zurichDayTime.format(start);
  if (!endAt) return base;
  const end = new Date(endAt);
  if (!Number.isFinite(end.getTime())) return base;
  return `${base}–${zurichTime.format(end)}`;
}

/**
 * Ein Ort für alles, was am Kalenderabgleich noch entschieden werden muss.
 *
 * Zwei Richtungen desselben Abgleichs:
 *   — in der App vorhanden, im Kalender verschwunden  → Löschvormerkung
 *   — im Kalender vorhanden, keinem Schüler zuordenbar → Kalender-Befund
 *
 * Die zweite Hälfte gab es bisher nur in der Antwort des Sync-Requests: wer die
 * Sync-Seite nicht offen hatte, sah sie nie. Beides steht jetzt nebeneinander,
 * im gewohnten Band ganz oben — die Lektionen zählen weiter zum Betrag, bis hier
 * entschieden wird.
 */
export function CalendarReviewPanel({
  refreshKey,
  onResolved,
}: {
  /** Hochzaehlen (z.B. nach einem Sync), um neu zu laden. */
  refreshKey?: number;
  /** Nach einem Entscheid: die Seite ihre eigenen Daten nachladen lassen. */
  onResolved?: () => void;
}) {
  const [rows, setRows] = useState<PendingDeletionRow[]>([]);
  const [totalCHF, setTotalCHF] = useState(0);
  const [issues, setIssues] = useState<CalendarIssueRow[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [deletionRes, issueRes] = await Promise.all([
        fetch("/api/sessions/pending-deletion"),
        fetch("/api/calendar-issues"),
      ]);
      if (deletionRes.ok) {
        const body = (await deletionRes.json()) as { rows?: PendingDeletionRow[]; totalCHF?: number };
        setRows(Array.isArray(body.rows) ? body.rows : []);
        setTotalCHF(typeof body.totalCHF === "number" ? body.totalCHF : 0);
      }
      if (issueRes.ok) {
        const body = (await issueRes.json()) as { rows?: CalendarIssueRow[] };
        setIssues(Array.isArray(body.rows) ? body.rows : []);
      }
    } catch {
      // Das Band ist eine Warnung, kein Kerninhalt — ein Fehlschlag darf die Seite nicht stören.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  /** Entscheid über Vormerkungen; danach Band und Seite neu laden. */
  const resolve = async (action: "confirm" | "reject", sessionIds: string[]) => {
    if (sessionIds.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/sessions/pending-deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sessionIds }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        blockedByDelivered?: { studentName: string }[];
      };
      if (res.redirected || !res.ok) {
        alert(
          res.redirected
            ? "Sitzung abgelaufen — bitte neu anmelden."
            : (body.error ?? "Aktion fehlgeschlagen.")
        );
        return;
      }
      if ((body.blockedByDelivered?.length ?? 0) > 0) {
        alert(
          `${body.blockedByDelivered!.length} Lektion(en) wurden NICHT gelöscht, weil die Rechnung ` +
            `des Monats inzwischen ausgeliefert ist. Die Vormerkung ist aufgehoben; die Abweichung ` +
            `wird über die Abweichungserkennung gemeldet.`
        );
      }
      await load();
      onResolved?.();
    } catch {
      alert("Aktion fehlgeschlagen — keine Änderung vorgenommen.");
    } finally {
      setBusy(false);
    }
  };

  /** Entscheid über Kalender-Befunde: erledigt oder absichtlich kein Schülertermin. */
  const decideIssue = async (action: "resolve" | "ignore", ids: string[]) => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/calendar-issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids }),
      });
      if (res.redirected || !res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        alert(
          res.redirected
            ? "Sitzung abgelaufen — bitte neu anmelden."
            : (body.error ?? "Aktion fehlgeschlagen.")
        );
        return;
      }
      await load();
    } catch {
      alert("Aktion fehlgeschlagen — keine Änderung vorgenommen.");
    } finally {
      setBusy(false);
    }
  };

  if (rows.length === 0 && issues.length === 0) return null;

  // Zwei Arten von Befunden, zwei Abschnitte: «im Kalender, aber keinem Schüler
  // zuzuordnen» (unmatched) und «App und Kalender passen nicht zusammen» (Integrität).
  const unmatchedIssues = issues.filter(
    (i): i is CalendarIssueRow & { reason: SyncUnmatchedEvent["reason"] } => !isIntegrityRow(i)
  );
  const integrityIssues = issues.filter(isIntegrityRow);

  const badgeCls =
    "rounded-full bg-white/80 px-2 py-0.5 text-xs font-bold text-red-900 ring-1 ring-red-200";

  return (
    <section className="rounded-2xl border-2 border-red-300 bg-red-50 p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-red-900">⚠ Kalender prüfen</h2>
        <span className="flex flex-wrap items-center gap-2">
          {rows.length > 0 && (
            <span className={badgeCls}>
              {rows.length} fehlend · {formatAmount(totalCHF)}
            </span>
          )}
          {unmatchedIssues.length > 0 && (
            <span className={badgeCls}>{unmatchedIssues.length} ohne Zuordnung</span>
          )}
          {integrityIssues.length > 0 && (
            <span className={badgeCls}>{integrityIssues.length} Abgleich</span>
          )}
        </span>
      </div>

      {rows.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-red-900">Zu löschende / fehlende Termine</h3>
          <p className="mt-1 text-sm text-red-800">
            Sie zählen weiter zum Betrag, bis du entscheidest.
          </p>

          <ul className="mt-3 space-y-1.5">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-2 rounded-xl bg-white/70 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span className="font-medium text-gray-900">{formatDate(new Date(row.date))}</span>
                  <span className="text-gray-700">{row.studentName}</span>
                  <span className="text-gray-500">{row.durationMin} Min</span>
                  <span className="font-semibold text-gray-900">{formatAmount(row.amountCHF)}</span>
                  <span className="text-xs text-gray-500">{row.reason}</span>
                  {row.monthDelivered ? (
                    <span
                      className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900"
                      title="Der Monat ist ausgeliefert — bestätigen löscht hier nicht, sondern gibt den Fall an die Abweichungserkennung."
                    >
                      Monat ausgeliefert
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void resolve("confirm", [row.id])}
                    className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-40"
                  >
                    Entfernen
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void resolve("reject", [row.id])}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 transition hover:border-gray-400 disabled:opacity-40"
                  >
                    Behalten
                  </button>
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void resolve("confirm", rows.map((r) => r.id))}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-40"
            >
              {busy ? "Läuft…" : `Alle ${rows.length} entfernen`}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void resolve("reject", rows.map((r) => r.id))}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:border-gray-400 disabled:opacity-40"
            >
              Alle behalten
            </button>
          </div>
        </div>
      )}

      {integrityIssues.length > 0 && (
        <div className={rows.length > 0 ? "mt-5 border-t border-red-200 pt-4" : "mt-4"}>
          <h3 className="text-sm font-semibold text-red-900">App und Kalender passen nicht zusammen</h3>
          <p className="mt-1 text-sm text-red-800">
            Reine Prüfung — es wurde nichts geändert. Diese Lektionen zählen weiter zum Betrag,
            auch wenn die Rechnung des Monats bereits ausgeliefert ist.
          </p>

          <ul className="mt-3 space-y-1.5">
            {integrityIssues.map((issue) => {
              const reason = issue.reason as IntegrityReason;
              const parts = issue.detailsJson?.parts ?? [];
              return (
                <li
                  key={issue.id}
                  className="flex flex-col gap-2 rounded-xl bg-white/70 px-3 py-2 text-sm sm:flex-row sm:items-start sm:justify-between"
                >
                  <span className="min-w-0">
                    <span className="block font-medium leading-snug text-gray-900">
                      {issue.title}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600">
                      <span
                        className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700"
                        // Rohe Kalender-ID nur hier, für die Fehlersuche.
                        title={issue.detailsJson?.staleCalEventId ?? undefined}
                      >
                        {ISSUE_REASON_LABEL[reason]}
                      </span>
                      {formatIssueWhen(issue.startAt, issue.endAt) && (
                        <span>{formatIssueWhen(issue.startAt, issue.endAt)}</span>
                      )}
                      {parts.length > 0 && (
                        <span>
                          {parts
                            .map((p) => `${p.durationMin} Min · ${formatAmount(p.amountCHF)}`)
                            .join("  +  ")}
                        </span>
                      )}
                      {typeof issue.detailsJson?.amountCHF === "number" && parts.length > 1 && (
                        <span className="font-semibold text-gray-900">
                          zusammen {formatAmount(issue.detailsJson.amountCHF)}
                        </span>
                      )}
                      {issue.detailsJson?.monthDelivered ? (
                        <span
                          className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900"
                          title="Der Monat ist ausgeliefert — hier wird nichts automatisch geändert. Korrektur läuft über «Neu ausstellen»."
                        >
                          Monat ausgeliefert
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-xs text-gray-600">{INTEGRITY_HINT[reason]}</span>
                  </span>
                  <span className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void decideIssue("resolve", [issue.id])}
                      title="Angeschaut. Besteht der Befund beim nächsten Sync weiter, erscheint er wieder."
                      className="rounded-lg bg-slate-700 px-3 py-1 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
                    >
                      Erledigt
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void decideIssue("ignore", [issue.id])}
                      title="So gewollt — dieser Befund wird nicht mehr gemeldet."
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 transition hover:border-gray-400 disabled:opacity-40"
                    >
                      Ignorieren
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {unmatchedIssues.length > 0 && (
        <div
          className={
            rows.length > 0 || integrityIssues.length > 0
              ? "mt-5 border-t border-red-200 pt-4"
              : "mt-4"
          }
        >
          <h3 className="text-sm font-semibold text-red-900">Nicht zugeordnete Kalendereinträge</h3>
          <p className="mt-1 text-sm text-red-800">
            Im Kalender vorhanden, aber keinem Schüler zuzuordnen — diese Stunden wurden nicht übernommen.
          </p>

          <ul className="mt-3 space-y-1.5">
            {unmatchedIssues.map((issue) => (
              <li
                key={issue.id}
                className="flex flex-col gap-2 rounded-xl bg-white/70 px-3 py-2 text-sm sm:flex-row sm:items-start sm:justify-between"
              >
                <span className="min-w-0">
                  <span className="block font-medium leading-snug text-gray-900">
                    {formatUnmatchedHeadline({
                      title: issue.title,
                      start: issue.startAt ?? "",
                      reason: issue.reason,
                      suggestions: issue.detailsJson?.suggestions,
                      ambiguousStudents: issue.detailsJson?.ambiguousStudents,
                      inactiveStudents: issue.detailsJson?.inactiveStudents,
                    })}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600">
                    <span
                      className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700"
                      title="Grund, warum der Eintrag nicht zugeordnet werden konnte"
                    >
                      {ISSUE_REASON_LABEL[issue.reason]}
                    </span>
                    {formatIssueWhen(issue.startAt, issue.endAt) && (
                      <span>{formatIssueWhen(issue.startAt, issue.endAt)}</span>
                    )}
                  </span>
                  <span className="mt-1 block text-xs text-gray-600">
                    {unmatchedActionHint({
                      title: issue.title,
                      start: issue.startAt ?? "",
                      reason: issue.reason,
                      suggestions: issue.detailsJson?.suggestions,
                    })}
                  </span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void decideIssue("resolve", [issue.id])}
                    title="Geprüft und behoben. Ändert sich der Termin später wesentlich, taucht er wieder auf."
                    className="rounded-lg bg-slate-700 px-3 py-1 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
                  >
                    Erledigt
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void decideIssue("ignore", [issue.id])}
                    title="Kein Schülertermin. Dieser Kalendereintrag wird nicht mehr gemeldet."
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 transition hover:border-gray-400 disabled:opacity-40"
                  >
                    Ignorieren
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
