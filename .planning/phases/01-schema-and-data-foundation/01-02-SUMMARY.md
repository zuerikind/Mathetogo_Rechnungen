---
phase: 01-schema-and-data-foundation
plan: 02
subsystem: database
tags: [prisma, postgres, supabase, schema, migration]

# Dependency graph
requires:
  - phase: 01-schema-and-data-foundation/01-01
    provides: vitest test infrastructure and failing stubs for lib/platform-charges.ts
provides:
  - PlatformSubscription table in database (id, studentId, amountCHF, billingMethod, durationMonths, startMonth, startYear, active, createdAt, updatedAt)
  - PlatformCharge table in database (id, subscriptionId, month, year, amountCHF, paidAt, createdAt) with @@unique([subscriptionId, month, year])
  - subscriptions reverse relation on Student model (no new column, virtual relation only)
  - Tracked migration SQL in prisma/migrations/ (replayable via prisma migrate deploy on Supabase)
  - Regenerated Prisma client with prisma.platformSubscription and prisma.platformCharge accessors
affects:
  - 01-schema-and-data-foundation/01-03 (seed/verify data scripts reference these tables)
  - Phase 2 (subscription CRUD UI writes to PlatformSubscription)
  - Phase 3 (invoice generation reads PlatformCharge via ensureChargeForMonth)
  - Phase 4 (paidAt field on PlatformCharge updated by payment tracking)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Prisma migration tracked via migrate dev (not db push) for Supabase deploy compatibility"
    - "billingMethod as String (not enum) following existing schema convention (currency is also String)"
    - "PlatformCharge has no updatedAt — charges are immutable once created, only paidAt changes"
    - "@@unique([subscriptionId, month, year]) named subscriptionId_month_year by Prisma auto-naming"

key-files:
  created:
    - prisma/migrations/20260422000000_add_platform_subscription_and_charge/migration.sql
  modified:
    - prisma/schema.prisma

key-decisions:
  - "billingMethod is String (not enum) to match existing schema convention where currency is also String"
  - "PlatformCharge has no updatedAt — charges are immutable, only paidAt changes (Phase 4 adds that update path)"
  - "Compound unique @@unique([subscriptionId, month, year]) — auto-named subscriptionId_month_year by Prisma, referenced in lib/platform-charges.ts"
  - "Migration tracked via prisma migrate dev (not db push) so it can be replayed on Supabase with prisma migrate deploy"

patterns-established:
  - "New models appended after TutorProfile block — existing models never modified except to add virtual relation fields"
  - "DIRECT_URL env var required for prisma migrate dev/deploy on Supabase (pooled connection insufficient)"

requirements-completed:
  - SUB-04

# Metrics
duration: ~30min (including human checkpoint for migration verification)
completed: 2026-04-22
---

# Phase 01 Plan 02: Schema Extension for Platform Revenue Tracking Summary

**PlatformSubscription and PlatformCharge Prisma models added, migration applied to Supabase, and Prisma client regenerated with new typed accessors**

## Performance

- **Duration:** ~30 min (including human checkpoint for migration verification)
- **Started:** 2026-04-22T~19:30Z
- **Completed:** 2026-04-22T20:03Z
- **Tasks:** 3 (2 auto + 1 checkpoint:human-verify)
- **Files modified:** 2 (prisma/schema.prisma + migration SQL)

## Accomplishments
- PlatformSubscription and PlatformCharge tables created in the Supabase database with all required columns and constraints
- Migration tracked in prisma/migrations/ with timestamp-based directory, replayable via `prisma migrate deploy` on any environment
- Prisma client regenerated — `prisma.platformSubscription` and `prisma.platformCharge` TypeScript types confirmed present in node_modules/.prisma/client/index.d.ts
- Student model gained `subscriptions PlatformSubscription[]` virtual relation field (no new DB column on Student table)
- Existing Student, Session, and Invoice data confirmed intact after migration (human-verified)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add PlatformSubscription and PlatformCharge models to schema.prisma** - `7ce0b3b` (feat)
2. **Task 1b: Generate migration SQL files** - `592141b` (chore)
3. **Task 2: Verify migration applied and Prisma client regenerated** - human checkpoint (approved by user — migration applied, both migrations show as Applied)

**Plan metadata:** (created in this run — see final commit)

## Files Created/Modified
- `prisma/schema.prisma` - PlatformSubscription and PlatformCharge models added; subscriptions relation added to Student
- `prisma/migrations/20260422000000_add_platform_subscription_and_charge/migration.sql` - CREATE TABLE SQL for both new models with foreign keys and unique constraint

## Decisions Made
- billingMethod stored as String (not enum) — matches existing pattern where currency is String
- PlatformCharge omits updatedAt — charges are immutable once created; paidAt is the only mutable field and its update path will be added in Phase 4
- Compound unique @@unique([subscriptionId, month, year]) prevents duplicate charges for the same subscription/month/year combination
- Migration generated via `prisma migrate dev` (not `db push`) to ensure the SQL file is tracked and replayable on Supabase

## Deviations from Plan

None - plan executed exactly as written. The checkpoint:human-verify gate worked as intended: migration was applied by the user externally and confirmed via the approve signal.

## Issues Encountered

Pre-existing TypeScript errors in `app/api/invoices/download/route.ts` (Buffer type mismatch, MapIterator downlevelIteration) were found during `tsc --noEmit` verification. These are out-of-scope pre-existing issues in files not touched by this plan — logged here for awareness but not fixed. The intentionally-failing test stub in `lib/platform-charges.test.ts` (from Plan 01-01 TDD red phase) also shows as a TS error, as expected.

## User Setup Required

None - migration was applied directly by the user during the checkpoint gate. No new environment variables are required beyond the existing DIRECT_URL already configured in .env.local.

## Next Phase Readiness
- PlatformSubscription and PlatformCharge tables exist in database — ready for Phase 2 (subscription CRUD API and UI)
- Prisma client types are available — lib/platform-charges.ts implementation (Phase 01-03 or Phase 2) can import PlatformSubscription and PlatformCharge types without error
- Migration is tracked and replayable on any environment via `prisma migrate deploy`
- No blockers for Plan 01-03

---
*Phase: 01-schema-and-data-foundation*
*Completed: 2026-04-22*
