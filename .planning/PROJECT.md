# Mathetogo Rechnungen (Nachhilfe Tracker)

## What This Is

A private invoicing and session-tracking tool for Mathetogo, a tutoring business. It manages students, records tutoring sessions synced from a calendar, and generates monthly PDF invoices in CHF. The owner (tutor) uses it to track revenue and send invoices via WhatsApp. Starting with v1.1, it also tracks revenue from the Mathetogo learning platform — a software product students can subscribe to as an add-on to their tutoring.

## Core Value

The tutor can track all income (tutoring sessions + platform subscriptions) and generate correct monthly invoices without manual calculation.

## Requirements

### Validated

- ✓ Student management (name, subject, rate per minute, currency) — v1.0
- ✓ Session tracking synced from calendar — v1.0
- ✓ Monthly invoice generation with PDF output — v1.0
- ✓ Tutor profile settings (IBAN, address, bank) — v1.0
- ✓ Invoice history and status tracking — v1.0
- ✓ Dashboard with revenue stats and charts — v1.0

### Active

- [ ] Per-student Mathetogo platform subscription management (1-month or 6-month duration, variable CHF fee, billing method per student)
- [ ] Automatic monthly charge application for multi-month subscriptions
- [ ] Platform fee as separate line item on monthly invoice (when billing via invoice)
- [ ] Manual payment marking for students who pay platform fee via direct transfer
- [ ] Dashboard shows platform revenue included in totals AND broken out separately
- [ ] Per-student subscription status and payment history

### Out of Scope

- Automated payment collection / Stripe — not needed, tutor invoices manually
- Student-facing portal — tutor-only tool
- Multi-tutor support — single tutor use

## Context

- Stack: Next.js App Router, Prisma + PostgreSQL (Supabase), TypeScript, Tailwind CSS
- Invoice PDFs generated via react-pdf
- Sessions synced from Google Calendar via /app/sync
- Currency: CHF (Swiss Francs)
- Existing Invoice model has a unique constraint on [studentId, month, year]
- Platform subscription is a new revenue stream: some students pay via invoice (line item added), others pay directly (tracked manually as paid)
- Subscriptions are 1 month or 6 months. 6-month subscriptions apply a charge each of the 6 months automatically.

## Constraints

- **Tech stack**: Next.js + Prisma — all new features must stay in this stack
- **Database**: Supabase PostgreSQL — schema changes via Prisma migrations
- **Currency**: CHF only

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Platform fee as separate invoice line item | Tutor wants clear separation between tutoring and platform revenue on the PDF | — Pending |
| Subscription duration: 1 or 6 months | Matches how tutor currently sells access | — Pending |
| Separate payment tracking for direct transfers | Some students don't pay via invoice — need a way to mark received | — Pending |

---
*Last updated: 2026-04-22 after milestone v1.1 initialization*
