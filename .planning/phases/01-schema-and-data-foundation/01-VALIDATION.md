---
phase: 1
slug: schema-and-data-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-22
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (Wave 0 installs) |
| **Config file** | vitest.config.ts — Wave 0 creates |
| **Quick run command** | `npx vitest run lib/platform-charges.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run lib/platform-charges.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 0 | SUB-04 | unit stub | `npx vitest run lib/platform-charges.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | SUB-04 | migration | `npx prisma migrate status` | ✅ | ⬜ pending |
| 1-01-03 | 01 | 1 | SUB-04 | unit | `npx vitest run lib/platform-charges.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-04 | 01 | 1 | SUB-04 | unit | `npx vitest run lib/platform-charges.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `lib/platform-charges.test.ts` — stubs for SUB-04 (`addMonths` year-wrap, `ensureChargeForMonth` idempotency)
- [ ] `vitest.config.ts` — basic config pointing at lib/
- [ ] `npm install -D vitest` — no test runner exists in project

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Migration runs on Supabase without touching existing tables | SUB-04 | Requires live DB connection with DIRECT_URL | Run `npx prisma migrate deploy`, confirm `Student`/`Session`/`Invoice` row counts unchanged |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
