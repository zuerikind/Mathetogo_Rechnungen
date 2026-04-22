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

Progress: [░░░░░░░░░░] 0%

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

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- v1.1 planning: Platform fee as separate invoice line item (injected via InvoicePayload, not a separate Invoice record)
- v1.1 planning: Charge generation is just-in-time via `ensureChargeForMonth` — not eager on subscription creation, to avoid stale future charges after edits or deactivation
- v1.1 planning: Dashboard revenue uses Session + PlatformCharge as source tables directly (not Invoice.totalCHF) to avoid double-counting

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 1: Supabase migration must use DIRECT_URL (not pooled connection) — verify env vars before running prisma migrate deploy
- Phase 3: getInvoicePayload feeds both preview and generate routes — totalCHF change affects both; test both after Phase 3

## Session Continuity

Last session: 2026-04-22
Stopped at: Roadmap written, STATE.md initialised — ready to plan Phase 1
Resume file: None
