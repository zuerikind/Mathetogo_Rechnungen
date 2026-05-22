-- CreateTable
CREATE TABLE "AdditionalEarning" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "amountCHF" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdditionalEarning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdditionalEarning_year_month_idx" ON "AdditionalEarning"("year", "month");
