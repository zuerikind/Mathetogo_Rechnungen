# State: Mathetogo Rechnungen

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-22)

**Core value:** The tutor can track all income (tutoring sessions + platform subscriptions) and generate correct monthly invoices without manual calculation.
**Current focus:** Milestone v1.1 — Platform Revenue Tracking

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-04-22 — Milestone v1.1 started

## Accumulated Context

- Existing codebase: Next.js App Router, Prisma, Supabase, react-pdf
- Invoice model has unique constraint on [studentId, month, year]
- Sessions are synced from calendar; no manual session entry
- Dashboard already has revenue stats cards and monthly charts
- WhatsApp integration exists for sending invoices
