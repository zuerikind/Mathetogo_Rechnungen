-- Vormerkung statt sofortiger Loeschung: der Sync markiert Lektionen, deren
-- Kalendereintrag nachweislich geloescht wurde, und wartet auf Bestaetigung.
-- Nullable, kein Backfill noetig.
ALTER TABLE "Session" ADD COLUMN "pendingDeletionAt" TIMESTAMP(3);
