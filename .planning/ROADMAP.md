# Roadmap: Mathetogo Rechnungen

## Milestones

- ✅ **v1.0 Core Invoicing** - Pre-GSD (shipped 2026-04-22)
- 🚧 **v1.1 Platform Revenue Tracking** - Phases 1-4 (in progress)

## Phases

<details>
<summary>✅ v1.0 Core Invoicing — SHIPPED 2026-04-22 (pre-GSD, no GSD phases)</summary>

What shipped: student management, session tracking (calendar sync), monthly invoice generation + PDF, invoice history and status, dashboard with revenue stats, tutor profile settings, WhatsApp integration.

</details>

### 🚧 v1.1 Platform Revenue Tracking (In Progress)

**Milestone Goal:** The tutor can add Mathetogo platform subscriptions per student, have the platform fee appear correctly on monthly invoices, mark direct-transfer payments as received, and see platform revenue broken out on the dashboard — without any manual calculation.

- [ ] **Phase 1: Schema and Data Foundation** - Prisma models, migration, month arithmetic utility, and platform charge helpers
- [ ] **Phase 2: Subscription CRUD and Student Detail** - API routes and UI for creating, editing, and deactivating subscriptions; subscription section on student detail page
- [ ] **Phase 3: Invoice Integration** - Platform line item in PDF, correct totalCHF, visual distinction
- [ ] **Phase 4: Dashboard and Payment Tracking** - Platform revenue stats, mark-as-paid flow, outstanding charges visibility

## Phase Details

### Phase 1: Schema and Data Foundation
**Goal**: The data layer for platform subscriptions and charges exists, is migration-safe, and provides the helpers that all subsequent phases depend on
**Depends on**: Nothing (first phase)
**Requirements**: SUB-04
**Success Criteria** (what must be TRUE):
  1. Running `prisma migrate deploy` on the Supabase database creates the `PlatformSubscription` and `PlatformCharge` tables without touching existing Student, Session, or Invoice data
  2. A `@@unique([subscriptionId, month, year])` constraint exists on `PlatformCharge`, making charge generation idempotent — running it twice produces the same number of rows as running it once
  3. The `addMonths` utility correctly handles year-wrap: a 6-month subscription starting in October produces charges for months 10, 11, 12 of year Y and 1, 2, 3 of year Y+1
  4. `lib/platform-charges.ts` exports `ensureChargeForMonth` which can be called from `getInvoicePayload` without breaking existing invoice generation for students without subscriptions
**Plans**: 3 plans

Plans:
- [ ] 01-01-PLAN.md — Install vitest, create failing test stubs for lib/platform-charges.ts (Wave 0)
- [ ] 01-02-PLAN.md — Extend schema.prisma, generate and apply Prisma migration (Wave 1)
- [ ] 01-03-PLAN.md — Implement lib/platform-charges.ts, make all tests green (Wave 2)

### Phase 2: Subscription CRUD and Student Detail
**Goal**: The tutor can add, edit, and deactivate a platform subscription for any student, and see the current subscription status and per-month charge history on the student detail page
**Depends on**: Phase 1
**Requirements**: SUB-01, SUB-02, SUB-03, SUB-05
**Success Criteria** (what must be TRUE):
  1. Tutor can open a student detail page, add a new subscription with amount (CHF), duration (1 or 6 months), and billing method (invoice or direct), and the subscription appears immediately in the student's subscription section
  2. Tutor can edit an existing subscription's amount or billing method; editing does not create additional charge rows — the charge count for that subscription stays equal to its duration
  3. Tutor can deactivate a subscription before it ends; after deactivation, no new charges are created for future months and the subscription shows as inactive
  4. The student detail page subscription section shows: active/inactive status, monthly amount, months remaining, and a per-month list of charges with their payment status (paid/unpaid/scheduled)
**Plans**: 3 plans

Plans:
- [ ] 02-01-PLAN.md — TDD: subscription-utils helpers (chargeStatus, monthsRemaining, buildChargeRows) with unit tests (Wave 0)
- [ ] 02-02-PLAN.md — API routes GET+POST /api/subscriptions and PATCH /api/subscriptions/[id] + TypeScript types (Wave 1)
- [ ] 02-03-PLAN.md — SubscriptionSection component + student detail page wiring + browser verification (Wave 2)

### Phase 3: Invoice Integration
**Goal**: When a student's billing method is "invoice", the platform fee appears as a clearly labelled, visually distinct line item on their monthly PDF invoice, and the invoice total correctly includes the fee
**Depends on**: Phase 2
**Requirements**: INV-01, INV-02, INV-03
**Success Criteria** (what must be TRUE):
  1. Generating a monthly invoice for a student with an active invoice-billed subscription produces a PDF that contains a line item labelled "Mathetogo Platform – [Month Year]" below the session rows
  2. The invoice PDF total (and the stored `Invoice.totalCHF` in the database) equals the sum of session amounts plus the platform fee — not sessions only
  3. The platform line item is visually distinct from session rows (different background colour or divider) so the student can immediately tell it apart
  4. Generating an invoice for a student with no subscription, or a direct-transfer subscription, produces a PDF identical to today's output — no platform line item, no change to totalCHF
**Plans**: TBD

### Phase 4: Dashboard and Payment Tracking
**Goal**: The tutor can mark direct-transfer platform payments as received, see which charges are still outstanding, and the dashboard correctly reports platform revenue — broken out separately and included in the total — filtered by the selected year
**Depends on**: Phase 3
**Requirements**: PAY-01, PAY-02, PAY-03, DASH-01, DASH-02, DASH-03
**Success Criteria** (what must be TRUE):
  1. Tutor can click "Mark as paid" on a direct-transfer platform charge; the charge immediately shows a paid date and a visual indicator (e.g., green badge) distinguishing it from unpaid charges
  2. The student detail page (or a dashboard section) shows all unpaid direct-transfer charges across months so the tutor knows what is still outstanding without opening each student individually
  3. The dashboard total revenue stat for any selected year includes both tutoring session income and platform subscription income, with no double-counting
  4. The dashboard shows platform revenue as a separate figure (its own stat card or sub-line), so the tutor can track platform income independently of tutoring income
  5. Switching the dashboard year filter changes the platform revenue figure to match only that year's charges — a 2025 subscription does not appear in the 2026 platform revenue stat
**Plans**: TBD

## Progress

**Execution Order:** 1 → 2 → 3 → 4

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Schema and Data Foundation | 2/3 | In Progress|  | - |
| 2. Subscription CRUD and Student Detail | v1.1 | 0/TBD | Not started | - |
| 3. Invoice Integration | v1.1 | 0/TBD | Not started | - |
| 4. Dashboard and Payment Tracking | v1.1 | 0/TBD | Not started | - |
