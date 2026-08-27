-- Nicht zugeordnete Kalendereintraege bekommen ein Gedaechtnis.
--
-- Die Erkennung (lib/sync-unmatched) gab es schon, aber der Befund lebte nur in
-- der Antwort des Sync-Requests. Wer die Sync-Seite nicht offen hatte, sah ihn
-- nie. Jetzt steht er neben den Loeschvormerkungen auf dem Dashboard und laesst
-- sich einmal entscheiden: "Erledigt" (geprueft/behoben) oder "Ignorieren"
-- (absichtlich kein Schuelertermin).
--
-- Identitaet ist die Google-Event-ID. externalUpdatedAt ist Googles eigener
-- `updated`-Zeitstempel und dient als Versionsmarke fuer "materiell geaendert".

CREATE TYPE "CalendarIssueStatus" AS ENUM ('open', 'resolved', 'ignored');

CREATE TABLE "CalendarSyncIssue" (
    "id"                TEXT NOT NULL,
    "externalEventId"   TEXT NOT NULL,
    "externalUpdatedAt" TIMESTAMP(3),
    "status"            "CalendarIssueStatus" NOT NULL DEFAULT 'open',
    "reason"            TEXT NOT NULL,
    "title"             TEXT NOT NULL,
    "startAt"           TIMESTAMP(3),
    "endAt"             TIMESTAMP(3),
    "calendarId"        TEXT,
    "detailsJson"       JSONB,
    "firstSeenAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt"        TIMESTAMP(3),
    "ignoredAt"         TIMESTAMP(3),
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarSyncIssue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CalendarSyncIssue_externalEventId_key" ON "CalendarSyncIssue"("externalEventId");
CREATE INDEX "CalendarSyncIssue_status_lastSeenAt_idx" ON "CalendarSyncIssue"("status", "lastSeenAt");
