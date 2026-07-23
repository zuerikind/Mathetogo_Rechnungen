-- CreateTable
CREATE TABLE "ReminderTemplate" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "stage1" TEXT NOT NULL,
    "stage2" TEXT NOT NULL,
    "stage3" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderTemplate_pkey" PRIMARY KEY ("id")
);

-- Seed singleton default row (idempotent; app manages @updatedAt thereafter)
INSERT INTO "ReminderTemplate" ("id", "stage1", "stage2", "stage3", "updatedAt")
VALUES (
  'default',
  E'Hallo zusammen,\n\nich hoffe, es geht euch gut. Ich wollte euch kurz daran erinnern, dass die Rechnung für den Monat {periode} noch offen und mittlerweile überfällig ist.\n\nFalls ihr den Betrag bereits überwiesen habt, ist die Zahlung vermutlich noch unterwegs. In diesem Fall könnt ihr diese Nachricht natürlich einfach ignorieren.\n\nVielen Dank im Voraus und liebe Grüsse\nOmid',
  E'Hallo zusammen,\n\nich wollte euch nochmals kurz daran erinnern, dass die Rechnung für den Monat {periode} weiterhin offen ist. Mittlerweile sind bereits 10 Tage seit dem angegebenen Zahlungsdatum vergangen.\n\nIch wäre euch dankbar, wenn ihr den ausstehenden Betrag so schnell wie möglich überweisen könntet.\n\nFalls ihr die Zahlung inzwischen bereits vorgenommen habt, könnt ihr diese Nachricht natürlich ignorieren.\n\nVielen Dank und liebe Grüsse\nOmid',
  E'Hallo zusammen,\n\nich möchte euch nochmals darauf hinweisen, dass die Rechnung für den Monat {periode} weiterhin offen ist. Mittlerweile sind bereits 20 Tage seit dem angegebenen Zahlungsdatum vergangen.\n\nIch bitte euch daher, den ausstehenden Betrag umgehend zu überweisen. Bitte beachtet, dass bei einer weiteren Verzögerung Mahngebühren und Verzugszinsen anfallen können.\n\nFalls ihr die Zahlung inzwischen bereits vorgenommen habt, könnt ihr diese Nachricht natürlich ignorieren.\n\nVielen Dank für die schnelle Erledigung und liebe Grüsse\nOmid',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
