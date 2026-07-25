ALTER TABLE "Invoice"
ADD COLUMN "reminderStage" INTEGER NOT NULL DEFAULT 0;

-- Bereits gemahnte Rechnungen ohne bekannte Stufe: mindestens Stufe 1.
UPDATE "Invoice" SET "reminderStage" = 1 WHERE "reminderSentAt" IS NOT NULL;
