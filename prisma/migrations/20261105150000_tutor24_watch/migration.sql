-- CreateTable
CREATE TABLE "tutor24_run" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "modus" TEXT NOT NULL,
    "quelle" TEXT NOT NULL,
    "ergebnis" TEXT NOT NULL DEFAULT '',
    "stopp" TEXT,
    "is429" BOOLEAN NOT NULL DEFAULT false,
    "gesendet" INTEGER NOT NULL DEFAULT 0,
    "wuerde" INTEGER NOT NULL DEFAULT 0,
    "daten" JSONB,

    CONSTRAINT "tutor24_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tutor24_signal" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tutor24_signal_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "tutor24_command" (
    "id" TEXT NOT NULL,
    "cmd" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "takenAt" TIMESTAMP(3),
    "result" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "tutor24_command_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tutor24_run_startedAt_idx" ON "tutor24_run"("startedAt");

-- CreateIndex
CREATE INDEX "tutor24_command_takenAt_createdAt_idx" ON "tutor24_command"("takenAt", "createdAt");

