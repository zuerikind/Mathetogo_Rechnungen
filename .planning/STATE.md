---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Platform Revenue Tracking
status: planning
stopped_at: Completed 02-subscription-crud-and-student-detail/02-02-PLAN.md
last_updated: "2026-04-22T20:50:00.472Z"
last_activity: 2026-04-22 — Roadmap created for v1.1 milestone
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 6
  completed_plans: 4
  percent: 33
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-22)

**Core value:** The tutor can track all income (tutoring sessions + platform subscriptions) and generate correct monthly invoices without manual calculation.
**Current focus:** Phase 1 — Schema and Data Foundation

## Current Position

Phase: 1 of 4 (Schema and Data Foundation)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-04-22 — Roadmap created for v1.1 milestone

Progress: [███░░░░░░░] 33%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| — | — | — | — |

**Recent Trend:**
- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01-schema-and-data-foundation P01 | 2 | 2 tasks | 4 files |
| Phase 01-schema-and-data-foundation P02 | 30 | 3 tasks | 2 files |
| Phase 01-schema-and-data-foundation P03 | 3 | 1 tasks | 1 files |
| Phase 02-subscription-crud-and-student-detail P02 | 2 | 2 tasks | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- v1.1 planning: Platform fee as separate invoice line item (injected via InvoicePayload, not a separate Invoice record)
- v1.1 planning: Charge generation is just-in-time via `ensureChargeForMonth` — not eager on subscription creation, to avoid stale future charges after edits or deactivation
- v1.1 planning: Dashboard revenue uses Session + PlatformCharge as source tables directly (not Invoice.totalCHF) to avoid double-counting
- [Phase 01-schema-and-data-foundation]: vitest chosen over jest: lighter, faster, native ESM for Next.js TypeScript project
- [Phase 01-schema-and-data-foundation]: Test stubs are intentionally red: import failure proves implementation not yet present
- [Phase 01-schema-and-data-foundation]: billingMethod stored as String not enum to match existing schema convention where currency is also String
- [Phase 01-schema-and-data-foundation]: PlatformCharge omits updatedAt — charges are immutable once created; paidAt update path added in Phase 4
- [Phase 01-schema-and-data-foundation]: Migration tracked via prisma migrate dev (not db push) so SQL file is replayable on Supabase via prisma migrate deploy
- [Phase 01-schema-and-data-foundation]: lib/invoice.ts left untouched — ensureChargeForMonth will be wired into getInvoicePayload in Phase 3
- [Phase 01-schema-and-data-foundation]: ensureChargeForMonth uses update:{} no-op so repeat calls are idempotent
- [Phase 02-subscription-crud-and-student-detail]: POST /api/subscriptions does NOT create PlatformCharge rows — charge generation deferred to Phase 3 just-in-time via ensureChargeForMonth
- [Phase 02-subscription-crud-and-student-detail]: PATCH /api/subscriptions/[id] never touches PlatformCharge table — charge rows are immutable from subscription edits

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 1: Supabase migration must use DIRECT_URL (not pooled connection) — verify env vars before running prisma migrate deploy
- Phase 3: getInvoicePayload feeds both preview and generate routes — totalCHF change affects both; test both after Phase 3

## Session Continuity

Last session: 2026-04-22T20:50:00.463Z
Stopped at: Completed 02-subscription-crud-and-student-detail/02-02-PLAN.md
Resume file: None
