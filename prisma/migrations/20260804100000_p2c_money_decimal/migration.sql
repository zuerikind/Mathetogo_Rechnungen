-- P2c: die 18 Geldfelder von double precision auf numeric.
--
-- USING round(...) statt eines nackten Casts: die Spalten enthalten 31 Werte mit
-- Float-Rauschen (Invoice.totalCHF 495.0000000000001 und 30 Session-Betraege mit
-- Abweichungen um 1e-14). Ein direkter Cast auf numeric(10,2) wuerde dieselbe
-- Rundung vornehmen, aber round() macht die Absicht sichtbar: diese Werte sollen
-- sich aendern, das ist der Zweck der Migration und keine Nebenwirkung.
--
-- Vorher geprueft: 0 echte Verluste ueber alle 902 gefuellten Werte, kein Wert
-- ueberschreitet die Zielpraezision. Alle Spalten behalten ihre Nullbarkeit.

-- Betraege: numeric(10,2)
ALTER TABLE "Session"              ALTER COLUMN "amountCHF"      TYPE numeric(10,2) USING round("amountCHF"::numeric, 2);
ALTER TABLE "Invoice"              ALTER COLUMN "totalCHF"       TYPE numeric(10,2) USING round("totalCHF"::numeric, 2);
ALTER TABLE "InvoiceSnapshot"      ALTER COLUMN "totalCHF"       TYPE numeric(10,2) USING round("totalCHF"::numeric, 2);
ALTER TABLE "PlatformSubscription" ALTER COLUMN "amountCHF"      TYPE numeric(10,2) USING round("amountCHF"::numeric, 2);
ALTER TABLE "PlatformCharge"       ALTER COLUMN "amountCHF"      TYPE numeric(10,2) USING round("amountCHF"::numeric, 2);
ALTER TABLE "MiscEarning"          ALTER COLUMN "amountCHF"      TYPE numeric(10,2) USING round("amountCHF"::numeric, 2);
ALTER TABLE "AdditionalEarning"    ALTER COLUMN "amountCHF"      TYPE numeric(10,2) USING round("amountCHF"::numeric, 2);
ALTER TABLE "MonthlyExpense"       ALTER COLUMN "amountCHF"      TYPE numeric(10,2) USING round("amountCHF"::numeric, 2);
ALTER TABLE "DanceEarning"         ALTER COLUMN "amountCHF"      TYPE numeric(10,2) USING round("amountCHF"::numeric, 2);
ALTER TABLE "DanceEarning"         ALTER COLUMN "amountOriginal" TYPE numeric(10,2) USING round("amountOriginal"::numeric, 2);
ALTER TABLE "TutorProfile"         ALTER COLUMN "manualQ1M1Chf"  TYPE numeric(10,2) USING round("manualQ1M1Chf"::numeric, 2);
ALTER TABLE "TutorProfile"         ALTER COLUMN "manualQ1M2Chf"  TYPE numeric(10,2) USING round("manualQ1M2Chf"::numeric, 2);
ALTER TABLE "TutorProfile"         ALTER COLUMN "manualQ1M3Chf"  TYPE numeric(10,2) USING round("manualQ1M3Chf"::numeric, 2);

-- Raten: numeric(6,4)
--
-- Vier Nachkommastellen und nicht zwei: die Rate ist ein Preis PRO MINUTE. Auf
-- zwei Stellen gerundet waere der kleinste Schritt 0.01/Min = 0.60/Stunde, und
-- ein Stundensatz, der nicht auf 0.60 aufgeht, liesse sich gar nicht erst
-- eintragen. Die Beträge bleiben bei (10,2) — dort ist der Rappen die
-- natuerliche Einheit, bei der Rate ist er es nicht.
--
-- (6,4) heisst Maximum 99.9999. Vorher geprueft: 37 Student- und 19
-- StudentRateHistory-Zeilen, alle Raten zwischen 1.0 und 1.8, keine mit mehr als
-- vier Nachkommastellen — die Rundung aendert hier keinen einzigen Wert.
ALTER TABLE "Student"              ALTER COLUMN "ratePerMin"     TYPE numeric(6,4)  USING round("ratePerMin"::numeric, 4);
ALTER TABLE "StudentRateHistory"   ALTER COLUMN "ratePerMin"     TYPE numeric(6,4)  USING round("ratePerMin"::numeric, 4);

-- Wechselkurse: numeric(12,6)
ALTER TABLE "FxRateSnapshot"       ALTER COLUMN "chfPerEur"      TYPE numeric(12,6) USING round("chfPerEur"::numeric, 6);
ALTER TABLE "FxRateSnapshot"       ALTER COLUMN "chfPerMxn"      TYPE numeric(12,6) USING round("chfPerMxn"::numeric, 6);
ALTER TABLE "DanceEarning"         ALTER COLUMN "chfRate"        TYPE numeric(12,6) USING round("chfRate"::numeric, 6);
