-- DropTable
DROP TABLE "course_demand";

-- CreateTable
CREATE TABLE "tutor24_lead" (
    "id" TEXT NOT NULL,
    "inseratId" TEXT,
    "conversationId" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "quelle" TEXT NOT NULL,
    "listingHash" TEXT NOT NULL DEFAULT '',
    "faecher" TEXT NOT NULL DEFAULT '',
    "stufe" TEXT NOT NULL DEFAULT '',
    "kategorie" TEXT NOT NULL DEFAULT '',
    "kursgruppe" TEXT NOT NULL DEFAULT '',
    "sicherheit" TEXT NOT NULL DEFAULT '',
    "ausschluss" TEXT NOT NULL DEFAULT '',
    "anlass" TEXT NOT NULL DEFAULT '',
    "ort" TEXT NOT NULL DEFAULT '',
    "ortsname" TEXT NOT NULL DEFAULT '',
    "wer" TEXT NOT NULL DEFAULT 'unklar',
    "anrede" TEXT NOT NULL DEFAULT 'Sie',
    "kind" TEXT,
    "sprache" TEXT NOT NULL DEFAULT 'de',
    "grund" TEXT NOT NULL DEFAULT '',
    "kursId" TEXT,
    "freigabeKursId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'offen',
    "geantwortet" TEXT NOT NULL DEFAULT '',
    "antwortDatum" TEXT NOT NULL DEFAULT '',
    "antwort" TEXT NOT NULL DEFAULT '',
    "einzelunterricht" BOOLEAN NOT NULL DEFAULT false,
    "auszug" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "tutor24_lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tutor24_message" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "art" TEXT NOT NULL,
    "kursId" TEXT,
    "variante" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'gesendet',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tutor24_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tutor24_lead_inseratId_key" ON "tutor24_lead"("inseratId");

-- CreateIndex
CREATE UNIQUE INDEX "tutor24_lead_conversationId_key" ON "tutor24_lead"("conversationId");

-- CreateIndex
CREATE INDEX "tutor24_lead_kursgruppe_createdAt_idx" ON "tutor24_lead"("kursgruppe", "createdAt");

-- CreateIndex
CREATE INDEX "tutor24_message_leadId_idx" ON "tutor24_message"("leadId");

-- AddForeignKey
ALTER TABLE "tutor24_message" ADD CONSTRAINT "tutor24_message_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "tutor24_lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

