-- P3: Zählertabelle für Rechnungsnummern. Additiv — keine bestehende Spalte
-- wird geändert, kein Constraint auf "Invoice" gesetzt.

-- CreateTable
CREATE TABLE "InvoiceNumberSequence" (
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceNumberSequence_pkey" PRIMARY KEY ("year")
);

-- Initialisierung aus dem Bestand: höchste bereits vergebene laufende Nummer
-- je Jahr. Gruppiert wird nach dem Jahr IM Nummernstring (nicht nach
-- Invoice.year), weil genau dieser Präfix bei der Vergabe wieder entsteht.
-- Duplikate im Bestand stören hier nicht — MAX() ist davon unberührt.
INSERT INTO "InvoiceNumberSequence" ("year", "lastNumber", "updatedAt")
SELECT
    CAST(substring("invoiceNumber" from '^(\d{4})-') AS INTEGER) AS "year",
    MAX(CAST(substring("invoiceNumber" from '^\d{4}-(\d{4})$') AS INTEGER)) AS "lastNumber",
    CURRENT_TIMESTAMP
FROM "Invoice"
WHERE "invoiceNumber" ~ '^\d{4}-\d{4}$'
GROUP BY 1
ON CONFLICT ("year") DO NOTHING;
