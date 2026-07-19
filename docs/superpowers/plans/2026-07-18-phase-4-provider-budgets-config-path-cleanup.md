# Provider Budgets and Config Path Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace inaccurate `monthlyQuota` accounting with enforceable, operation-aware provider budgets for all registered capabilities and resolve global configuration through Pi’s agent directory.

**Architecture:** `DEFAULT_CONFIG` owns the normalized budget policy. `ConfigManager` registers each provider once with a `ProviderRegistry`; the registry wraps search, fetch, code-search, docs, and direct Exa research calls. A versioned UTC ledger reserves deterministic costs before calls, preserves compatible usage across reloads, and leaves variable or plan-dependent providers managed.

**Tech Stack:** TypeScript, Node.js standard library, Vitest, Biome, Pi Coding Agent provider interfaces.

---

## File map

- Modify `src/config.ts`: budget types/defaults, atomic provider-budget merging, validation, and `getAgentDir()` config path.
- Modify `src/providers/types.ts`, `src/providers/http-providers.ts`, and provider metadata modules: replace `monthlyQuota` with operation cost callbacks.
- Modify `src/providers/registry.ts`: v2 persistence, migration, reservations, wrappers, status, selection, and budget errors.
- Modify `src/config-manager.ts`, `src/index.ts`, `src/tools/web-research.ts`, `src/commands/tools.ts`, `src/providers/execute.ts`, and `src/providers/fusion.ts`: registration, research metering, status output, and budget-aware fallback.
- Update focused tests under `tests/config*`, `tests/providers/*`, `tests/index-research.test.ts`, `tests/commands/*`, plus `README.md` and `CHANGELOG.md`.

## Default policy

Use these exact defaults. Existing `enabled` values remain unchanged.

| Provider(s)                                                                                  | Budget                          | Cost                                                              |
| -------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------- |
| `brave`, `brave-llm`                                                                         | hard, 5 USD/month, pool `brave` | 0.005/search                                                      |
| `exa`                                                                                        | hard, 10 USD/month, pool `exa`  | Search/code `0.007 + 0.001 × max(0, results - 10)`; fetch `0.001` |
| `tavily`                                                                                     | hard, 1,000 credits/month       | 1/search or fetch                                                 |
| `firecrawl`                                                                                  | hard, 1,000 credits/month       | Search `2 × ceil(results / 10)`; fetch `1`                        |
| `serper`                                                                                     | hard, 2,500 requests/lifetime   | 1                                                                 |
| `websearchapi`                                                                               | hard, 2,000 credits/month       | 1                                                                 |
| `context7`                                                                                   | hard, 1,000 requests/month      | 1/docs call                                                       |
| `fastcrw`                                                                                    | hard, 500 credits/lifetime      | 1                                                                 |
| `langsearch`                                                                                 | hard, 1,000 requests/day        | 1                                                                 |
| `linkup`                                                                                     | hard, 20 USD/month              | 0.005 standard; 0.05 deep                                         |
| `youcom`                                                                                     | hard, 100 USD/lifetime          | 0.005/search                                                      |
| `duckduckgo`, `ollama`, `searxng`                                                            | unlimited                       | —                                                                 |
| `jina`, `marginalia`, `openai-codex`, `openai-web-search`, `parallel`, `perplexity`, `sofya` | managed                         | —                                                                 |

These are local UTC calendar safety budgets, not vendor invoice mirrors. Pricing sources: [Brave](https://brave.com/search/api/), [Exa](https://exa.ai/pricing?tab=api), [Firecrawl](https://www.firecrawl.dev/pricing), [Tavily](https://docs.tavily.com/documentation/api-credits), [Linkup](https://docs.linkup.so/pages/documentation/platform/pricing), [Context7](https://context7.com/plans), [Serper](https://serper.dev/), [fastCRW](https://fastcrw.com/pricing), [LangSearch](https://docs.langsearch.com/limits/api-limits), [WebSearchAPI](https://websearchapi.ai/pricing), and [You.com](https://you.com/docs/administration/billing). Parallel remains managed because current pricing does not establish the draft’s fixed monthly allowance.

## Task 1: Add budget contracts and clean config paths

**Files:** `src/config.ts`; `tests/config.test.ts`; `tests/utils/deep-merge.test.ts`; `tests/config-trust.test.ts`.

- [ ] Write failing tests for all 22 provider entries, the budget union below, invalid overrides, ignored `monthlyQuota`, atomic mode replacement, and `getAgentDir()`-based reads/writes.

```ts
type BudgetPeriod = "day" | "month" | "lifetime";
type BudgetUnit = "request" | "credit" | "usd";
type ProviderBudget =
  | {
      mode: "hard";
      limit: number;
      period: BudgetPeriod;
      unit: BudgetUnit;
      pool?: string;
    }
  | { mode: "managed" }
  | { mode: "unlimited" };
```

- [ ] Run `pnpm exec vitest run tests/config.test.ts tests/utils/deep-merge.test.ts tests/config-trust.test.ts`; verify failures mention missing budgets/path behavior.
- [ ] Add all defaults from the policy table and `budget: ProviderBudget` to `ProviderConfigEntry`; remove `monthlyQuota`.
- [ ] Implement layer-aware provider merging: replace a complete `budget` object instead of deep-merging it; invalid higher-layer values warn once and retain the lower-layer value. Reject non-finite/non-positive limits, unknown period/unit values, and empty pool names. Restore conflicting same-pool overrides as a group.
- [ ] Replace `os.homedir()` with `path.join(getAgentDir(), "extensions", "tools.json")`; ensure `loadConfig`, `loadMergedConfig`, and `updateConfig` all use it.
- [ ] Run the focused tests and commit `refactor: replace provider monthly quotas with budgets`.

## Task 2: Replace metadata quotas with operation costs

**Files:** `src/providers/types.ts`; `src/providers/http-providers.ts`; provider metadata modules; `tests/providers/all.test.ts`; `tests/providers/http-providers.test.ts`; `tests/providers/types.test.ts`.

- [ ] Write failing tests asserting no `ProviderMeta.monthlyQuota` remains and the cost formulas in the policy table are exact.
- [ ] Define:

```ts
type ProviderOperation =
  | { capability: "search"; maxResults: number }
  | { capability: "fetch" }
  | { capability: "code-search"; maxResults: number }
  | { capability: "docs-search" }
  | { capability: "docs-fetch" }
  | {
      capability: "research";
      type: ExaDeepType;
      maxResults: number;
      contentTypes: number;
    };

type UsageCost = (
  operation: ProviderOperation,
  config: ProviderConfigEntry,
) => number;
```

- [ ] Add `usageCost` callbacks only where cost is not one unit; return finite positive values and use cost `1` otherwise.
- [ ] Run `pnpm exec vitest run tests/providers/all.test.ts tests/providers/http-providers.test.ts tests/providers/types.test.ts`; commit `refactor: define provider operation costs`.

## Task 3: Implement v2 persistence and reservations

**Files:** `src/providers/registry.ts`; `tests/providers/persistence.test.ts`; `tests/providers/registry.test.ts`.

- [ ] Write failing tests for this persistence shape and UTC keys:

```ts
interface UsageFileV2 {
  version: 2;
  counters: Record<
    string,
    {
      used: number;
      unit: BudgetUnit;
      period: BudgetPeriod;
      periodKey: string;
    }
  >;
}
```

- [ ] Run `pnpm exec vitest run tests/providers/persistence.test.ts tests/providers/registry.test.ts`; verify failures.
- [ ] Make the adapter load malformed/unknown data as an empty v2 state while retaining legacy records in memory until policies are registered.
- [ ] Implement UTC period helpers, unit/period mismatch resets, six-decimal rounding, synchronous persistence, and compatible legacy migration only for current-month, non-shared, monthly request budgets.
- [ ] Implement `consume(providerName, operation)`: resolve pool, calculate/validate cost, reject `used + cost > limit`, reserve and save before delegation, and throw a typed `BudgetExceededError` without changing managed/unlimited state.
- [ ] Add `getBudgetStatus(name)` and preserve counters when `unregisterAll(name)` is called. Warn once at 80% and exhaustion per provider/pool/period.
- [ ] Run the focused tests and commit `feat: persist enforceable provider budgets`.

## Task 4: Register and meter every capability

**Files:** `src/providers/registry.ts`; `src/config-manager.ts`; `src/providers/execute.ts`; `src/providers/fusion.ts`; `src/index.ts`; `tests/config-manager.test.ts`; `tests/providers/registry.test.ts`; `tests/index.test.ts`.

- [ ] Write failing tests registering fake search, fetch, code-search, and docs providers with a one-unit hard budget; verify the second delegate call is blocked and `recordOutcome()` changes metrics without usage increments.
- [ ] Replace per-capability registration with:

```ts
registerProvider(
  instances: { search?: SearchProvider; fetch?: FetchProvider; codeSearch?: CodeSearchProvider; docs?: DocsProvider },
  options: { name: string; tier: ProviderTier; budget: ProviderBudget; config: ProviderConfigEntry; usageCost?: UsageCost },
): void;
```

- [ ] Wrap all capability methods immediately before delegation; register docs by provider name; keep counters across unregister/re-register.
- [ ] Extend `diffConfig()` to detect structural provider-entry changes plus resolved-key changes, while retaining the previous config when reload parsing fails.
- [ ] Remove cross-unit remaining-budget sorting. Automatic selection excludes exhausted hard policies but preserves tier/order; explicit selection returns the provider and lets its wrapper reject insufficient cost.
- [ ] Thread `BudgetExceededError` through fallback/fusion so budget rejection can try another automatic candidate without recording a performance failure.
- [ ] Run `pnpm exec vitest run tests/providers/registry.test.ts tests/config-manager.test.ts tests/index.test.ts`; commit `feat: meter every provider capability`.

## Task 5: Meter Exa research and enforce input limits

**Files:** `src/tools/web-research.ts`; `src/index.ts`; `src/research/prepare.ts`; `src/research/types.ts`; `tests/index-research.test.ts`; `tests/tools/web-research.test.ts`.

- [ ] Write failing tests for one reservation per unique query, exact research operation metadata, rejection before `deepResearch()`, disabled Exa registration, valid Exa types, and `numResults` range 1–100.
- [ ] Extend `createWebResearchTool` with `beforeResearch(operation)` and invoke it immediately before each unique client call.
- [ ] Pass `(operation) => registry.consume("exa", operation)` from `src/index.ts`, only register when Exa is enabled, keyed, and deep research is enabled.
- [ ] Compute `contentTypes` as text + highlights + optional summary; reduce full-mode default results from 150 to 100.
- [ ] Run `pnpm exec vitest run tests/index-research.test.ts tests/tools/web-research.test.ts tests/providers/registry.test.ts`; commit `feat: meter Exa deep research usage`.

## Task 6: Update status, documentation, and verify

**Files:** `src/commands/tools.ts`; `tests/commands/tools.test.ts`; `tests/commands/tools-subcommands.test.ts`; `README.md`; `CHANGELOG.md`.

- [ ] Write failing status tests for hard, managed, unlimited, shared-pool, and docs-only providers.
- [ ] Render `Used`, `Limit`, `Unit`, and `Period` from `getBudgetStatus()` while retaining tier, session outcome, and latency columns. Display managed/unlimited text and six-decimal monetary values.
- [ ] Document `budget` overrides, shared-pool requirements, managed/unlimited modes, UTC periods, `PI_CODING_AGENT_DIR`, v2 migration, and the process-local concurrency limitation. State that `monthlyQuota` is not migrated.
- [ ] Run `pnpm exec vitest run tests/commands/tools.test.ts tests/commands/tools-subcommands.test.ts`; commit `docs: expose provider budget status and configuration`.
- [ ] Run the complete verification:

```bash
pnpm check
pnpm run pack:dry-run
git diff --check "$(git merge-base HEAD origin/master)"..HEAD
git status --short
```

Expected: all tests pass, package dry-run succeeds, no whitespace errors, and only planned files remain changed.

## Assumptions

- Budgets are conservative local reservations; failed attempts remain charged locally.
- `day` and `month` mean UTC calendar periods, not vendor billing anniversaries.
- Enforcement is atomic within one Pi process. Concurrent processes may briefly overrun a shared ceiling; add interprocess locking only if observed as a requirement.
- No new dependency or provider-telemetry subsystem is needed.
