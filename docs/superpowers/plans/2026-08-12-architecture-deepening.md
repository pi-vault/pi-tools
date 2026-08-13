# Pi Tools Architecture Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen all five reviewed architectural seams in `@pi-vault/pi-tools` through independently mergeable phases ordered from simplest to most complex.

**Architecture:** Keep `src/extract/pipeline.ts` as the deep content-extraction module, but make its external fallback adapters explicit. Make provider metadata the catalog consumed by configuration, registration, and the dashboard. Concentrate capability selection, fallback/fusion execution, budgets, activity, and outcome recording behind the existing registry/execution seams, then align those seams with a refreshable session runtime.

**Tech Stack:** TypeScript, Node native `fetch`, Pi extension APIs, TypeBox, Vitest, Biome, pnpm.

---

## Execution order

Implement and merge these phase plans in order:

1. [Phase 1 — explicit search filter semantics](2026-08-12-architecture-deepening-phase-1-filters.md)
2. [Phase 2 — single provider catalog](2026-08-12-architecture-deepening-phase-2-catalog.md)
3. [Phase 3 — capability-aware provider operation policy](2026-08-12-architecture-deepening-phase-3-operation-policy.md)
4. [Phase 4 — aligned configuration and tool lifecycle](2026-08-12-architecture-deepening-phase-4-runtime-lifecycle.md)
5. [Phase 5 — single content extraction seam](2026-08-12-architecture-deepening-phase-5-extraction-seam.md)

Each phase must be a separate mergeable change. A phase is complete only when its focused tests and `pnpm check` pass. Do not combine phase commits to hide a failing intermediate state.

## Cross-phase invariants

Keep these behaviors unchanged unless the phase plan explicitly names the change:

- SSRF validation still runs before direct external HTTP fetches, every redirect hop is validated, and trust gating still strips sensitive project configuration.
- Hard-budget usage is reserved and persisted before provider delegation. A failed persistence write rolls usage back. `BudgetExceededError` is not a provider failure.
- Provider errors still use the existing fallback and `AggregateProviderError` semantics.
- Tool result error sanitization remains in place.
- `web_fetch` still supports one URL, multiple URLs, raw mode, PDFs, GitHub URLs, YouTube, local video, cache, session content storage, and `web_read` retrieval.
- No new package or SDK is added. Use existing TypeScript, native `fetch`, and test helpers.
- Do not split a file solely because it is long. A new file is justified only when it owns a concrete interface at a seam.
- Do not change the Node engine declaration or clean unrelated Biome warnings.

## Baseline and verification

Before each phase, run:

```bash
pnpm check
```

Expected baseline in the current environment:

- 87 test files pass.
- 1,410 tests pass.
- Biome reports pre-existing warnings.
- pnpm reports the environment is Node 23.11.0 while `package.json` declares Node `>=24.15.0`.

The implementation environment should use Node `>=24.15.0` when available. If the environment remains on Node 23, record the engine warning but do not change the project requirement as part of this work.

At every phase gate run the focused command listed in that phase plan, then:

```bash
pnpm check
git diff --check
git status --short
```

`git status --short` must contain only intended phase files before committing.

## Rollout and rollback

Use one branch or worktree per phase. Merge only after the phase gate passes. If a phase must be reverted, revert its phase commit as a whole; do not manually undo only half of a seam change. The previous phase must continue to compile and pass its tests after a later phase is reverted.

## Phase contracts

### Phase 1 result

Requested search domain/date filters are either enforced natively, applied through a safe local domain post-filter, or rejected with an explicit unsupported-filter error. A provider that silently ignores a requested filter is no longer eligible for that filtered call. Provider ordering is unchanged for unfiltered calls.

### Phase 2 result

Provider identity facts, fallback environment names, and built-in provider defaults have one catalog source. `config.ts`, `ConfigManager`, `allProviders`, and the dashboard consume that catalog. User config remains the higher-priority override.

### Phase 3 result

Search, fetch, code-search, docs, and research use coherent capability-aware selection/execution rules. Search `auto` retains tier ordering. Performance selection can be applied to every capability that has metrics. Fallback and fusion share activity and outcome recording.

### Phase 4 result

The session has one refreshable runtime source. Provider refresh and tool definitions use the same current config. Optional docs/research definitions are registered at session start so later key/config changes are usable; their execution checks current availability. Changed guidance is re-registered through Pi’s name-replacing `registerTool` path.

### Phase 5 result

`web_fetch` passes registered fetch adapters into one extraction fallback seam. The extraction order remains direct HTTP/structured extraction, registered fetch adapters, Gemini fallbacks, and raw text. The duplicate direct Jina implementation is removed; Jina transport is owned by the provider adapter.

## Completion checklist

- [ ] Phase 1 merged and its focused filter tests pass.
- [ ] Phase 2 merged and catalog/config/registration tests pass.
- [ ] Phase 3 merged and provider policy tests pass.
- [ ] Phase 4 merged and runtime refresh/tool registration tests pass.
- [ ] Phase 5 merged and extraction/fallback/SSRF tests pass.
- [ ] Final `pnpm check` passes with only documented pre-existing warnings.
- [ ] README or changelog updates are made only where a user-visible behavior or configuration contract changed; no architecture essay is added.
