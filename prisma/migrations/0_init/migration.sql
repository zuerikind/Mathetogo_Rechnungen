-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "totalCHF" DOUBLE PRECISION NOT NULL,
    "sessionIds" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3),
    "pdfPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "amountCHF" DOUBLE PRECISION NOT NULL,
    "calEventId" TEXT,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "ratePerMin" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CHF',
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TutorProfile" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL DEFAULT 'Max Mustermann',
    "email" TEXT NOT NULL DEFAULT 'max@example.ch',
    "address" TEXT NOT NULL DEFAULT 'Musterstrasse 1, 8000 Zürich',
    "phone" TEXT NOT NULL DEFAULT '+41 79 000 00 00',
    "iban" TEXT NOT NULL DEFAULT 'CH00 0000 0000 0000 0000 0',
    "bankName" TEXT NOT NULL DEFAULT 'Zürcher Kantonalbank',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TutorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_studentId_month_year_key" ON "Invoice"("studentId" ASC, "month" ASC, "year" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Session_calEventId_key" ON "Session"("calEventId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Student_name_key" ON "Student"("name" ASC);

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
