-- Storno: Rechnung bleibt samt Nummer und PDF bestehen, zaehlt aber weder als
-- Ertrag noch als offene Forderung. Nullable, kein Backfill noetig.
ALTER TABLE "Invoice" ADD COLUMN "voidedAt" TIMESTAMP(3);
