# Requirements: Mathetogo Rechnungen

**Defined:** 2026-04-22
**Core Value:** The tutor can track all income (tutoring sessions + platform subscriptions) and generate correct monthly invoices without manual calculation.

## v1.1 Requirements

### Subscription Management

- [ ] **SUB-01**: Tutor can add a Mathetogo platform subscription to a student (amount in CHF, duration: 1 or 6 months, billing method: invoice or direct transfer)
- [ ] **SUB-02**: Tutor can edit an existing subscription (change amount or billing method)
- [ ] **SUB-03**: Tutor can deactivate a subscription before its duration ends
- [ ] **SUB-04**: System automatically applies a monthly platform charge for each active subscription month (for 6-month subscriptions, one charge per month for 6 months)
- [ ] **SUB-05**: Student detail page shows current subscription status (active/inactive), monthly amount, duration remaining, and per-month payment status

### Invoice Integration

- [ ] **INV-01**: When a student's subscription billing method is "invoice", the platform fee appears as a separate line item ("Mathetogo Platform – [Month Year]") on their monthly invoice PDF
- [ ] **INV-02**: Invoice total correctly includes the platform fee alongside tutoring session amounts
- [ ] **INV-03**: Platform line item is visually distinct from tutoring session lines in the PDF

### Separate Payment Tracking

- [ ] **PAY-01**: Tutor can mark a monthly platform charge as received (for students paying via direct transfer)
- [ ] **PAY-02**: Marked payments show a paid date and are visually differentiated from unpaid charges
- [ ] **PAY-03**: Unpaid direct-transfer charges are visible so the tutor knows what is still outstanding

### Dashboard & Reporting

- [ ] **DASH-01**: Dashboard total revenue stat includes platform subscription revenue
- [ ] **DASH-02**: Dashboard shows platform revenue as a separate figure (not only folded into the total)
- [ ] **DASH-03**: Platform revenue respects the existing year/month filter on the dashboard

## v2 Requirements

### Advanced Subscription Features

- **SUB-V2-01**: Automatic renewal reminder when a subscription is about to expire
- **SUB-V2-02**: Subscription history log per student (past subscriptions with amounts and dates)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Automated payment collection (Stripe, etc.) | Tutor invoices manually; not needed |
| Student-facing subscription portal | Tutor-only tool |
| Multiple platform tiers / pricing plans | Tutor sets custom amount per student |
| Email invoices with platform fee | Out of current scope; WhatsApp used |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SUB-01 | — | Pending |
| SUB-02 | — | Pending |
| SUB-03 | — | Pending |
| SUB-04 | — | Pending |
| SUB-05 | — | Pending |
| INV-01 | — | Pending |
| INV-02 | — | Pending |
| INV-03 | — | Pending |
| PAY-01 | — | Pending |
| PAY-02 | — | Pending |
| PAY-03 | — | Pending |
| DASH-01 | — | Pending |
| DASH-02 | — | Pending |
| DASH-03 | — | Pending |

**Coverage:**
- v1.1 requirements: 14 total
- Mapped to phases: 0 (pending roadmap)
- Unmapped: 14 ⚠️

---
*Requirements defined: 2026-04-22*
*Last updated: 2026-04-22 after initial definition*
