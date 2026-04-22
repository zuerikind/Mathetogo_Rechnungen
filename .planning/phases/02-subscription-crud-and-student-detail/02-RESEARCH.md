# Phase 2: Subscription CRUD and Student Detail - Research

**Researched:** 2026-04-22
**Domain:** Next.js App Router API routes, React client state, Prisma CRUD, Tailwind UI
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SUB-01 | Tutor can add a Mathetogo platform subscription to a student (amount in CHF, duration: 1 or 6 months, billing method: invoice or direct transfer) | POST /api/subscriptions route; inline form on student detail page; Prisma `create` on `PlatformSubscription`; startMonth/startYear default to current month |
| SUB-02 | Tutor can edit an existing subscription (change amount or billing method) | PATCH /api/subscriptions/[id] route; editing updates `amountCHF` / `billingMethod` only; does NOT touch existing `PlatformCharge` rows — charge count stays equal to `durationMonths` |
| SUB-03 | Tutor can deactivate a subscription before its duration ends | PATCH /api/subscriptions/[id] route (same endpoint as SUB-02, `active: false`); after deactivation ensureChargeForMonth skips the subscription in Phase 3 because it checks `active === true` |
| SUB-05 | Student detail page shows current subscription status (active/inactive), monthly amount, duration remaining, and per-month payment status (paid/unpaid/scheduled) | New `SubscriptionSection` component on student detail page; data fetched from GET /api/subscriptions?studentId=X; months remaining computed client-side from startMonth/startYear/durationMonths; charge status derived from PlatformCharge.paidAt and whether the month is past/current/future |
</phase_requirements>

---

## Summary

Phase 2 is the first UI-heavy phase. It adds API routes for subscription CRUD and a new subscription section to the existing student detail page. The data model (PlatformSubscription + PlatformCharge) was created in Phase 1 and is ready to use.

The key architectural tension is between SUB-02 (editing must not create extra charges) and the just-in-time charge generation strategy locked in STATE.md. The resolution is straightforward: edit operations update `PlatformSubscription` fields (`amountCHF`, `billingMethod`) but never touch `PlatformCharge` rows. Charges are generated at invoice-time (Phase 3), so an edit before charges are created simply changes what future charges will look like; an edit after charges are created leaves existing charge rows unchanged and only affects the subscription record itself.

The student detail page (`app/students/[id]/page.tsx`) is a client component that fetches data via `fetch`. Phase 2 adds a third parallel fetch for subscriptions alongside the existing student and sessions fetches. A new `SubscriptionSection` component handles the display and inline actions (add/edit/deactivate). The UI follows existing component patterns: Tailwind, `rounded-2xl border border-blue-100 bg-white shadow-sm` card containers, `#4A7FC1` for primary actions, `text-red-500` for destructive actions.

**Primary recommendation:** Create `/api/subscriptions` (POST + GET) and `/api/subscriptions/[id]` (PATCH), then add a `SubscriptionSection` component to the student detail page. No new npm dependencies are needed.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @prisma/client | ^5.22.0 | Database access for PlatformSubscription + PlatformCharge | Already in project; all DB access via `prisma` singleton from `lib/prisma.ts` |
| next | 14.2.35 | App Router API routes and page components | Already in project; all routes use NextRequest/NextResponse pattern |
| react | ^18 | Client components, useState, useEffect, useCallback | Already in project; student detail page is already "use client" |
| tailwindcss | ^3.3.0 | Styling | Already in project; all components use Tailwind |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| next-auth | ^5.0.0-beta.25 | Auth guard on API routes | All API routes call `auth()` from `@/auth` and return 401 if no session |

**No new dependencies are required for Phase 2.**

---

## Architecture Patterns

### Recommended New File Structure

```
app/
  api/
    subscriptions/
      route.ts              ← GET (by studentId) + POST (create)
      [id]/
        route.ts            ← PATCH (edit amount/billingMethod or deactivate)

components/
  SubscriptionSection.tsx   ← displays subscription list + inline add/edit form

app/students/[id]/
  page.tsx                  ← existing file; add SubscriptionSection and third fetch
```

No new lib files are needed. The existing `lib/platform-charges.ts` exports (`getChargeMonths`, `addMonths`) are used client-side to compute "months remaining" from subscription data.

### Pattern 1: API Route — GET + POST /api/subscriptions

**What:** GET returns all subscriptions for a student (with their charges). POST creates a new subscription.

**When to use:** Student detail page fetches on mount; Add Subscription form posts here.

```typescript
// app/api/subscriptions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get("studentId");
  if (!studentId) return NextResponse.json({ error: "studentId required" }, { status: 400 });

  const subscriptions = await prisma.platformSubscription.findMany({
    where: { studentId },
    include: { charges: { orderBy: [{ year: "asc" }, { month: "asc" }] } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(subscriptions);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { studentId, amountCHF, durationMonths, billingMethod, startMonth, startYear } = body;

  if (!studentId || amountCHF == null || !durationMonths || !billingMethod || !startMonth || !startYear) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (![1, 6].includes(Number(durationMonths))) {
    return NextResponse.json({ error: "durationMonths must be 1 or 6" }, { status: 400 });
  }
  if (!["invoice", "direct"].includes(billingMethod)) {
    return NextResponse.json({ error: "billingMethod must be invoice or direct" }, { status: 400 });
  }

  const subscription = await prisma.platformSubscription.create({
    data: {
      studentId,
      amountCHF: Number(amountCHF),
      durationMonths: Number(durationMonths),
      billingMethod,
      startMonth: Number(startMonth),
      startYear: Number(startYear),
    },
    include: { charges: true },
  });
  return NextResponse.json(subscription, { status: 201 });
}
```

**Confidence:** HIGH — mirrors exact pattern of `/api/students/route.ts` (GET + POST, `auth()` guard, Prisma calls).

### Pattern 2: API Route — PATCH /api/subscriptions/[id]

**What:** Updates `amountCHF` and/or `billingMethod` (edit), OR sets `active: false` (deactivate). Uses spread pattern from `/api/students/[id]/route.ts`.

**Critical rule for SUB-02:** NEVER touch `PlatformCharge` rows in this handler. Editing a subscription changes the subscription record only.

```typescript
// app/api/subscriptions/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { amountCHF, billingMethod, active } = body;

  // Validate billingMethod if provided
  if (billingMethod !== undefined && !["invoice", "direct"].includes(billingMethod)) {
    return NextResponse.json({ error: "billingMethod must be invoice or direct" }, { status: 400 });
  }

  const subscription = await prisma.platformSubscription.update({
    where: { id: params.id },
    data: {
      ...(amountCHF !== undefined && { amountCHF: Number(amountCHF) }),
      ...(billingMethod !== undefined && { billingMethod }),
      ...(active !== undefined && { active: Boolean(active) }),
    },
    include: { charges: { orderBy: [{ year: "asc" }, { month: "asc" }] } },
  });
  return NextResponse.json(subscription);
}
```

**Confidence:** HIGH — mirrors `/api/students/[id]/route.ts` PUT pattern exactly.

### Pattern 3: SubscriptionSection Component

**What:** Client component added to the student detail page. Fetches subscriptions for the student, displays them in a card, provides Add/Edit/Deactivate actions via inline forms.

**State model:**
- `subscriptions: PlatformSubscriptionWithCharges[]` — loaded on mount
- `showAddForm: boolean` — toggles inline add form
- `editingId: string | null` — which subscription is being edited (null = none)
- `loading: boolean`, `error: string`

**Display for each subscription:**
- Badge: "Aktiv" (green) or "Inaktiv" (gray)
- Monthly amount in CHF
- Months remaining: computed as `durationMonths - chargesCreatedSoFar` (or by comparing current date against startMonth/startYear + durationMonths)
- Per-month charge list: each charge shows month/year label, amount, status (paid = paidAt is set; unpaid = paidAt null and month is past; scheduled = month is future)

**Months remaining formula:**
```typescript
// Months remaining for a subscription (can go negative if overdue — clamp to 0)
function monthsRemaining(sub: PlatformSubscription): number {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  // end month (exclusive) = addMonths(startMonth, startYear, durationMonths)
  const end = addMonths(sub.startMonth, sub.startYear, sub.durationMonths);
  // months from now to end
  const totalMonthsFromStart = (end.year - currentYear) * 12 + (end.month - currentMonth);
  return Math.max(0, totalMonthsFromStart);
}
```

**Charge status classification:**
```typescript
type ChargeStatus = "paid" | "unpaid" | "scheduled";

function chargeStatus(charge: PlatformCharge): ChargeStatus {
  if (charge.paidAt) return "paid";
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  // Future month = scheduled; past/current without paidAt = unpaid
  if (charge.year > currentYear || (charge.year === currentYear && charge.month > currentMonth)) {
    return "scheduled";
  }
  return "unpaid";
}
```

**Note on charge list vs. scheduled months:** At Phase 2 time, `PlatformCharge` rows are only created by `ensureChargeForMonth` (Phase 3, called at invoice time). A newly created subscription will therefore have zero `charges` rows. The charge list in SUB-05 must handle this: for subscriptions with no charges yet, derive the expected month list from `getChargeMonths(startMonth, startYear, durationMonths)` and show each as "scheduled". For subscriptions with some charges (after Phase 3 runs), merge actual charge rows with remaining scheduled months.

**Confidence:** HIGH — charge status logic is pure arithmetic on known schema fields; getChargeMonths is already implemented in lib/platform-charges.ts.

### Pattern 4: Student Detail Page Integration

**What:** Add a third fetch to the existing `load` callback in `app/students/[id]/page.tsx` and render `<SubscriptionSection>` below the existing sections.

```typescript
// In the load callback (existing file), add:
const [studentRes, sessionsRes, subscriptionsRes] = await Promise.all([
  fetch(`/api/students/${id}`),
  fetch(`/api/sessions?studentId=${encodeURIComponent(id)}`),
  fetch(`/api/subscriptions?studentId=${encodeURIComponent(id)}`),
]);
// ...
setSubscriptions((await subscriptionsRes.json()) as PlatformSubscriptionWithCharges[]);
```

The `SubscriptionSection` component receives the `studentId` and initial `subscriptions` array as props, and manages its own mutation state (add/edit/deactivate).

### Anti-Patterns to Avoid

- **Modifying PlatformCharge rows on subscription edit (SUB-02):** The PATCH handler must only update the `PlatformSubscription` record. Charges created before an edit remain at the old `amountCHF` — this is by design (Phase 4 / ledger accuracy). Do not cascade-update charge amounts.
- **Eager charge creation on POST:** Do not call `ensureChargeForMonth` in the POST handler. Charge creation is Phase 3's responsibility (`getInvoicePayload` → `ensureChargeForMonth`). Creating charges at subscription creation time would violate the just-in-time decision locked in STATE.md.
- **Client-side auth:** Do not skip `auth()` on any API route. Every handler follows the same guard pattern.
- **Separate "deactivate" endpoint:** Use the same PATCH `/api/subscriptions/[id]` with `{ active: false }` body. This matches the existing pattern where student deactivation uses `PUT /api/students/[id]` with `{ active: false }`.
- **Fetching all subscriptions globally:** The GET endpoint filters by `studentId`. Never return all subscriptions without a filter — the index is small now but establishes the correct access pattern.
- **Showing charges before Phase 3:** The charge list for a new subscription will be empty until invoice generation runs. Display expected months as "scheduled" using `getChargeMonths` — do not show an empty list with no explanation.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Month label formatting | Custom formatter | `monthOptions` from `lib/ui-format.ts` | Already provides German month names (Januar, Februar...) indexed 1–12 |
| CHF amount display | Custom number format | `formatCHF()` from `lib/ui-format.ts` | Already uses `Intl.NumberFormat("de-CH")` — consistent with all other amounts in the UI |
| Month arithmetic (end date, remaining) | Custom date logic | `addMonths()` + `getChargeMonths()` from `lib/platform-charges.ts` | Already implemented and tested in Phase 1 |
| Auth check | Custom session check | `auth()` from `@/auth` | Used in every existing API route; single consistent pattern |
| Prisma client instance | New PrismaClient() | `prisma` from `lib/prisma.ts` | Singleton pattern already established; instantiating directly in routes causes connection pool exhaustion |

**Key insight:** All the infrastructure (auth, Prisma, formatters, month arithmetic) is already present. Phase 2 is wiring, not building new infrastructure.

---

## Common Pitfalls

### Pitfall 1: Charge Count Creep on Edit (SUB-02)

**What goes wrong:** The PATCH handler inadvertently calls `ensureChargeForMonth` or re-runs charge generation after editing `amountCHF`, creating duplicate or extra charge rows.

**Why it happens:** Over-engineering the edit path — trying to "sync" charges to reflect the new amount.

**How to avoid:** The PATCH handler updates only `PlatformSubscription` fields. Charge amounts are snapshotted at the time `ensureChargeForMonth` runs (Phase 3). If the tutor changes the amount after some charges are already created, only future charges (not yet created) reflect the new amount. This is the correct and locked behavior.

**Warning signs:** `SELECT COUNT(*) FROM PlatformCharge WHERE subscriptionId = X` returns more rows than `durationMonths`.

### Pitfall 2: Empty Charge List UX (SUB-05)

**What goes wrong:** A brand-new subscription shows "0 charges" with no context, confusing the tutor.

**Why it happens:** Phase 2 UI reads `subscription.charges` which is empty until Phase 3 invoice generation runs.

**How to avoid:** Display logic must derive expected months using `getChargeMonths(startMonth, startYear, durationMonths)` and mark each as "scheduled" if no matching charge row exists. The UI should show all expected months, not just created charges.

**Implementation:** Build a merged view client-side:
```typescript
const expectedMonths = getChargeMonths(sub.startMonth, sub.startYear, sub.durationMonths);
const chargeMap = new Map(sub.charges.map(c => [`${c.year}-${c.month}`, c]));
const rows = expectedMonths.map(({ month, year }) => ({
  month, year,
  charge: chargeMap.get(`${year}-${month}`) ?? null,
  status: chargeMap.has(`${year}-${month}`)
    ? chargeStatus(chargeMap.get(`${year}-${month}`)!)
    : "scheduled" as ChargeStatus,
}));
```

### Pitfall 3: One Active Subscription Per Student (Business Rule)

**What goes wrong:** The tutor accidentally creates two active subscriptions for the same student.

**Why it happens:** The database has no constraint preventing it (by design from Phase 1 — Phase 1 research note: "enforced by application logic in Phase 2, not a DB constraint").

**How to avoid:** In the POST handler, check whether the student already has an active subscription before creating a new one:
```typescript
const existing = await prisma.platformSubscription.findFirst({
  where: { studentId, active: true },
});
if (existing) {
  return NextResponse.json(
    { error: "Student hat bereits ein aktives Abonnement" },
    { status: 409 }
  );
}
```

Also disable the "Add Subscription" button in the UI when an active subscription already exists.

**Warning signs:** Two rows in `PlatformSubscription` with `active = true` for the same `studentId`.

### Pitfall 4: startMonth/startYear Default in Form

**What goes wrong:** The add form requires the tutor to manually set the start month, causing friction.

**Why it happens:** Form built without sensible defaults.

**How to avoid:** Default `startMonth` and `startYear` to the current month and year in the form. The tutor can override if needed (e.g., back-dating a subscription). Use `getCurrentMonthYear()` from `lib/ui-format.ts`.

### Pitfall 5: TypeScript Types for New API Responses

**What goes wrong:** The student detail page uses `as Student` casts but the new subscription response has no matching type in `lib/ui-types.ts`, leading to `any` usage or missing fields.

**Why it happens:** `lib/ui-types.ts` currently defines `Student` and `SessionWithStudent` but nothing for subscriptions.

**How to avoid:** Add `PlatformSubscriptionWithCharges` type to `lib/ui-types.ts` (or inline in `SubscriptionSection.tsx`) before consuming the API response. Mirror the Prisma model shape:
```typescript
// lib/ui-types.ts additions
export type PlatformCharge = {
  id: string;
  subscriptionId: string;
  month: number;
  year: number;
  amountCHF: number;
  paidAt: string | null; // ISO string from JSON serialization
  createdAt: string;
};

export type PlatformSubscriptionWithCharges = {
  id: string;
  studentId: string;
  amountCHF: number;
  billingMethod: string; // "invoice" | "direct"
  durationMonths: number;
  startMonth: number;
  startYear: number;
  active: boolean;
  charges: PlatformCharge[];
  createdAt: string;
  updatedAt: string;
};
```

---

## Code Examples

### GET /api/subscriptions — fetch with charges included

```typescript
// Source: Prisma include pattern, mirrors app/api/invoices/route.ts lines 11-36
const subscriptions = await prisma.platformSubscription.findMany({
  where: { studentId },
  include: { charges: { orderBy: [{ year: "asc" }, { month: "asc" }] } },
  orderBy: { createdAt: "desc" },
});
```

### POST validation — one active subscription per student

```typescript
// Source: Business rule from Phase 1 research (application-level enforcement)
const existing = await prisma.platformSubscription.findFirst({
  where: { studentId, active: true },
});
if (existing) {
  return NextResponse.json(
    { error: "Student hat bereits ein aktives Abonnement" },
    { status: 409 }
  );
}
```

### PATCH — edit without touching charges

```typescript
// Source: mirrors app/api/students/[id]/route.ts PUT (lines 17-38)
const subscription = await prisma.platformSubscription.update({
  where: { id: params.id },
  data: {
    ...(amountCHF !== undefined && { amountCHF: Number(amountCHF) }),
    ...(billingMethod !== undefined && { billingMethod }),
    ...(active !== undefined && { active: Boolean(active) }),
  },
  include: { charges: { orderBy: [{ year: "asc" }, { month: "asc" }] } },
});
// NOTE: No call to ensureChargeForMonth or any PlatformCharge mutation here.
```

### Merged charge/scheduled view (client-side)

```typescript
// Source: pattern derived from getChargeMonths in lib/platform-charges.ts
import { getChargeMonths, addMonths } from "@/lib/platform-charges";

const expectedMonths = getChargeMonths(sub.startMonth, sub.startYear, sub.durationMonths);
const chargeMap = new Map(sub.charges.map(c => [`${c.year}-${c.month}`, c]));

const chargeRows = expectedMonths.map(({ month, year }) => {
  const charge = chargeMap.get(`${year}-${month}`) ?? null;
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const isFuture = year > currentYear || (year === currentYear && month > currentMonth);
  const status: "paid" | "unpaid" | "scheduled" =
    charge?.paidAt ? "paid" :
    !charge && isFuture ? "scheduled" :
    charge && isFuture ? "scheduled" :
    "unpaid";
  return { month, year, charge, status };
});
```

### Tailwind badge pattern for status

```tsx
// Source: derived from existing badge patterns in StudentTable.tsx and InvoiceHistoryClient.tsx
const statusBadge = {
  paid:      "bg-green-100 text-green-700",
  unpaid:    "bg-red-100 text-red-600",
  scheduled: "bg-gray-100 text-gray-500",
};

<span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge[status]}`}>
  {status === "paid" ? "Bezahlt" : status === "unpaid" ? "Ausstehend" : "Geplant"}
</span>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Pages Router API routes (`pages/api/`) | App Router Route Handlers (`app/api/*/route.ts`) | Next.js 13+ | Project already uses App Router; all new routes must be in `app/api/` |
| Class components, lifecycle methods | `"use client"` with hooks (useState, useEffect, useCallback) | React 18 | Project already uses this pattern; student detail page is the reference implementation |

**No deprecated patterns in scope for this phase.**

---

## Open Questions

1. **Should "Edit" be inline or modal?**
   - What we know: The project has no modal component; all forms in students/page.tsx are inline toggles
   - What's unclear: For the subscription edit (amount + billingMethod), is an inline form below the subscription row sufficient, or does UX warrant a modal?
   - Recommendation: Use the same inline reveal pattern as the existing student form (show/hide via state boolean). Avoids needing a modal library.

2. **Should deactivation require confirmation?**
   - What we know: Student deactivation in StudentTable.tsx calls `onDeactivate` directly without a confirm step
   - What's unclear: Subscription deactivation is more consequential (stops billing) — might need a confirm prompt
   - Recommendation: Add a browser `confirm()` dialog before sending the PATCH with `{ active: false }`. Simple, no library needed, consistent with the no-modal pattern.

3. **What happens when Phase 3 is not yet deployed — should `charges` being empty affect SUB-05 display?**
   - What we know: Phase 2 is complete before Phase 3. At Phase 2 demo time, `charges` will always be empty.
   - What's unclear: Should the UI show a note like "Abrechnungen werden bei Rechnungserstellung erstellt"?
   - Recommendation: Yes — add a small note below the charge list when all rows are "scheduled" (no charges yet created). This is cosmetic and can be removed after Phase 3 is live.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.5 |
| Config file | `vitest.config.ts` (exists, configured in Phase 1) |
| Quick run command | `npx vitest run lib/` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SUB-01 | POST /api/subscriptions creates a PlatformSubscription row | manual / smoke | manual — requires DB | ❌ manual-only |
| SUB-01 | POST rejects durationMonths not in [1, 6] | unit (handler logic) | manual — no DB test harness | ❌ manual-only |
| SUB-01 | POST returns 409 if student already has active subscription | unit (handler logic) | manual — no DB test harness | ❌ manual-only |
| SUB-02 | PATCH updates amountCHF without creating new PlatformCharge rows | manual / smoke | manual — requires DB | ❌ manual-only |
| SUB-03 | PATCH with { active: false } marks subscription inactive | manual / smoke | manual — requires DB | ❌ manual-only |
| SUB-03 | Deactivated subscription shows as inactive in UI | UI smoke | manual — browser test | ❌ manual-only |
| SUB-05 | chargeStatus() returns "paid" when paidAt is set | unit | `npx vitest run lib/subscription-utils.test.ts` | ❌ Wave 0 gap |
| SUB-05 | chargeStatus() returns "scheduled" for future months | unit | `npx vitest run lib/subscription-utils.test.ts` | ❌ Wave 0 gap |
| SUB-05 | chargeStatus() returns "unpaid" for past months without paidAt | unit | `npx vitest run lib/subscription-utils.test.ts` | ❌ Wave 0 gap |
| SUB-05 | monthsRemaining() returns 0 for expired subscription | unit | `npx vitest run lib/subscription-utils.test.ts` | ❌ Wave 0 gap |
| SUB-05 | Merged charge/scheduled rows has length === durationMonths | unit | `npx vitest run lib/subscription-utils.test.ts` | ❌ Wave 0 gap |

**Note:** API route integration tests require a test DB which this project does not have. All API behavior is verified by manual smoke testing against the dev/Supabase DB. The unit-testable logic (status classification, month arithmetic helpers) should be extracted to `lib/subscription-utils.ts` so it can be tested without a DB.

### Sampling Rate

- **Per task commit:** `npx vitest run lib/` (catches regressions in platform-charges and new subscription-utils)
- **Per wave merge:** `npx vitest run`
- **Phase gate:** All vitest tests green + manual smoke of add/edit/deactivate flow in browser before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `lib/subscription-utils.ts` — extract `chargeStatus()`, `monthsRemaining()`, and charge-merge logic so they are unit-testable without a DB
- [ ] `lib/subscription-utils.test.ts` — covers the 5 unit behaviors listed above

*(API route tests are manual-only due to no test DB. This is consistent with Phase 1's treatment of `ensureChargeForMonth`.)*

---

## Sources

### Primary (HIGH confidence)

- Existing codebase — `app/api/students/[id]/route.ts`, `app/api/invoices/[id]/status/route.ts` (PATCH pattern, auth guard, spread update)
- Existing codebase — `app/students/[id]/page.tsx` (client component fetch pattern, state management)
- Existing codebase — `lib/platform-charges.ts` (addMonths, getChargeMonths — phase 1 output, confirmed implemented)
- Existing codebase — `prisma/schema.prisma` (PlatformSubscription + PlatformCharge models confirmed present)
- `lib/ui-types.ts`, `lib/ui-format.ts` — established type and formatting conventions
- STATE.md — locked decisions: just-in-time charges, billingMethod as String, one-active-subscription enforced at application level

### Secondary (MEDIUM confidence)

- Phase 1 Research (`01-RESEARCH.md`) — confirms PlatformCharge rows are empty until Phase 3; confirms no DB constraint on one-active-subscription-per-student

### Tertiary (LOW confidence)

- None. All findings are derived from the existing codebase directly.

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new dependencies; all patterns from existing routes
- Architecture: HIGH — API shape, component integration point, and data flow are directly derivable from Phase 1 schema and existing code patterns
- Pitfalls: HIGH — charge-count-creep and empty-charge-list issues are logical consequences of the just-in-time decision; one-active-subscription rule was flagged in Phase 1 research as application-level enforcement

**Research date:** 2026-04-22
**Valid until:** 2026-07-22 (Next.js 14 stable, Prisma 5.x stable)
