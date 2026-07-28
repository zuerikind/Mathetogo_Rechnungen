-- P2a: rein additive Erweiterung. Keine bestehende Spalte wird geändert oder gelöscht.

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "changeDetectedAt" TIMESTAMP(3),
ADD COLUMN     "downloadedAt" TIMESTAMP(3),
ADD COLUMN     "firstDownloadedAt" TIMESTAMP(3),
ADD COLUMN     "legacyInvoiceNumber" TEXT,
ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- updatedAt: nullable anlegen, aus createdAt backfillen, dann NOT NULL.
-- Ein dauerhafter DB-Default wäre Drift gegenüber dem Prisma-Schema (@updatedAt
-- setzt den Wert im Client), deshalb der dreistufige Weg.
ALTER TABLE "Invoice" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "Invoice" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "Invoice" ALTER COLUMN "updatedAt" SET NOT NULL;

-- CreateTable
CREATE TABLE "InvoiceSnapshot" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "totalCHF" DOUBLE PRECISION NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "pdfPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceAuditLog" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceSnapshot_invoiceId_createdAt_idx" ON "InvoiceSnapshot"("invoiceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceSnapshot_invoiceId_revision_key" ON "InvoiceSnapshot"("invoiceId", "revision");

-- CreateIndex
CREATE INDEX "InvoiceAuditLog_invoiceId_createdAt_idx" ON "InvoiceAuditLog"("invoiceId", "createdAt");

-- CreateIndex
CREATE INDEX "InvoiceAuditLog_action_createdAt_idx" ON "InvoiceAuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_needsReview_idx" ON "Invoice"("needsReview");
