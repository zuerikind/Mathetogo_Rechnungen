# Pitfalls Research

**Domain:** Subscription billing line items added to an existing manual invoicing system (Next.js + Prisma + react-pdf)
**Researched:** 2026-04-22
**Confidence:** HIGH — all pitfalls are grounded in the actual codebase files read during research

---

## Critical Pitfalls

### Pitfall 1: Double-Counting Platform Revenue on the Dashboard

**What goes wrong:**
The dashboard `calcStats` function sums `session.amountCHF` for every session in the year. When a platform charge is billed via invoice, `Invoice.totalCHF` already includes the platform fee (tutoring subtotal + platform fee = total). If the dashboard is then also updated to sum `PlatformCharge.amountCHF` independently and add that to the "total revenue" figure, the platform fee is counted twice — once inside the invoice total and once as a standalone charge sum.

**Why it happens:**
The dashboard currently reads from the `Session` table only — it does not read invoices at all. When the developer adds platform revenue, the natural instinct is to add a second query (`SUM(PlatformCharge.amountCHF)`) and add it to the existing session sum. But for invoice-billed students, that charge already inflates `Invoice.totalCHF`, which will eventually be used if invoice totals are ever surfaced. Even within this version, if the tutor-facing "platform revenue" card sums all charges regardless of billing method while the session revenue already included that money in an invoice, the tutor sees inflated totals.

**How to avoid:**
Define a single authoritative revenue source for each billing path:
- **Tutoring revenue** = sum of `Session.amountCHF` (unchanged)
- **Platform revenue** = sum of `PlatformCharge.amountCHF` WHERE `paidAt IS NOT NULL` OR `billingMethod = 'INVOICE'` (meaning it is captured in the invoice)

Never add platform revenue to the general session sum. Keep platform revenue as a separate stat card (`DASH-02`) and ensure the "total" stat card is `tutoring + platform`, not `tutoring + sessions-already-including-platform`.

The safest model: treat `Invoice.totalCHF` as the billing record and never use it for dashboard stats. Use source-of-truth tables (`Session`, `PlatformCharge`) only, aggregated with clear scope per billing method.

**Warning signs:**
- A student with a 50 CHF/month platform fee shows 50 CHF more income than expected in the monthly totals
- Yearly income card grows by the platform fee amount twice when toggling between months
- Tutor notices "platform revenue" + "tutoring revenue" exceed what was actually invoiced

**Phase to address:**
Schema + Data Model phase (before any dashboard work). Lock down the revenue accounting rule in a comment block in `lib/invoice.ts` and the future `lib/platform-charges.ts` before either is used in the dashboard.

---

### Pitfall 2: Generating Duplicate Monthly Charges for a Subscription

**What goes wrong:**
For a 6-month subscription, 6 `PlatformCharge` rows must be created (one per month). If the charge-generation logic runs more than once — because the subscription is re-saved, the tutor clicks "activate" twice, or a background job re-runs — duplicate charges appear for the same `(subscriptionId, month, year)` combination. The tutor then sees the student charged twice for October, the invoice total is wrong, and if the PDF has already been generated, it will not include the duplicate but the database total will.

**Why it happens:**
There is no natural unique constraint preventing two `PlatformCharge` rows for the same subscription month. Charge generation is an imperative action (a form submission or button click), not a declarative schema guarantee. Without a database-level guard, any network retry, double-click, or re-activation creates duplicates silently.

**How to avoid:**
Add a database-level unique constraint on `PlatformCharge`:
```
@@unique([subscriptionId, month, year])
```
Use `prisma.platformCharge.upsert` (not `create`) when generating charges, keyed on that unique index. This makes the operation idempotent: running it twice produces the same result as running it once. On the application layer, also guard the "activate subscription" action with a check for existing charges before generating new ones.

**Warning signs:**
- A student's subscription payment history shows two entries for the same month
- Invoice total is double what is expected for that month
- `prisma.platformCharge.count({ where: { subscriptionId, month, year } })` returns > 1

**Phase to address:**
Schema + Data Model phase. The unique constraint must be in the migration before any charge-generation API route is written.

---

### Pitfall 3: Month Arithmetic Wrapping Past December

**What goes wrong:**
A 6-month subscription starting in October 2025 must generate charges for Oct, Nov, Dec 2025, Jan, Feb, Mar 2026. Naive arithmetic (`startMonth + i`) produces months 10, 11, 12, 13, 14, 15 — month values 13–15 are invalid and will either be stored as nonsense data or cause Prisma queries to return zero results because no session or charge has month=13.

**Why it happens:**
JavaScript `Date` objects handle month rollover automatically, but if the developer calculates month/year manually using integer addition (e.g., `month + i` and `year`), they bypass that safety. The `month` field in this schema is stored as an `Int` (1–12), so month=13 will be stored without a database constraint rejecting it, and queries will silently find nothing.

**How to avoid:**
Use a dedicated utility function for month offset arithmetic:
```typescript
function addMonths(month: number, year: number, offset: number): { month: number; year: number } {
  const date = new Date(year, month - 1 + offset, 1);
  return { month: date.getMonth() + 1, year: date.getFullYear() };
}
```
Use this function everywhere monthly charges are generated. Add a Prisma-level check constraint if Supabase PostgreSQL supports it, or add an application-level assertion that `month >= 1 && month <= 12` before any insert.

**Warning signs:**
- A 6-month subscription starting in September only shows 3 or 4 charges instead of 6
- Dashboard for January of the next year shows no platform revenue even though charges should exist
- `prisma.platformCharge.findMany({ where: { month: { gt: 12 } } })` returns rows

**Phase to address:**
Charge generation API phase. Write and test the `addMonths` utility before writing the subscription activation endpoint.

---

### Pitfall 4: Invoice PDF Breaking When a Platform Line Item Is Added

**What goes wrong:**
The current `InvoicePDF` component in `components/InvoicePDF.tsx` has a fixed four-column table layout (`colDate` 22%, `colDuration` 18%, `colSubject` 38%, `colAmount` 22%) designed exclusively for session rows. A platform line item has no date, no duration, and no subject — it has a label like "Mathetogo Platform – Oktober 2025" and an amount. Attempting to render it in the existing row structure produces either empty cells (ugly) or a layout crash if the component receives a mixed array it was not designed to handle. The `totalsWrap` uses a hardcoded `marginLeft: "56%"` which assumes the table always has session rows above it — if a platform-only invoice is ever generated, this will be visually broken.

**Why it happens:**
The invoice payload type `InvoicePayload` in `lib/invoice.ts` only carries `sessions: InvoiceSession[]` and a flat `totalCHF`. There is no slot for "additional line items". Developers adding a platform line item tend to either (a) add a fake session object to the sessions array, which corrupts the session data, or (b) hard-code a special case in the PDF renderer, creating a tight coupling that breaks on the next change.

**How to avoid:**
Extend `InvoicePayload` with a typed line-item concept before touching the PDF renderer:
```typescript
type InvoiceLineItem = {
  label: string;         // "Mathetogo Platform – Oktober 2025"
  amountCHF: number;
  type: 'session' | 'platform';
};
```
Render a separate section in the PDF for non-session line items, below the sessions table and above the totals block. Give it its own styling (requirement INV-03: "visually distinct"). Never mix platform items into the `sessions` array. Update `totalCHF` calculation in `getInvoicePayload` to include the platform fee after sessions are summed.

**Warning signs:**
- PDF preview renders a row with blank Date and Duration columns for the platform fee
- `react-pdf` throws during render because a value expected to be a number is undefined
- The "TOTAL" row shows only the tutoring subtotal, not including the platform fee
- `InvoicePDF` receives a session object with `durationMin: 0` that is actually a platform charge

**Phase to address:**
Invoice integration phase (INV-01 to INV-03). The `InvoicePayload` type extension must be done before writing any PDF rendering code.

---

### Pitfall 5: Invoice `totalCHF` Not Updated to Include the Platform Fee

**What goes wrong:**
The existing `generate` route in `app/api/invoice/generate/route.ts` calls `getInvoicePayload` which computes `totalCHF` as `sessions.reduce((acc, s) => acc + s.amountCHF, 0)` — sessions only. When the invoice is upserted into the database, `totalCHF` is stored as the session total. If the platform fee is appended to the PDF visually but not to the stored `totalCHF`, the database record is wrong. Later queries that read `Invoice.totalCHF` (e.g., for reporting or the invoices list) will undercount the actual amount billed to the student.

**Why it happens:**
The PDF and the database record can diverge when a developer updates one without the other. The payload flows `sessions → totalCHF → PDF render AND database upsert`. If the PDF renderer is updated to add a platform line item visually but `getInvoicePayload` is not updated to add the fee to `totalCHF`, the two are out of sync.

**How to avoid:**
`totalCHF` in `getInvoicePayload` must be computed as:
```typescript
const sessionTotal = sessions.reduce((acc, s) => acc + s.amountCHF, 0);
const platformFee = platformCharge?.amountCHF ?? 0;
const totalCHF = sessionTotal + platformFee;
```
This single value is then used for both the PDF total and the database record. There is no other place where `totalCHF` should be assembled. Add a test: generate an invoice for a student with a platform charge and assert `Invoice.totalCHF === sessionTotal + platformFee`.

**Warning signs:**
- Invoice PDF shows the correct total but `prisma.invoice.findUnique` returns a lower `totalCHF`
- The invoices list page shows a different total than the PDF for the same invoice
- Tutor reports the amount on the invoice does not match what is recorded in the system

**Phase to address:**
Invoice integration phase. Update `getInvoicePayload` atomically alongside the PDF renderer changes.

---

### Pitfall 6: Prisma Migration Failure on Supabase with Existing Data

**What goes wrong:**
The new `PlatformSubscription` and `PlatformCharge` models require new tables. If the migration also involves altering the existing `Invoice` table (e.g., adding a foreign key or a new nullable column), Prisma's migration on Supabase may fail if there are rows that violate the new constraint, or the migration may succeed but leave the schema in a partial state if the database user lacks sufficient privileges on Supabase's managed PostgreSQL. The `directUrl` in the schema suggests the project already uses the Supabase direct connection for migrations, which is correct — but `prisma migrate deploy` on Supabase can time out for large batch operations or fail silently on RLS-protected tables.

**Why it happens:**
Supabase enables Row-Level Security (RLS) by default on new tables. Prisma migrations run as the `postgres` superuser via `directUrl`, which bypasses RLS — but if the migration is run via the Supabase dashboard SQL editor instead of `prisma migrate deploy`, it runs as the `anon` or `authenticated` role and may fail with permission errors. Additionally, adding a NOT NULL column without a default to a table that already has rows will fail immediately.

**How to avoid:**
- Always run migrations via `npx prisma migrate deploy` using the `DIRECT_URL` connection string, not the Supabase SQL editor
- Make all new columns on existing tables nullable or supply a `@default(...)` in the migration
- Add RLS policies to new tables immediately after migration if they will ever be accessed via Supabase's REST API (though this app uses Prisma directly, so RLS is less critical)
- Test the migration on a Supabase branch or staging project before running on production
- Keep `PlatformSubscription` and `PlatformCharge` as new tables only — do not alter the existing `Invoice` table structure; use a foreign key from `PlatformCharge` to `Invoice` if linking is needed, but keep it optional

**Warning signs:**
- `prisma migrate deploy` exits with "column cannot be null" error
- Supabase dashboard shows the new tables but Prisma Client still throws "table does not exist"
- `prisma generate` succeeds but queries fail at runtime because `DATABASE_URL` (pooled) was used for migration instead of `DIRECT_URL`

**Phase to address:**
Schema + Data Model phase. Run the migration in a controlled environment first, with a rollback plan (the migration down file must be verified).

---

### Pitfall 7: Subscription Activation Logic Runs on Every Edit, Not Just Creation

**What goes wrong:**
If the "save subscription" handler generates monthly charges (requirement SUB-04), and the same handler is used for both creating a new subscription (SUB-01) and editing an existing one (SUB-02), then editing the amount or billing method of a subscription triggers charge generation again. Combined with the absence of a unique constraint (Pitfall 2), this creates duplicate charges. Even with a unique constraint causing upserts, an edit that changes `amountCHF` will silently update all future unpaid charges — which may or may not be the intended behavior.

**Why it happens:**
CRUD forms in Next.js naturally share a single API route (`POST` for create, `PUT`/`PATCH` for edit). Developers forget that the side effect (charge generation) should only run on creation or on explicit reactivation, not on every save.

**How to avoid:**
Separate the "create subscription + generate charges" flow from "edit subscription metadata" flow. Use distinct API routes or explicit action types:
- `POST /api/subscriptions` → creates subscription AND generates all monthly charges
- `PATCH /api/subscriptions/[id]` → updates `amountCHF` or `billingMethod` only, does NOT regenerate charges; optionally updates future unpaid charges if `amountCHF` changes
- `POST /api/subscriptions/[id]/deactivate` → marks subscription inactive, does NOT delete charges already generated

**Warning signs:**
- After editing a subscription's amount, the student's payment history shows double entries for future months
- Tutor reports "I just updated the price and now there are two charges for November"
- `prisma.platformCharge.count({ where: { subscriptionId } })` returns more rows than the subscription duration

**Phase to address:**
Subscription management phase (SUB-01 to SUB-03). Define the API contract before writing any form handler.

---

### Pitfall 8: Dashboard Stats Miss the Year Filter for Platform Revenue

**What goes wrong:**
Requirement DASH-03 says platform revenue must respect the existing year/month filter. The current dashboard fetches sessions filtered by `year` (`/api/sessions?year=${year}`). If the new platform revenue stat is fetched without a `year` parameter — or if the API defaults to "all time" — the platform revenue figure will not change when the tutor switches between years. The tutor will see 2024 platform revenue displayed next to 2025 session revenue.

**Why it happens:**
Platform charges have their own `month` and `year` fields (to be added). A developer adding a quick "total platform revenue" query may forget to scope it to the current dashboard year, especially if the query lives in a separate API endpoint from the session query.

**How to avoid:**
The platform revenue API endpoint must accept `year` (and optionally `month`) parameters that match the dashboard's existing filter state. Alternatively, extend the existing `/api/sessions` response or create a unified `/api/dashboard?year=X` endpoint that returns both session stats and platform charge stats together, filtered consistently.

**Warning signs:**
- Changing the year selector on the dashboard changes session stats but not the platform revenue card
- The "Platform YTD" figure is the same regardless of which year is selected
- Adding a 2026 subscription causes the "platform revenue" card to change on the 2025 dashboard view

**Phase to address:**
Dashboard integration phase (DASH-01 to DASH-03). Define the API contract for revenue stats before building the UI.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Storing platform charges inside `Invoice.sessionIds` JSON blob | No schema change needed | Impossible to query charges independently; breaks payment tracking | Never — the sessionIds field is a string blob, not a relational reference |
| Hard-coding platform line item into PDF as a special-case `if` branch | Fast to ship | PDF component becomes untestable; breaks when a second line item type is added | Never — use a typed line-item array from the start |
| Using `Invoice.totalCHF` as the source for dashboard revenue stats | Single query | Double-counting risk when platform fee is in both Invoice and PlatformCharge; Invoice is a billing artifact, not a revenue ledger | Never for aggregated stats — use source tables (Session, PlatformCharge) |
| Generating all 6 charges immediately on subscription creation (no background job) | Simple, no queue needed | If subscription is cancelled after month 2, charges for months 3–6 exist and must be cleaned up | Acceptable at this scale — just ensure deactivation deletes future unpaid charges |
| Skipping a migration test on staging | Faster to deploy | Production migration failure with no rollback path | Never for schema changes affecting existing tables |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| react-pdf line items | Passing `undefined` for `durationMin` on a platform row causes the existing `formatDuration` call to produce "NaN" or throw | Add a type guard: only call `formatDuration` for rows where `type === 'session'`; render platform rows with their own template |
| Prisma + Supabase migration | Running `prisma db push` instead of `prisma migrate deploy` on production | `db push` is for development only; it does not create a migration history file, making rollback impossible |
| Prisma upsert with composite unique key | Using `create` without the unique constraint in place — concurrent requests create duplicates before the constraint exists | Add the `@@unique` constraint in the same migration that creates the table, before any application code runs |
| Month/year filter in API routes | Passing month as a string from `searchParams` without `Number()` conversion causes Prisma to do a string comparison on an `Int` field, returning no results | Always coerce: `month: Number(searchParams.get('month'))` and validate it is 1–12 |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Fetching all PlatformCharge rows for the dashboard without a year filter | Dashboard API response grows with each month of usage | Always scope PlatformCharge queries to the selected year | After 2–3 years of subscriptions (dozens of rows — not a real scale concern but a correctness concern) |
| Generating all 6 charges in a loop with individual `prisma.platformCharge.create` calls | 6 round trips to Supabase on subscription creation | Use `prisma.platformCharge.createMany` in a single call | Negligible at this scale but sets a bad precedent |
| Re-fetching the full session list on the dashboard after every platform action | Slow dashboard refresh | Platform charge mutations should not invalidate the session cache; separate the data fetching | Not a real issue at this scale — but keep fetch boundaries clean |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| No validation that a `PlatformCharge` belongs to the authenticated tutor before marking it paid | Any user who guesses a charge ID can mark it paid | This is a single-tutor app behind NextAuth — the session check in the API route is sufficient, but always verify the route is protected by the existing auth middleware |
| Storing subscription `amountCHF` without range validation | Tutor accidentally enters 5000 CHF instead of 50 CHF and generates a wrong invoice | Add server-side validation: `amountCHF > 0 && amountCHF < 1000` (reasonable ceiling for a tutoring platform fee) |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing all 6 future charges immediately as "unpaid" on student creation | Tutor sees 5 red "unpaid" rows for months that haven't arrived yet, causing confusion | Only surface charges for months that have passed or are current; show future months as "scheduled" with a different visual state |
| Allowing invoice generation for a month where a platform charge exists but the invoice billing method is "direct transfer" | Platform fee appears as a line item on an invoice for a student who pays it separately | In `getInvoicePayload`, only include the platform line item if `billingMethod === 'INVOICE'`; enforce this server-side, not only in the PDF renderer |
| No visual difference between a "scheduled" charge and an "overdue unpaid" charge | Tutor cannot tell which charges need follow-up | Add a computed status: `scheduled` (future month), `due` (current or past month, unpaid), `paid`; display each with distinct colour/label |

---

## "Looks Done But Isn't" Checklist

- [ ] **Platform line item in PDF:** Verify `Invoice.totalCHF` in the database matches the PDF total (including platform fee) — not just that the PDF renders correctly
- [ ] **Charge generation idempotency:** Run the subscription activation twice and verify `PlatformCharge` count does not increase on the second run
- [ ] **Month wrap:** Create a subscription starting in October and verify charges for January–March of the following year have correct `year` values
- [ ] **Dashboard year filter:** Switch dashboard year from 2025 to 2024 and verify platform revenue card changes (or shows zero if no 2024 subscriptions exist)
- [ ] **Direct-transfer students:** Verify that generating an invoice for a direct-transfer student does NOT include the platform fee as a line item
- [ ] **Deactivation cleanup:** Deactivate a 6-month subscription after month 2 and verify months 3–6 are either deleted or marked "cancelled", not left as unpaid
- [ ] **Invoice unique constraint:** Verify that regenerating an invoice for the same `(studentId, month, year)` upserts rather than throwing a unique violation, and that the new `totalCHF` is correct

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Double-counted revenue on dashboard | LOW | Identify which charge aggregation is double-counting; fix the query; no data migration needed because source data (Session, PlatformCharge) is correct |
| Duplicate monthly charges | MEDIUM | Write a one-off Prisma script to find `(subscriptionId, month, year)` groups with count > 1 and delete the duplicates; add the unique constraint in a migration |
| Month arithmetic wrap bug | MEDIUM | Write a migration to find `PlatformCharge` rows with `month > 12`, recalculate the correct month/year, and update them; add the utility function and redeploy |
| Invoice totalCHF mismatch | MEDIUM | Recalculate `totalCHF` for all affected invoices using a Prisma script; re-generate PDFs for unsent invoices; for already-sent invoices, flag them for manual review |
| Prisma migration failure on Supabase | HIGH | Restore from Supabase backup (point-in-time recovery); fix the migration file; redeploy using `DIRECT_URL`; test on a Supabase branch first |
| PDF layout crash from platform line item | LOW | Fix the `InvoicePDF` component type guard; re-generate the PDF; no data migration needed |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Double-counting platform revenue (Pitfall 1) | Schema + Data Model phase | Unit test: `platformRevenue + tutoring != invoice.totalCHF` for invoice-billed students |
| Duplicate monthly charges (Pitfall 2) | Schema + Data Model phase | `@@unique([subscriptionId, month, year])` present in migration; idempotency test |
| Month arithmetic wrap (Pitfall 3) | Charge generation phase | Test: 6-month sub from October produces months [10,11,12,1,2,3] with correct years |
| PDF layout break (Pitfall 4) | Invoice integration phase | Visual review of PDF with platform line item; no `undefined` values in rendered rows |
| Invoice totalCHF not updated (Pitfall 5) | Invoice integration phase | Assert `Invoice.totalCHF === sessionTotal + platformFee` after generate |
| Supabase migration failure (Pitfall 6) | Schema + Data Model phase | Run `prisma migrate deploy` on a test Supabase project before production |
| Charge generation on edit (Pitfall 7) | Subscription management phase | Edit a subscription amount and assert charge count is unchanged |
| Dashboard year filter missing (Pitfall 8) | Dashboard integration phase | Switch dashboard year; assert platform revenue card reflects only that year's charges |

---

## Sources

- Codebase analysis: `components/InvoicePDF.tsx`, `lib/invoice.ts`, `app/api/invoice/generate/route.ts`, `app/api/invoices/route.ts`, `app/dashboard/page.tsx`, `prisma/schema.prisma`
- Project context: `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`
- Patterns: standard Prisma idempotency practices (upsert + unique constraint), react-pdf typed prop patterns, Supabase migration documentation guidance

---
*Pitfalls research for: subscription billing line items added to Mathetogo Rechnungen*
*Researched: 2026-04-22*
