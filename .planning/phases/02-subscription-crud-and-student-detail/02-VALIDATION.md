---
phase: 2
slug: subscription-crud-and-student-detail
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-22
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run lib/subscription-utils.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run lib/subscription-utils.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 0 | SUB-01 | unit | `npx vitest run lib/subscription-utils.test.ts` | ❌ W0 | ⬜ pending |
| 2-02-01 | 02 | 1 | SUB-01 | integration | `npx vitest run` | ✅ | ⬜ pending |
| 2-02-02 | 02 | 1 | SUB-02 | integration | `npx vitest run` | ✅ | ⬜ pending |
| 2-02-03 | 02 | 1 | SUB-03 | integration | `npx vitest run` | ✅ | ⬜ pending |
| 2-03-01 | 03 | 2 | SUB-05 | manual | browser check | — | ⬜ pending |
| 2-03-02 | 03 | 2 | SUB-05 | manual | browser check | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `lib/subscription-utils.test.ts` — stubs for SUB-01, SUB-02, SUB-03, SUB-05 utility functions
- [ ] `lib/subscription-utils.ts` — stub file (so imports resolve)

*Framework (vitest) already installed from Phase 1.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Student detail page renders subscription section | SUB-05 | UI rendering requires browser | Open student detail page, verify subscription section visible |
| Add subscription form submits and updates UI | SUB-01 | End-to-end form interaction | Fill add-subscription form, submit, verify subscription appears |
| Edit subscription inline form | SUB-02 | UI interaction | Click edit, change amount, save, verify charge count unchanged |
| Deactivate subscription | SUB-03 | UI + state check | Click deactivate, confirm, verify subscription shows inactive |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
