---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Platform Revenue Tracking
status: planning
stopped_at: Completed 01-schema-and-data-foundation/01-01-PLAN.md
last_updated: "2026-04-22T02:12:44.460Z"
last_activity: 2026-04-22 — Roadmap created for v1.1 milestone
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 3
  completed_plans: 1
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

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- v1.1 planning: Platform fee as separate invoice line item (injected via InvoicePayload, not a separate Invoice record)
- v1.1 planning: Charge generation is just-in-time via `ensureChargeForMonth` — not eager on subscription creation, to avoid stale future charges after edits or deactivation
- v1.1 planning: Dashboard revenue uses Session + PlatformCharge as source tables directly (not Invoice.totalCHF) to avoid double-counting
- [Phase 01-schema-and-data-foundation]: vitest chosen over jest: lighter, faster, native ESM for Next.js TypeScript project
- [Phase 01-schema-and-data-foundation]: Test stubs are intentionally red: import failure proves implementation not yet present

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 1: Supabase migration must use DIRECT_URL (not pooled connection) — verify env vars before running prisma migrate deploy
- Phase 3: getInvoicePayload feeds both preview and generate routes — totalCHF change affects both; test both after Phase 3

## Session Continuity

Last session: 2026-04-22T02:12:44.459Z
Stopped at: Completed 01-schema-and-data-foundation/01-01-PLAN.md
Resume file: None
