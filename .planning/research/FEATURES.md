# Feature Research

**Domain:** Manual subscription billing with invoice integration (tutoring/service business)
**Researched:** 2026-04-22
**Confidence:** HIGH — domain derived from requirements analysis, existing codebase inspection, and established patterns in manual invoicing systems

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features the tutor will immediately notice are missing. Without these, the system feels broken for the new use case.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Add subscription to a student (amount, duration, billing method) | Core action — no subscriptions means nothing else works | LOW | Must capture: CHF amount, duration (1 or 6 months), billing method (invoice / direct transfer), start month |
| Show current subscription status per student | Tutor needs to know at a glance: is this student subscribed, how long is left | LOW | Active / inactive badge + months remaining on student detail page |
| Automatic monthly charge records for multi-month subs | A 6-month subscription without automatic per-month tracking requires manual work every month — defeats the purpose | MEDIUM | One `PlatformCharge` record per month, created at subscription creation time for all future months |
| Platform fee line item on invoice PDF | Tutoring invoice is the delivery mechanism for billing — omitting the platform fee means tutor must re-generate or explain outside the system | MEDIUM | Requires modifying `InvoicePDF.tsx` and `getInvoicePayload()` to inject platform line item when billing method is "invoice" |
| Invoice total includes platform fee | If `totalCHF` on the Invoice record does not include the platform fee, reporting and the PDF total are wrong | LOW | Must be reflected both in PDF and in `Invoice.totalCHF` stored in DB |
| Manual payment marking for direct-transfer students | Tutor has no other way to reconcile which students paid their platform fee outside of invoices | LOW | A "Mark as paid" action on each monthly charge record, storing `paidAt` |
| Deactivate subscription before end of duration | Subscription cancellations happen — tutor needs a way to stop future charges without deleting history | LOW | Sets subscription to inactive; future unfired `PlatformCharge` records should be cancelled/deleted or marked void |
| Platform revenue visible in dashboard | Without it, the dashboard KPIs under-report actual income | MEDIUM | Must query `PlatformCharge` records (paid + invoiced) alongside session revenue |

### Differentiators (Good Implementations Have These)

Features that separate a thoughtful implementation from a bare-minimum one. Not required to launch, but they make the tool feel professional.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Platform revenue broken out separately on dashboard | Tutoring income and platform income behave differently (one is effort-based, one is recurring) — the tutor needs to track growth of each independently | LOW | A second stat card or a sub-line on the existing income cards; feeds DASH-01 through DASH-03 |
| Per-month payment status list on student detail page | Shows at a glance which months are charged, which are paid, and which are pending — essential for reconciliation | LOW | Table: Month / Amount / Status (paid / invoice-sent / unpaid) / Paid date |
| Visual distinction of platform line item in PDF | Tutor sends invoices to students; the student should immediately understand the two charge types | LOW | A divider row or a shaded row in InvoicePDF.tsx after session rows |
| Outstanding unpaid direct-transfer charges surface clearly | Tutor earns the money but only knows about it if they remember to check per student — a dashboard or list view of unpaid charges saves mental overhead | MEDIUM | A small "outstanding platform payments" section on dashboard or a dedicated page |
| Edit subscription (amount or billing method) | Prices change, students switch from invoice to direct transfer — without edit, the only option is deactivate + recreate | LOW | Edit form on student detail page; must handle whether existing unfired charges need repricing |
| Subscription history log per student | Tutor wants to see that a student was subscribed Jan–Jun 2025 at CHF 30/month, then resubscribed Oct 2025 at CHF 35 | MEDIUM | Scoped to v2 in REQUIREMENTS.md; simple to add once the model exists — just show all subscriptions including inactive ones |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem like good ideas but introduce disproportionate complexity or correctness risks for this context.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Auto-create invoice when subscription charge is due | Seems efficient — no manual step | Invoices in this system are generated on-demand (tutor clicks "Generate") and may cover sessions that don't exist yet. Auto-generating an invoice for only the platform fee on day 1 of the month creates orphan invoices that then conflict with the unique constraint `[studentId, month, year]` on the Invoice table | Keep invoice generation manual. The platform charge is a line item injected at generation time, not a trigger for generation. |
| Prorate subscriptions mid-month | Seems fair if a subscription starts on the 15th | Adds significant complexity (fractional CHF, rounding decisions, edge cases for 6-month spans crossing month boundaries). The tutor sets prices manually per student — they can simply set a lower amount for month one | Do not prorate. Start date is recorded but the full monthly amount is always charged for any started month. |
| Stripe or payment processor integration | Automates collection | Explicitly out of scope; the tutor's workflow is WhatsApp + manual bank transfer + invoice. Adding Stripe would require student accounts, onboarding, and ongoing maintenance | Manual payment marking (PAY-01 through PAY-03) is the correct scope-appropriate solution. |
| Send invoice email directly from the system | Would save one step | The tutor uses WhatsApp to send invoices — building email infrastructure (SMTP, templates, delivery tracking) adds complexity with no adoption benefit here | Continue generating PDF + sharing manually via WhatsApp |
| Recurring automatic renewal of subscriptions | Subscriptions auto-renew at end of duration | The tutor explicitly sells 1-month or 6-month terms and re-negotiates. Silent auto-renewal could create unexpected charges in the DB | Add a renewal reminder (v2 feature, SUB-V2-01) — tutor manually creates a new subscription |
| Multiple platform pricing tiers | More flexible pricing | The tutor sets a custom CHF amount per student. A tier system adds UI complexity (tier management, per-tier pricing) for zero benefit — the custom amount already is the tier | Keep custom per-student CHF amount as-is |

---

## Feature Dependencies

```
[Subscription model (SUB-01)]
    └──required by──> [Monthly charge records (SUB-04)]
    └──required by──> [Status display (SUB-05)]
    └──required by──> [Edit subscription (SUB-02)]
    └──required by──> [Deactivate subscription (SUB-03)]

[Monthly charge records (SUB-04)]
    └──required by──> [Platform line item on invoice (INV-01, INV-02, INV-03)]
    └──required by──> [Manual payment marking (PAY-01, PAY-02, PAY-03)]
    └──required by──> [Dashboard platform revenue (DASH-01, DASH-02, DASH-03)]

[Platform line item on invoice (INV-01)]
    └──depends on──> [Invoice generation (existing, v1.0)]
    └──must not break──> [Unique constraint: studentId + month + year on Invoice]

[Manual payment marking (PAY-01)]
    └──enhances──> [Status display (SUB-05)]

[Dashboard platform revenue (DASH-01)]
    └──enhances──> [Existing dashboard year/month filter (existing, v1.0)]
```

### Dependency Notes

- **Subscription model is the foundation:** Everything in v1.1 depends on a `Subscription` (or equivalent) Prisma model existing. SUB-01 must be the first feature built.
- **Monthly charge records enable everything else:** `PlatformCharge` records (one per month per subscription) are what the invoice, payment tracking, and dashboard all read from. They should be created eagerly at subscription creation (for all future months of a 6-month sub), not lazily.
- **Invoice integration depends on existing invoice flow:** The platform line item must be injected into `getInvoicePayload()` at generation time. The Invoice `totalCHF` must be updated to include the fee. The unique constraint on `Invoice` is pre-existing and must be respected — one invoice per student per month.
- **Dashboard changes depend on platform charges existing:** DASH-01 through DASH-03 can only be implemented after PlatformCharge data is being written. Dashboard work is the last phase.
- **Edit subscription has a correctness edge case:** If a subscription's amount is changed, should existing unfired (future) PlatformCharge records be repriced? Yes — they should be updated to the new amount. This makes edit slightly more complex than a simple field update.

---

## MVP Definition

### Launch With (v1.1)

All 14 requirements from REQUIREMENTS.md are the milestone scope. Within that, the implementation order matters:

- [ ] **Subscription model + add subscription UI (SUB-01)** — nothing else is possible without this
- [ ] **Monthly charge record creation (SUB-04)** — must happen at subscription creation time
- [ ] **Platform line item on invoice PDF (INV-01, INV-02, INV-03)** — highest user-visible value; invoicing is the primary workflow
- [ ] **Manual payment marking (PAY-01, PAY-02, PAY-03)** — needed for direct-transfer students from day one
- [ ] **Status display on student detail page (SUB-05)** — completes the student-level view
- [ ] **Edit and deactivate subscription (SUB-02, SUB-03)** — required for lifecycle management
- [ ] **Dashboard platform revenue (DASH-01, DASH-02, DASH-03)** — adds platform income to existing reporting

### Add After Validation (v1.x)

- [ ] **Outstanding platform payments view** — a consolidated list of all unpaid direct-transfer charges across all students; add once the tutor confirms the per-student view is insufficient
- [ ] **Subscription history display per student** — show past (inactive) subscriptions; add once active subscriptions are stable

### Future Consideration (v2+)

- [ ] **Renewal reminders (SUB-V2-01)** — alert when a subscription is about to expire; defer until v2 per REQUIREMENTS.md
- [ ] **Full subscription history log (SUB-V2-02)** — amount/date history across all subscriptions per student; defer to v2

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Add subscription (SUB-01) | HIGH | LOW | P1 |
| Monthly charge records (SUB-04) | HIGH | MEDIUM | P1 |
| Platform line item on invoice (INV-01/02/03) | HIGH | MEDIUM | P1 |
| Manual payment marking (PAY-01/02/03) | HIGH | LOW | P1 |
| Status display on student page (SUB-05) | MEDIUM | LOW | P1 |
| Edit subscription (SUB-02) | MEDIUM | LOW | P1 |
| Deactivate subscription (SUB-03) | MEDIUM | LOW | P1 |
| Dashboard platform revenue (DASH-01/02/03) | HIGH | LOW | P1 |
| Outstanding payments consolidated view | MEDIUM | LOW | P2 |
| Subscription history display | LOW | LOW | P2 |
| Renewal reminders | MEDIUM | MEDIUM | P3 |

**Priority key:**
- P1: Must have for v1.1 milestone
- P2: Add after v1.1 is stable, low effort
- P3: v2 scope

---

## Existing System Integration Points

This is a subsequent milestone. The following existing components will be touched by v1.1 features and need careful integration:

| Existing Component | How v1.1 Touches It | Risk |
|-------------------|---------------------|------|
| `prisma/schema.prisma` | Add `Subscription` and `PlatformCharge` models; add relation on `Student` | LOW — additive schema change |
| `lib/invoice.ts` → `getInvoicePayload()` | Inject platform charge as a line item when billing method is "invoice" | MEDIUM — must not break existing invoices for students without subscriptions |
| `components/InvoicePDF.tsx` | Render platform line item in a visually distinct row; update totals section | MEDIUM — layout change must not break existing invoice rendering |
| `app/api/invoice/generate/route.ts` | `totalCHF` calculation must include platform fee | MEDIUM — stored `totalCHF` on Invoice record will change meaning |
| `app/students/[id]/page.tsx` | Add subscription section: status, monthly charge table, add/edit/deactivate controls | LOW — additive UI |
| `app/dashboard/page.tsx` | Add platform revenue to KPI cards; add breakdown stat | LOW — additive data fetch |
| `Invoice` model unique constraint `[studentId, month, year]` | Unchanged — platform fee is a line item on the existing invoice, not a separate invoice | LOW — no conflict if implemented correctly |

---

## Sources

- Project files: `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`
- Existing codebase: `prisma/schema.prisma`, `components/InvoicePDF.tsx`, `app/api/invoice/generate/route.ts`, `app/dashboard/page.tsx`, `app/students/[id]/page.tsx`
- Domain knowledge: Manual invoicing patterns in service businesses (tutoring, consulting, SaaS with manual billing)
- Confidence: HIGH for all table stakes (derived directly from requirements + codebase); HIGH for anti-features (standard patterns in manual billing systems); MEDIUM for differentiators (informed by system context, no external verification available)

---

*Feature research for: Mathetogo platform subscription billing (v1.1 milestone)*
*Researched: 2026-04-22*
