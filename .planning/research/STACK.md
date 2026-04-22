# Stack Research

**Domain:** Subscription + monthly charge tracking added to an existing Next.js + Prisma invoicing app
**Researched:** 2026-04-22
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

All core technologies are already present. No new core framework additions are needed.

| Technology | Version (installed) | Purpose | Why Recommended |
|------------|---------------------|---------|-----------------|
| Prisma | ^5.22.0 | Schema migrations + ORM queries | Already in use; `prisma migrate dev` handles additive schema changes cleanly without touching existing data |
| Next.js App Router | 14.2.35 | Server Actions + Route Handlers for subscription CRUD | Already in use; Server Actions are the right pattern for form mutations (add/edit/deactivate subscription) |
| PostgreSQL via Supabase | (managed) | Persists PlatformSubscription and PlatformCharge rows | Already in use; no driver changes needed |
| TypeScript | ^5 | Type safety for new models after `prisma generate` | Already in use; generated types auto-update after schema migration |

### Supporting Libraries

**Verdict: No new npm packages are needed.** Every capability required by the new features is already covered by the installed stack.

| Capability | How to Achieve It | Why No New Package |
|------------|------------------|-------------------|
| Month/year arithmetic (generate 6 charges from a 6-month subscription) | Plain JS: increment month with wraparound `month % 12 + 1`, carry year | No date library needed; months are stored as integers (1–12) already, matching the existing Session/Invoice pattern |
| Subscription status (active / expired) | Computed in TypeScript from `startMonth`, `startYear`, `duration` at query time — no stored enum needed | Avoids a stored status field that can desync; derive from data |
| Monthly charge generation (SUB-04) | Prisma `createMany` in a server action or migration script; idempotent via `skipDuplicates: true` after adding a `@@unique([subscriptionId, month, year])` constraint | `createMany` with `skipDuplicates` is a Prisma 5 built-in — no job queue or cron library needed for a single-tutor app |
| Platform line item in PDF (INV-01) | Pass `PlatformCharge` amount into the existing `@react-pdf/renderer` invoice template | `@react-pdf/renderer` is already installed at ^4.5.1 |
| Dashboard aggregation (DASH-01–03) | Prisma `groupBy` + `_sum` on `PlatformCharge.amountCHF` filtered by `paidAt IS NOT NULL` or by month/year | Already the pattern used for session revenue |
| Mark charge paid (PAY-01) | `prisma.platformCharge.update({ where: { id }, data: { paidAt: new Date() } })` in a Server Action | Standard Prisma update |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `prisma migrate dev` | Apply new schema models to Supabase dev database | Run locally against `DATABASE_URL`; generates a timestamped SQL migration file that can be committed |
| `prisma generate` | Regenerate PrismaClient types after schema changes | Run automatically via `postinstall` script already in `package.json` |
| `prisma studio` | Inspect/edit subscription + charge rows during development | Already wired in `db:studio` npm script |

## Installation

No new packages to install. Zero new dependencies.

```bash
# After editing prisma/schema.prisma with the new models:
npx dotenv -e .env.local -- prisma migrate dev --name add-platform-subscriptions
```

This generates the migration SQL and applies it to the dev database. The migration is additive (new tables only) so existing Student, Session, Invoice, and TutorProfile data is untouched.

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Plain JS integer month arithmetic | `date-fns` or `dayjs` | Overkill for incrementing an integer 1–12 with year carry; adds a dependency with no other use in this app |
| Prisma `createMany` with `skipDuplicates` for charge generation | Background job (BullMQ, pg-cron) | Single-tutor app; charges are generated on demand (when subscription is created or when the tutor views the month). A cron job adds infrastructure complexity with no benefit |
| Computed subscription status in TypeScript | Stored `status` enum field on `PlatformSubscription` | A stored status can go stale if an edit happens. Deriving from `startMonth + startYear + duration` is always correct and removes a sync problem |
| Prisma `groupBy` for revenue aggregation | Raw SQL via `$queryRaw` | Prisma 5 `groupBy` with `_sum` covers this use case; raw SQL is only needed when Prisma's API falls short |

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Stripe or any payment SDK | Out of scope per PROJECT.md; tutor invoices manually | Prisma `paidAt` field + a "Mark Paid" button |
| `date-fns` / `dayjs` | No date manipulation beyond integer month/year arithmetic | Plain JS (`month % 12 + 1`, year carry) |
| State management library (Zustand, Jotai) | Subscription UI is form-based CRUD; React state + Server Actions is sufficient | React `useState` + Next.js Server Actions |
| Background job runner (BullMQ, Inngest) | Single-tutor, low-volume app; on-demand charge generation is fine | Generate charges synchronously when subscription is saved |
| Separate subscription microservice | No justification in a single-tutor tool | Prisma models in the existing schema |

## Schema Integration Points

The two new models attach to the existing `Student` model via foreign key. The `PlatformCharge` model mirrors the `month`/`year` integer pattern already used by `Session` and `Invoice`.

```prisma
model PlatformSubscription {
  id            String           @id @default(cuid())
  studentId     String
  student       Student          @relation(fields: [studentId], references: [id])
  amountCHF     Float
  duration      Int              // 1 or 6
  billingMethod String           // "invoice" | "direct"
  startMonth    Int
  startYear     Int
  active        Boolean          @default(true)
  charges       PlatformCharge[]
  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt
}

model PlatformCharge {
  id             String               @id @default(cuid())
  subscriptionId String
  subscription   PlatformSubscription @relation(fields: [subscriptionId], references: [id])
  month          Int
  year           Int
  amountCHF      Float
  paidAt         DateTime?
  createdAt      DateTime             @default(now())

  @@unique([subscriptionId, month, year])  // prevents duplicate charges
}
```

`Student` needs two relation fields added:

```prisma
// Add to model Student:
subscriptions  PlatformSubscription[]
```

Key decisions reflected here:
- `@@unique([subscriptionId, month, year])` on `PlatformCharge` makes `createMany({ skipDuplicates: true })` safe to call repeatedly (idempotent charge generation).
- `billingMethod` stored as `String` rather than a Prisma enum — avoids a migration step if the set of methods ever changes, and the two values ("invoice" / "direct") are validated in TypeScript.
- `active Boolean` on `PlatformSubscription` supports early deactivation (SUB-03) without deleting the record or its charge history.
- `amountCHF` is on both `PlatformSubscription` (the agreed fee) and `PlatformCharge` (the actual charge amount at time of generation) — this allows the subscription amount to be edited without retroactively changing past charges.

## Version Compatibility

| Package | Version | Relevant to New Features |
|---------|---------|--------------------------|
| `@prisma/client` | ^5.22.0 | `createMany` with `skipDuplicates`, `groupBy` with `_sum` — both available since Prisma 4; no version concern |
| `next` | 14.2.35 | Server Actions are stable in Next.js 14; no version concern |
| `@react-pdf/renderer` | ^4.5.1 | Adding a platform line item is purely a layout change inside the existing template; no version concern |

## Sources

- `prisma/schema.prisma` (project file) — existing model patterns (month/year as Int, cuid IDs, relation structure)
- `package.json` (project file) — confirmed installed versions of all dependencies
- Prisma 5 documentation (training data, HIGH confidence) — `createMany` with `skipDuplicates`, `groupBy` with `_sum` aggregation, `prisma migrate dev` additive migration behaviour
- Next.js 14 App Router documentation (training data, HIGH confidence) — Server Actions for mutations, no additional packages needed for form handling

---
*Stack research for: Mathetogo platform subscription revenue tracking (v1.1)*
*Researched: 2026-04-22*
