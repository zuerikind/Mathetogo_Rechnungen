CREATE TYPE "MiscEarningSource" AS ENUM ('manual', 'q1_adjustment');

CREATE TABLE "MiscEarning" (
    "id"        TEXT NOT NULL,
    "year"      INTEGER NOT NULL,
    "month"     INTEGER NOT NULL,
    "amountCHF" DOUBLE PRECISION NOT NULL,
    "label"     TEXT,
    "source"    "MiscEarningSource" NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MiscEarning_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MiscEarning_year_month_source_key" ON "MiscEarning"("year", "month", "source");
