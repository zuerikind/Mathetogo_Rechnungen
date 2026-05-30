-- CreateEnum
CREATE TYPE "AcademigoContactType" AS ENUM ('teacher', 'student');

-- CreateTable
CREATE TABLE "AcademigoSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "messageTemplate" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademigoSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademigoContact" (
    "id" TEXT NOT NULL,
    "tutor24Id" TEXT NOT NULL,
    "contactType" "AcademigoContactType" NOT NULL,
    "name" TEXT NOT NULL,
    "profileUrl" TEXT,
    "messagedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademigoContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AcademigoContact_tutor24Id_contactType_key" ON "AcademigoContact"("tutor24Id", "contactType");
