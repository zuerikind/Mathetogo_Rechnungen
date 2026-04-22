---
phase: 02-subscription-crud-and-student-detail
plan: "02"
subsystem: api
tags: [prisma, nextjs, rest-api, typescript]

# Dependency graph
requires:
  - phase: 01-schema-and-data-foundation
    provides: PlatformSubscription and PlatformCharge Prisma models

provides:
  - GET /api/subscriptions?studentId=X — returns subscriptions with charges for a student
  - POST /api/subscriptions — creates subscription with one-active guard (409) and durationMonths validation
  - PATCH /api/subscriptions/[id] — updates amountCHF, billingMethod, active without touching PlatformCharge rows
  - PlatformCharge TypeScript type in lib/ui-types.ts
  - PlatformSubscriptionWithCharges TypeScript type in lib/ui-types.ts

affects:
  - 02-03-subscription-section-component
  - 03-charge-generation-and-invoice-integration

# Tech tracking
tech-stack:
  added: []
  patterns:
    - auth() guard at top of every handler returning 401 if no session
    - Spread conditional update pattern for optional PATCH fields
    - "No charge mutation in subscription routes — PlatformCharge only created just-in-time in Phase 3"

key-files:
  created:
    - app/api/subscriptions/route.ts
    - app/api/subscriptions/[id]/route.ts
  modified:
    - lib/ui-types.ts

key-decisions:
  - "POST /api/subscriptions does NOT create PlatformCharge rows — charge generation is deferred to Phase 3 just-in-time via ensureChargeForMonth"
  - "409 conflict returned when student already has an active subscription (not overwrite)"
  - "PATCH never touches PlatformCharge table — ensures charge rows are immutable from subscription edits"

patterns-established:
  - "Auth guard: const session = await auth(); if (!session) return 401"
  - "Optional update spread: ...(field !== undefined && { field: value })"
  - "Subscription validation: durationMonths in [1, 6], billingMethod in ['invoice', 'direct']"

requirements-completed: [SUB-01, SUB-02, SUB-03]

# Metrics
duration: 2min
completed: 2026-04-22
---

# Phase 02 Plan 02: Subscription API Routes Summary

**REST API for platform subscription CRUD with one-active-per-student guard and no PlatformCharge mutation in edit path**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-22T20:47:22Z
- **Completed:** 2026-04-22T20:49:15Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added PlatformCharge and PlatformSubscriptionWithCharges TypeScript types to lib/ui-types.ts
- Created GET + POST /api/subscriptions with auth guard, 409 conflict guard, and durationMonths/billingMethod validation
- Created PATCH /api/subscriptions/[id] with auth guard, optional-field update pattern, and zero PlatformCharge mutations
- All 18 existing tests continue to pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Add PlatformCharge and PlatformSubscriptionWithCharges types** - `799ee5d` (feat)
2. **Task 2: Create GET+POST /api/subscriptions and PATCH /api/subscriptions/[id]** - `cba2cae` (feat)

## Files Created/Modified
- `lib/ui-types.ts` - Added PlatformCharge and PlatformSubscriptionWithCharges export types
- `app/api/subscriptions/route.ts` - GET (list by studentId with charges) + POST (create with conflict guard) handlers
- `app/api/subscriptions/[id]/route.ts` - PATCH handler for updating subscription fields without charge mutation

## Decisions Made
- POST does not create any PlatformCharge rows — charge generation remains Phase 3 concern (just-in-time via ensureChargeForMonth)
- PATCH handler explicitly never references PlatformCharge to enforce immutability contract
- billingMethod validation uses allowlist ["invoice", "direct"] in both POST and PATCH

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None — pre-existing TypeScript errors in app/api/invoices/download/route.ts were filtered per plan instructions and did not affect new files.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Subscription API is fully functional and ready for the SubscriptionSection UI component (Plan 02-03)
- Phase 3 charge generation can now call ensureChargeForMonth and wire into getInvoicePayload
- No blockers

---
*Phase: 02-subscription-crud-and-student-detail*
*Completed: 2026-04-22*
