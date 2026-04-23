UPDATE "Invoice"
SET
  "sentAt" = COALESCE("sentAt", NOW()),
  "paidAt" = NOW()
WHERE
  "month" <= 4;
