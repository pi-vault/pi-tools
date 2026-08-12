# Pi Tools Architecture Deepening Design

## Status

Approved design for a phased implementation plan. The work covers all five candidates from the whole-repository architecture review, ordered from simplest to most complex. Each phase is independently mergeable, has a usable result, preserves unrelated public behavior, and leaves the full test suite passing.

## Objective

Improve the highest-leverage seams in `@pi-vault/pi-tools` without turning the review into a broad rewrite. The implementation will concentrate policy, remove duplicated provider knowledge, and make runtime behavior observable through stable interfaces.

The work will use existing TypeScript types, native `fetch`, the current provider registry, and Vitest. It will not add dependencies or split modules solely because they are long.

## Current friction

The review found five related opportunities:

1. `SearchProvider` accepts domain and date filters even though several adapters ignore them silently.
2. Provider identity is repeated across provider metadata, configuration defaults, environment mappings, and dashboard discovery.
3. Provider selection, fallback/fusion execution, budget reservation, activity logging, and outcome recording have different paths for different capabilities.
4. `ConfigManager` refreshes provider instances during a session while optional tool registration, guidance, and combine settings are captured at session start.
5. Content extraction calls Jina and Gemini fallbacks directly while `web_fetch` has a separate registered-provider fallback; Jina has duplicate implementations.

The deletion test rules out splitting `src/extract/pipeline.ts` merely because it is 548 lines: its small interface hides substantial routing, validation, and fallback behavior. The improvement belongs at the external adapter seam, not in arbitrary file subdivision.

## Target architecture

The intended dependency direction is:

```text
config
  ↓
provider catalog
  ↓
provider registry
  ↓
provider operation policy
  ↓
search / fetch / docs / research tools

web_fetch
  ↓
content extraction module
  ↓
ordered extraction adapters
  ↓
provider operation policy
```

The provider catalog owns built-in provider facts. User configuration remains the override implementation. The provider registry continues to own budget reservation and registered adapters. The provider operation policy owns capability-aware selection and execution behavior. The extraction module remains deep: it owns routing order, validation, and result shaping while external extraction adapters cross one explicit seam.

## Locked design decisions

- Five phases are required; none may be skipped because a later phase appears more valuable.
- Phase order is dependency-first and simplest-to-most-complex:
  1. search filter semantics;
  2. provider catalog;
  3. provider operation policy;
  4. configuration/tool lifecycle;
  5. content extraction seam.
- Every phase is independently mergeable and rollbackable.
- Every phase has a focused test gate and runs the full existing test suite before completion.
- Phase 1 does not change provider ordering or selection strategy.
- Phase 2 keeps user overrides in configuration and moves only built-in provider facts into the catalog.
- Phase 3 preserves current tier ordering for `auto`; `best-performing` becomes capability-aware. Budget reservation still happens before provider delegation.
- Phase 4 aligns tool availability and guidance with current session state without assuming that the host can unregister a tool dynamically.
- Phase 5 preserves the existing extraction order and Gemini fallback behavior while giving external adapters one seam and removing duplicate Jina behavior.
- No new dependency, SDK, generic framework, or speculative abstraction is part of the work.

## Phase contracts

### Phase 1 — explicit search filter semantics

Usable result: a caller can determine whether requested domain/date filters are enforced. Each adapter either honors the filter, uses a safe central post-filter, or reports the unsupported condition explicitly. Silent filter loss is removed. Existing provider ordering and fallback behavior stay unchanged.

### Phase 2 — single provider catalog

Usable result: adding a provider’s identity no longer requires editing several independent metadata lists. The catalog supplies identity, tier, credential mapping, and built-in defaults to configuration, registration, and the dashboard. Project and global user overrides remain authoritative.

### Phase 3 — capability-aware provider operation policy

Usable result: all capabilities use one coherent selection and execution policy. Search keeps tier ordering under `auto`; other capabilities no longer accidentally rely on registration order when the selected strategy requires more. Fallback and fusion share activity and outcome recording, and fetch outcomes can feed performance metrics.

### Phase 4 — aligned configuration and tool lifecycle

Usable result: a refreshed configuration has one runtime source of truth. Provider availability, guidance, combine settings, and optional docs/research tool behavior no longer depend on stale session-start snapshots. The implementation remains compatible with a host that only supports registration at session initialization.

### Phase 5 — single content extraction seam

Usable result: `web_fetch` still follows its established extraction order, but Jina, Gemini, and registered fetch adapters are selected through one explicit extraction policy. Jina transport and result shaping have one implementation. External fallback behavior is covered through the seam rather than through duplicated direct calls.

## Data flow and error rules

- Configuration errors retain the current safe behavior: malformed non-strict configuration falls back where it currently does; strict refresh keeps the prior usable configuration when refresh fails.
- Budget errors remain `BudgetExceededError` and are not recorded as provider failures.
- Provider failures continue through `AggregateProviderError` and existing fallback semantics.
- Unsupported search filters must be explicit and must not silently claim a constrained result set.
- Runtime refresh must not make an already running tool use a partially updated configuration.
- Extraction must preserve SSRF validation, binary/size checks, redirect validation, cancellation, and existing `RetryableExtractionError` behavior.
- No phase may weaken trust gating, credential handling, or error sanitization.

## Testing strategy

Each phase plan will use the existing test style and add the smallest regression surface that proves its seam:

- contract tests for filter support and unsupported behavior;
- catalog/config/registry integration tests for a provider’s single source of identity;
- selection, fallback, fusion, budget, activity, and metrics tests through the operation seam;
- post-refresh runtime tests for tool availability and current guidance/configuration;
- extraction routing, Jina deduplication, Gemini fallback, cancellation, and SSRF regression tests through the extraction seam.

The baseline command is `pnpm check`. The current repository passes 87 test files and 1,410 tests, with pre-existing lint warnings and a Node engine warning because the environment is Node 23.11.0 while the package declares Node >=24.15.0. The plan will not include unrelated lint cleanup or an engine change.

## Planned documents

After this spec is reviewed, the implementation plan will be split into one main plan and five phase plans:

- `docs/superpowers/plans/2026-08-12-architecture-deepening.md`
- `docs/superpowers/plans/2026-08-12-architecture-deepening-phase-1-filters.md`
- `docs/superpowers/plans/2026-08-12-architecture-deepening-phase-2-catalog.md`
- `docs/superpowers/plans/2026-08-12-architecture-deepening-phase-3-operation-policy.md`
- `docs/superpowers/plans/2026-08-12-architecture-deepening-phase-4-runtime-lifecycle.md`
- `docs/superpowers/plans/2026-08-12-architecture-deepening-phase-5-extraction-seam.md`

The main plan will define cross-phase invariants, sequencing, rollout, rollback, and verification. Each phase plan will define its file map, atomic result, implementation tasks, tests, error rules, and completion gate.
