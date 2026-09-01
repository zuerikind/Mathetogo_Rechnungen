-- Kalenderabsagen sollen nicht mehr von Hand kontrolliert werden muessen.
--
-- Dafuer fehlten zwei Dinge. Erstens eine Identitaet, die einen Wechsel der
-- Google-Event-ID ueberlebt: `calEventId` allein hat dreimal (Leo, Elenor,
-- Luca) eine zweite Zeile entstehen lassen, weil Google derselben Lektion eine
-- neue ID gab. iCalUID, recurringEventId und originalStartAt sind Googles
-- eigene, stabilere Anker.
--
-- Zweitens ein Zustand zwischen "gibt es" und "geloescht". Bisher blieb nur die
-- Wahl zwischen "Lektion steht weiter im Betrag" und "Zeile weg". Das erste
-- fakturiert abgesagte Lektionen, das zweite zerreisst die Belegkette und ist
-- nicht umkehrbar. cancelledAt ist die dritte Moeglichkeit: die Zeile bleibt
-- vollstaendig erhalten, faellt aber aus jeder Geldabfrage — und der Sync hebt
-- den Storno von selbst wieder auf, sobald der Termin wieder auftaucht.
--
-- Rein additiv: sieben nullable Spalten und zwei Indizes. Kein Backfill, kein
-- DROP, kein ALTER an bestehenden Werten. Bestehende Zeilen haben cancelledAt
-- IS NULL und verhalten sich damit exakt wie bisher.

ALTER TABLE "Session" ADD COLUMN "iCalUID"          TEXT;
ALTER TABLE "Session" ADD COLUMN "recurringEventId" TEXT;
ALTER TABLE "Session" ADD COLUMN "originalStartAt"  TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "calStatus"        TEXT;
ALTER TABLE "Session" ADD COLUMN "calUpdatedAt"     TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "cancelledAt"      TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "cancelReason"     TEXT;

-- Identitaetsaufloesung Stufe c.
CREATE INDEX "Session_iCalUID_originalStartAt_idx" ON "Session"("iCalUID", "originalStartAt");
-- Jede Geldabfrage filtert jetzt zusaetzlich auf cancelledAt IS NULL.
CREATE INDEX "Session_year_month_cancelledAt_idx" ON "Session"("year", "month", "cancelledAt");
