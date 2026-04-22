-- CreateTable
CREATE TABLE "PlatformSubscription" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "amountCHF" DOUBLE PRECISION NOT NULL,
    "billingMethod" TEXT NOT NULL,
    "durationMonths" INTEGER NOT NULL,
    "startMonth" INTEGER NOT NULL,
    "startYear" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformCharge" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "amountCHF" DOUBLE PRECISION NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformCharge_subscriptionId_month_year_key" ON "PlatformCharge"("subscriptionId", "month", "year");

-- AddForeignKey
ALTER TABLE "PlatformSubscription" ADD CONSTRAINT "PlatformSubscription_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformCharge" ADD CONSTRAINT "PlatformCharge_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PlatformSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
