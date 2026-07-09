# Multi-Provider Fusion (RRF) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Reciprocal Rank Fusion to merge search results from multiple providers in parallel, improving result quality and diversity.

**Architecture:** New `src/providers/fusion.ts` with pure RRF algorithm + orchestration. Config gets a `combine: CombineConfig` field. Registry gets `selectSearchForFusion()`. web_search tool branches between fallback (existing) and fusion (new) based on config/param. Existing fallback path untouched.

**Tech Stack:** TypeScript, Vitest, @sinclair/typebox (for tool params)

**Spec:** `docs/superpowers/specs/2026-07-08-multi-provider-fusion-rrf-design.md`

---

## Phases

This plan is split into 4 atomic phases, ordered simplest to most complex. Each phase produces a commit-able, testable result.

| Phase | What                                       | Depends On                 | Files                                                       |
| ----- | ------------------------------------------ | -------------------------- | ----------------------------------------------------------- |
| 1     | Pure RRF function                          | Nothing                    | `src/providers/fusion.ts`, `tests/providers/fusion.test.ts` |
| 2     | Fusion orchestration (`executeWithFusion`) | Phase 1                    | Same files (additions)                                      |
| 3     | Config schema + Registry methods           | Nothing (extends existing) | `src/config.ts`, `src/providers/registry.ts`, tests         |
| 4     | web_search integration + wiring            | Phases 1-3                 | `src/tools/web-search.ts`, `src/index.ts`, tests            |

**Phase plan files:**

- `docs/superpowers/plans/2026-07-08-fusion-phase-1-rrf-algorithm.md`
- `docs/superpowers/plans/2026-07-08-fusion-phase-2-orchestration.md`
- `docs/superpowers/plans/2026-07-08-fusion-phase-3-config-registry.md`
- `docs/superpowers/plans/2026-07-08-fusion-phase-4-tool-wiring.md`

---

## File Map

### New files

| File                             | Responsibility                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------- |
| `src/providers/fusion.ts`        | Pure RRF algorithm (`reciprocalRankFusion`) + orchestration (`executeWithFusion`) |
| `tests/providers/fusion.test.ts` | All fusion unit tests (RRF + orchestration)                                       |

### Modified files

| File                               | Changes                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/config.ts`                    | Add `CombineConfig` interface, add `combine` field to `PiToolsConfig`, add defaults         |
| `src/providers/registry.ts`        | Add `selectSearchForFusion()` and `selectSearchByPerformanceAll()`                          |
| `src/tools/web-search.ts`          | Add `combine` param, add fusion execution branch, update output formatting and details type |
| `src/index.ts`                     | Update `resolveCandidates` to accept combine flag, pass `combineConfig` to tool factory     |
| `tests/providers/registry.test.ts` | Tests for new registry methods                                                              |
| `tests/tools/web-search.test.ts`   | Tests for fusion path in web_search tool                                                    |
| `tests/config.test.ts`             | Test `CombineConfig` loading and defaults                                                   |

---

## Verification

After all phases complete:

```bash
pnpm check   # lint + typecheck + all tests
```

Expected: All pass, zero regressions. Existing tests unchanged.
