-- AlterTable
ALTER TABLE "Tutor24Contact" ADD COLUMN "kursId" TEXT;

-- CreateTable
CREATE TABLE "course_demand" (
    "id" TEXT NOT NULL,
    "tutor24Id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fach" TEXT NOT NULL,
    "stufe" TEXT NOT NULL,
    "kategorie" TEXT NOT NULL,
    "kursgruppe" TEXT NOT NULL,
    "anlass" TEXT NOT NULL,
    "ort" TEXT NOT NULL,
    "ortsname" TEXT,
    "sicherheit" TEXT NOT NULL,
    "grund" TEXT NOT NULL,
    "kursId" TEXT,
    "auszug" TEXT NOT NULL,
    "quelle" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'offen',

    CONSTRAINT "course_demand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_demand_tutor24Id_key" ON "course_demand"("tutor24Id");

-- CreateIndex
CREATE INDEX "course_demand_kursgruppe_fach_createdAt_idx" ON "course_demand"("kursgruppe", "fach", "createdAt");
