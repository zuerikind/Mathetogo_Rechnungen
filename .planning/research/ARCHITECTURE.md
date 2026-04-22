# Architecture Research

**Domain:** Subscription billing integration into existing tutoring invoicing app
**Researched:** 2026-04-22
**Confidence:** HIGH — based on direct codebase inspection

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        UI Layer (Client)                          │
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ DashboardPage   │  │StudentDetail │  │InvoicePreviewClient  │ │
│  │ (sessions only) │  │ (sessions    │  │ (PDF preview +       │ │
│  │                 │  │  + new:      │  │  generate + send)    │ │
│  │                 │  │  sub status) │  │                      │ │
│  └────────┬────────┘  └──────┬───────┘  └──────────┬───────────┘ │
├───────────┴──────────────────┴─────────────────────┴─────────────┤
│                      API Route Layer                               │
│  /api/sessions  /api/invoices  /api/invoice/generate              │
│  /api/invoice/preview   [NEW] /api/subscriptions                  │
│  [NEW] /api/platform-charges                                      │
├───────────────────────────────────────────────────────────────────┤
│                      Service / Lib Layer                           │
│  ┌─────────────────────┐  ┌──────────────────────────────────┐   │
│  │  lib/invoice.ts     │  │  [NEW] lib/platform-charges.ts   │   │
│  │  getInvoicePayload  │  │  getChargeForMonth               │   │
│  │  InvoicePayload type│  │  generateMonthlyCharges          │   │
│  └──────────┬──────────┘  └──────────────┬───────────────────┘   │
│             │                            │                        │
│  ┌──────────┴──────────────────────────────────────────┐         │
│  │              lib/invoice-pdf.tsx                     │         │
│  │              buildInvoicePdf(payload)                │         │
│  └──────────┬──────────────────────────────────────────┘         │
│             │                                                     │
│  ┌──────────┴──────────┐                                          │
│  │  InvoicePDF.tsx     │  (react-pdf component)                   │
│  │  renders sessions   │                                          │
│  │  + [NEW] platform   │                                          │
│  │    line item        │                                          │
│  └─────────────────────┘                                          │
├───────────────────────────────────────────────────────────────────┤
│                      Data Layer (Prisma + Supabase)                │
│  Student  Session  Invoice  TutorProfile                           │
│  [NEW] PlatformSubscription   [NEW] PlatformCharge                │
└───────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Status |
|-----------|---------------|--------|
| `lib/invoice.ts` → `getInvoicePayload` | Assembles all data needed to render an invoice; computes `totalCHF` | MODIFY: add platform charge lookup and inclusion |
| `InvoicePayload` type | Contract between data layer and PDF renderer | MODIFY: add optional `platformCharge` field |
| `InvoicePDF.tsx` | Renders the PDF via react-pdf | MODIFY: render platform line item when `platformCharge` is present |
| `app/api/invoice/generate/route.ts` | Persists invoice record, uploads PDF to Supabase | MODIFY: `totalCHF` already comes from payload — no direct change needed if payload is correct |
| `app/api/invoice/preview/route.ts` | Streams PDF inline for preview | NO CHANGE — calls `getInvoicePayload` which will include charge automatically |
| `lib/platform-charges.ts` (NEW) | Generates charges from active subscriptions, queries charge for a given student/month/year | NEW |
| `app/api/subscriptions/route.ts` (NEW) | CRUD for `PlatformSubscription` | NEW |
| `app/api/platform-charges/route.ts` (NEW) | Mark charge as paid; list charges for student | NEW |
| `app/students/[id]/page.tsx` | Student detail view | MODIFY: add subscription status section |
| `app/dashboard/page.tsx` | Revenue KPI cards and charts | MODIFY: fetch and include platform revenue |

---

## Recommended Project Structure

```
lib/
├── invoice.ts              # MODIFY — add platform charge to payload
├── invoice-pdf.tsx         # no change
├── platform-charges.ts     # NEW — charge generation + query helpers

app/api/
├── invoice/
│   ├── generate/route.ts   # no change needed (payload drives totalCHF)
│   └── preview/route.ts    # no change needed
├── subscriptions/
│   └── route.ts            # NEW — GET list, POST create
├── subscriptions/[id]/
│   └── route.ts            # NEW — PATCH edit, DELETE deactivate
└── platform-charges/
    └── route.ts            # NEW — GET by studentId, PATCH mark paid

components/
└── InvoicePDF.tsx          # MODIFY — platform line item

app/students/[id]/
└── page.tsx                # MODIFY — subscription status section

app/dashboard/
└── page.tsx                # MODIFY — platform revenue stats
```

---

## Architectural Patterns

### Pattern 1: Extend InvoicePayload — Do Not Split

**What:** Add an optional `platformCharge` field to the existing `InvoicePayload` type. The single `getInvoicePayload` function remains the sole entry point for all invoice data.

**When to use:** Anytime the PDF needs to reflect a new billing line. Centralising in `InvoicePayload` means both the preview endpoint and the generate endpoint automatically pick up the change.

**Trade-offs:** Keeps the surface area of change small. The only risk is forgetting to guard against `null` in the PDF renderer — handled by making the field optional.

```typescript
// lib/invoice.ts — extended type
export type PlatformChargeLine = {
  amountCHF: number;
  label: string; // e.g. "Mathetogo Platform – April 2026"
};

export type InvoicePayload = {
  student: ...;
  tutor: ...;
  sessions: InvoiceSession[];
  year: number;
  month: number;
  periodLabel: string;
  totalCHF: number;       // sessions + platformCharge.amountCHF if present
  totalMinutes: number;
  invoiceNumber: string;
  platformCharge?: PlatformChargeLine;  // NEW — only present when billingMethod=INVOICE
};
```

### Pattern 2: Charge Generation as an Explicit Step (Not Lazy/Automatic)

**What:** `PlatformCharge` rows are created by an explicit action (a "generate charges" button or an on-demand call when the invoice page loads), not by a background cron or database trigger.

**When to use:** This app has no background job infrastructure and is single-tutor. Generating charges on demand (e.g., when the tutor opens the invoice preview or presses a button) is simpler and more transparent.

**Trade-offs:** The tutor must take an action before charges appear. This is acceptable — the tutor already explicitly generates invoices. The alternative (auto-generating charges at subscription start) risks generating charges for months that don't have sessions yet.

**Recommended implementation:** In `getInvoicePayload`, after fetching sessions, call `ensureChargeForMonth(studentId, month, year)`. This function:
1. Checks for an active `PlatformSubscription` where the month falls within the subscription window.
2. If found and no `PlatformCharge` row exists for that month, creates one (idempotent upsert).
3. Returns the `PlatformCharge` for `billingMethod = INVOICE`, or `null` for `DIRECT`.

This means charges are generated just-in-time when the invoice is first previewed or generated, with no risk of duplication.

```typescript
// lib/platform-charges.ts
export async function ensureChargeForMonth(
  studentId: string,
  month: number,
  year: number
): Promise<PlatformCharge | null> {
  const sub = await prisma.platformSubscription.findFirst({
    where: {
      studentId,
      active: true,
      // month/year falls within subscription window
    },
  });
  if (!sub) return null;

  // Idempotent upsert
  return prisma.platformCharge.upsert({
    where: { subscriptionId_month_year: { subscriptionId: sub.id, month, year } },
    create: { subscriptionId: sub.id, studentId, month, year, amountCHF: sub.amountCHF, billingMethod: sub.billingMethod },
    update: {},  // never overwrite — charge amount is fixed at creation
  });
}
```

### Pattern 3: Revenue Source Tagging (No Double-Count)

**What:** The dashboard revenue query must produce one canonical number per billing method. The rule:

- `billingMethod = INVOICE`: The charge amount is already embedded in `Invoice.totalCHF`. Query `Invoice.totalCHF` sums already include it.
- `billingMethod = DIRECT`: The charge is NOT in any invoice. Query `PlatformCharge WHERE billingMethod = DIRECT AND paidAt IS NOT NULL` for realised direct revenue.

**When to use:** Always. This is the double-count prevention strategy.

**Trade-offs:** Requires the dashboard to run two queries and add them, rather than a single sessions sum. This is a one-time refactor of `calcStats` on the dashboard page — the incremental complexity is low.

```
Total Revenue (month M) =
  SUM(Invoice.totalCHF WHERE month=M, year=Y)   ← includes INVOICE-billed platform fees
  + SUM(PlatformCharge.amountCHF WHERE billingMethod=DIRECT AND paidAt IS NOT NULL AND month=M AND year=Y)
  - SUM(Session.amountCHF WHERE month=M AND year=Y)   ← current dashboard uses sessions, not invoices
```

**Important:** The current dashboard sums `Session.amountCHF` directly (not `Invoice.totalCHF`). The simplest double-count-safe approach is:

```
Tutoring Revenue (month M) = SUM(Session.amountCHF WHERE month=M, year=Y)
Platform Revenue (month M) =
  SUM(PlatformCharge.amountCHF WHERE billingMethod=INVOICE AND month=M AND year=Y)
  + SUM(PlatformCharge.amountCHF WHERE billingMethod=DIRECT AND paidAt IS NOT NULL AND month=M AND year=Y)
Total Revenue = Tutoring Revenue + Platform Revenue
```

This avoids touching `Invoice.totalCHF` on the dashboard and keeps platform revenue as a separately queryable figure. The `Invoice.totalCHF` stays correct for PDF generation (sessions + platform), but the dashboard derives from the source-of-truth tables directly.

---

## Data Flow

### Flow A: Monthly Charge Generation

```
Tutor opens /invoice/[studentId]/[year]/[month]
    ↓
InvoicePreviewClient mounts → fetch /api/invoice/preview
    ↓
preview route calls getInvoicePayload(studentId, year, month)
    ↓
getInvoicePayload calls ensureChargeForMonth(studentId, month, year)
    ↓
ensureChargeForMonth queries PlatformSubscription (active, in-window)
    ↓
If subscription found → upsert PlatformCharge (idempotent)
    ↓
Returns PlatformCharge row (billingMethod=INVOICE) or null (DIRECT / none)
    ↓
getInvoicePayload assembles InvoicePayload:
  totalCHF = sessions.sum + (platformCharge?.amountCHF ?? 0)
  platformCharge = { amountCHF, label } | undefined
    ↓
buildInvoicePdf(payload) → InvoicePDF renders platform line item if present
    ↓
PDF streamed to client (preview) or uploaded to Supabase (generate)
    ↓
Invoice.upsert with correct totalCHF (includes platform fee)
```

### Flow B: Including Platform Charge in PDF

```
InvoicePayload.platformCharge present?
    YES → InvoicePDF renders:
            [Session rows — existing layout]
            [Platform row — visually distinct, e.g. different background]
            Subtotal (sessions only) OR remove subtotal
            Platform fee: CHF X.XX
            TOTAL: CHF Y.YY (sessions + platform)
    NO  → InvoicePDF renders current layout unchanged
```

The PDF component change is self-contained. The `styles` object already has `altRow` for visual distinction — a `platformRow` style (e.g., a light green or lilac background matching the existing palette) isolates the platform line visually.

### Flow C: Dashboard Revenue — No Double-Count

```
DashboardPage mounts → fetch /api/sessions?year=Y  (existing)
                     → fetch /api/platform-charges?year=Y  (NEW)
    ↓
calcStats(sessions) → tutoring income (unchanged)
calcPlatformStats(charges) →
    invoiceBilled = charges.filter(c => c.billingMethod=INVOICE).sum(amountCHF)
    directPaid    = charges.filter(c => c.billingMethod=DIRECT && c.paidAt).sum(amountCHF)
    platformTotal = invoiceBilled + directPaid
    ↓
StatCards:
  "Einkommen (Monat)"   = tutoring + platformTotal  (new combined total)
  "Plattform (Monat)"   = platformTotal              (new breakdown card)
  "Jahreseinkommen"     = ytd tutoring + ytd platform
```

The `/api/platform-charges` endpoint accepts `?year=Y` (and optionally `?month=M` and `?studentId=X`). The dashboard fetches year-level data and filters client-side — consistent with how sessions are handled today.

### Flow D: Direct Payment Marking

```
Tutor views student detail → subscription section shows unpaid DIRECT charges
Tutor clicks "Mark as paid" → PATCH /api/platform-charges/[id] { paidAt: now() }
    ↓
PlatformCharge.paidAt set
    ↓
Dashboard next load includes this charge in directPaid sum
```

---

## Integration Points

### Existing Code — Precise Modification Points

| File | Change | Risk |
|------|--------|------|
| `prisma/schema.prisma` | Add `PlatformSubscription` and `PlatformCharge` models + relation to `Student` | Low — additive migration, no existing columns changed |
| `lib/invoice.ts` — `InvoicePayload` type | Add `platformCharge?: PlatformChargeLine` field | Low — optional field, no existing callers break |
| `lib/invoice.ts` — `getInvoicePayload()` | Call `ensureChargeForMonth`, add result to payload, update `totalCHF` | Medium — this function feeds both preview and generate; totalCHF change must be correct |
| `components/InvoicePDF.tsx` | Add conditional platform line item row and update totals section | Low — additive UI change, guarded by `payload.platformCharge !== undefined` |
| `app/api/invoice/generate/route.ts` | No direct change — `totalCHF` comes from payload which is already correct | None |
| `app/api/invoice/preview/route.ts` | No direct change | None |
| `app/dashboard/page.tsx` | Add platform charges fetch; extend `calcStats` or add `calcPlatformStats`; add StatCard | Medium — UI refactor but logic is additive |
| `app/students/[id]/page.tsx` | Add subscription status section; fetch subscription + charges for student | Low — additive section |

### New Code

| File | Purpose |
|------|---------|
| `lib/platform-charges.ts` | `ensureChargeForMonth`, `getChargesForYear`, helpers |
| `prisma/migrations/…` | Migration for two new models |
| `app/api/subscriptions/route.ts` | List and create subscriptions |
| `app/api/subscriptions/[id]/route.ts` | Edit and deactivate |
| `app/api/platform-charges/route.ts` | List charges (by studentId, year, month); mark paid |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `getInvoicePayload` → `ensureChargeForMonth` | Direct function call (same server context) | Keep in separate lib file for testability |
| Dashboard → platform charges | New API fetch — parallel to existing sessions fetch | Matches existing pattern; no architectural change needed |
| Student detail → subscriptions | New API fetch on page mount | Same pattern as existing student/sessions fetch |
| Invoice generate route → payload | No change — payload is already the contract | Correctness guaranteed if `getInvoicePayload` is correct |

---

## Subscription Window Logic (Schema Design Decision)

`PlatformSubscription` needs `startMonth` and `startYear`. For a 6-month subscription starting in January 2026, the window is months 1–6 of 2026. The `ensureChargeForMonth` function must compute whether a given (month, year) falls within `[startMonth/startYear, startMonth+durationMonths-1]` accounting for year wrap.

Recommended: store `startMonth`, `startYear`, `durationMonths` (1 or 6). Compute end window in application code — do not store `endMonth`/`endYear` as derived data can become inconsistent.

```typescript
function isMonthInWindow(
  sub: { startMonth: number; startYear: number; durationMonths: number },
  month: number, year: number
): boolean {
  const subStart = sub.startYear * 12 + sub.startMonth;
  const subEnd   = subStart + sub.durationMonths - 1;
  const target   = year * 12 + month;
  return target >= subStart && target <= subEnd;
}
```

---

## Prisma Schema — Recommended New Models

```prisma
enum BillingMethod {
  INVOICE
  DIRECT
}

model PlatformSubscription {
  id             String         @id @default(cuid())
  studentId      String
  student        Student        @relation(fields: [studentId], references: [id])
  amountCHF      Float
  durationMonths Int            // 1 or 6
  billingMethod  BillingMethod
  startMonth     Int
  startYear      Int
  active         Boolean        @default(true)
  charges        PlatformCharge[]
  createdAt      DateTime       @default(now())
}

model PlatformCharge {
  id             String               @id @default(cuid())
  subscriptionId String
  subscription   PlatformSubscription @relation(fields: [subscriptionId], references: [id])
  studentId      String
  student        Student              @relation(fields: [studentId], references: [id])
  month          Int
  year           Int
  amountCHF      Float
  billingMethod  BillingMethod
  paidAt         DateTime?            // null = unpaid; set = paid
  createdAt      DateTime             @default(now())

  @@unique([subscriptionId, month, year])
}
```

The `@@unique([subscriptionId, month, year])` constraint is what makes `ensureChargeForMonth` safely idempotent — upsert on this key will never create duplicates.

The `studentId` is denormalised onto `PlatformCharge` to allow direct queries by student without joining through the subscription (e.g., dashboard queries and student detail page).

---

## Build Order (Phase Dependencies)

The dependency chain determines the correct implementation order:

1. **Schema migration** — Both new models. Nothing else can be built without this.
2. **`lib/platform-charges.ts`** — Core helpers (`ensureChargeForMonth`, `getChargesForYear`). Needed by invoice and dashboard.
3. **Subscription API routes** — `/api/subscriptions` CRUD. Needed before the UI can create subscriptions.
4. **`getInvoicePayload` extension + `InvoicePayload` type** — Extend to include `platformCharge`. This feeds both the PDF renderer and the generate route.
5. **`InvoicePDF.tsx` platform line item** — Depends on `InvoicePayload.platformCharge` being defined. PDF preview and generate will automatically reflect this.
6. **`/api/platform-charges` route** — Mark-as-paid and listing endpoint. Needed by dashboard and student detail.
7. **Dashboard update** — Add platform revenue fetch and stats. Depends on the charges API.
8. **Student detail subscription section** — Add subscription status and charge history. Depends on subscription + charges APIs.

Steps 3 and 4 can be parallelised. Steps 5 and 6 can be parallelised. Steps 7 and 8 can be parallelised.

---

## Anti-Patterns

### Anti-Pattern 1: Storing totalCHF as Sessions-Only, Adding Platform Fee Separately

**What people do:** Keep `Invoice.totalCHF` as just the session sum and add platform fee as a separate field on Invoice.

**Why it's wrong:** The PDF total would need to combine two fields everywhere. Any code that reads `invoice.totalCHF` for reporting would undercount. The existing unique constraint and upsert logic uses `totalCHF` — having two fields creates inconsistency.

**Do this instead:** `Invoice.totalCHF` always equals the full amount the student owes for that month (sessions + any invoice-billed platform fee). The platform fee amount is derivable from `PlatformCharge` — no need to store it separately on Invoice.

### Anti-Pattern 2: Generating All Charges at Subscription Creation

**What people do:** Create all 6 `PlatformCharge` rows immediately when a 6-month subscription is saved.

**Why it's wrong:** If the tutor deactivates or edits the subscription mid-way, you have stale future charges to clean up. It also creates charges for months that haven't happened yet, which pollutes the "unpaid charges" view.

**Do this instead:** Generate charges just-in-time via `ensureChargeForMonth` when the invoice for that month is first previewed or generated. For DIRECT billing, expose a manual "generate charge" button on the student detail page so the tutor can create the charge when they are ready to track payment.

### Anti-Pattern 3: Counting Platform Revenue from Invoice.totalCHF on the Dashboard

**What people do:** Sum `Invoice.totalCHF` for the dashboard income stat to include platform fees.

**Why it's wrong:** The current dashboard sums `Session.amountCHF` — not invoices. Switching to `Invoice.totalCHF` would require all sessions to be invoiced before they appear in revenue stats, which is not how the app works. It also excludes DIRECT-billed charges.

**Do this instead:** Keep `Session.amountCHF` as the tutoring revenue source. Add `PlatformCharge` as a separate revenue source (INVOICE-billed always counted, DIRECT-billed counted when `paidAt` is set). Sum them. This preserves existing dashboard behaviour and adds platform revenue cleanly.

---

## Scaling Considerations

This is a single-tutor private app. Scaling is not a concern. The schema and patterns above are designed for correctness and maintainability, not throughput.

---

## Sources

- Direct codebase inspection: `lib/invoice.ts`, `components/InvoicePDF.tsx`, `app/api/invoice/generate/route.ts`, `app/api/invoice/preview/route.ts`, `app/dashboard/page.tsx`, `app/students/[id]/page.tsx`, `prisma/schema.prisma`
- Prisma documentation for `@@unique` composite constraints and `upsert` semantics (HIGH confidence — standard Prisma patterns)
- react-pdf: conditional rendering of View components based on prop presence (HIGH confidence — standard React pattern)

---
*Architecture research for: Mathetogo Rechnungen v1.1 — Platform Subscription Integration*
*Researched: 2026-04-22*
