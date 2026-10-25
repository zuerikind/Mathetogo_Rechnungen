-- Schulstufe pro Schueler und das zuletzt bestaetigte Schuljahr.
ALTER TABLE "Student" ADD COLUMN "level" TEXT;
ALTER TABLE "TutorProfile" ADD COLUMN "levelsReviewedYear" INTEGER;
-- Das laufende Schuljahr 2026/27 gilt als geprueft: die Stufen werden jetzt erst eingetragen.
UPDATE "TutorProfile" SET "levelsReviewedYear" = 2026 WHERE id = 'default';
