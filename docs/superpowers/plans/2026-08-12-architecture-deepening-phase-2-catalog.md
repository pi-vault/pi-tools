# Pi Tools Phase 2: Single Provider Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give provider identity, built-in defaults, and fallback environment names one source of truth.

**Architecture:** Add a provider catalog beside the provider adapters. Each catalog entry owns a `ProviderMeta`, its default `ProviderConfigEntry`, and its fallback environment variable when one exists. `config.ts`, `ConfigManager`, the provider barrel, and the `/tools` dashboard consume catalog projections. Gemini remains a non-provider service entry in the same catalog module so its existing fallback environment mapping stays centralized without pretending Gemini is a registry provider.

**Tech Stack:** TypeScript, existing provider metadata factories, existing config merge/validation, Vitest.

---

## Atomic result

After this phase, adding or removing a built-in provider requires changing one catalog entry and its adapter import. The catalog’s provider-name set, default-config set, and fallback-env set are checked against one another. Existing `allProviders`/dashboard order and config/registration order remain unchanged. User configuration still overrides catalog defaults through the existing merge path, and provider registration still skips disabled, unkeyed, or failing providers exactly as before.

## File map

Create:

- `src/providers/catalog.ts` — provider catalog entries plus derived provider/default/fallback projections.
- `tests/providers/catalog.test.ts` — catalog consistency and projection tests.

Modify:

- `src/providers/all.ts` — re-export catalog projections for compatibility.
- `src/config.ts` — consume catalog defaults and fallback environment values; remove duplicate provider maps.
- `src/config-manager.ts` — receive the catalog’s provider metadata projection.
- `src/index.ts` — use catalog metadata for registration and `/tools` display.
- `src/providers/searxng.ts` — use the resolved key injected by `ConfigManager`, removing the config-to-provider value import.
- `tests/config.test.ts` — preserve fallback/default behavior while importing the catalog-backed export.
- `tests/config-manager.test.ts` — use catalog-shaped provider fixtures and verify the injected key path.
- `tests/providers/all.test.ts` — assert the compatibility barrel and catalog contain the same provider set.
- `tests/providers/searxng.test.ts` — pass the resolved key through the provider factory after the config runtime import is removed.

Do not modify provider request behavior, budgets, selection order, or user-config validation in this phase.

## Tasks

### Task 1: Define the catalog and its consistency tests

**Files:**

- Create: `src/providers/catalog.ts`
- Create: `tests/providers/catalog.test.ts`
- Modify: `src/providers/all.ts`

- [ ] **Step 1: Define the catalog entry shape.**

Add these types and imports in `src/providers/catalog.ts`:

```ts
import type { ProviderConfigEntry } from "../config.ts";
import type { ProviderMeta } from "./types.ts";

export interface ProviderCatalogEntry {
  readonly meta: ProviderMeta;
  readonly defaultConfig: ProviderConfigEntry;
  readonly fallbackEnv?: string;
}
```

Use a type-only import for config types. This keeps the catalog from importing config runtime code while `config.ts` imports catalog values.

- [ ] **Step 2: Move the provider facts into one ordered catalog.**

Move the provider imports currently assembled in `src/providers/all.ts` into `src/providers/catalog.ts`. Keep the existing `providerMetas` order for the `allProviders`/dashboard projection, and keep the catalog literal in the existing `DEFAULT_CONFIG.providers` order for config object insertion and `ConfigManager.registerFromConfig` registration order. These are two existing order contracts; do not make one projection silently reorder the other. Resolve imported metadata by name, then define one catalog literal containing each provider’s default config and fallback environment. This keeps identity, defaults, and fallback facts in one entry instead of three parallel maps.

Define the metadata array first, using the current `all.ts` order:

```ts
const providerMetas: readonly ProviderMeta[] = [
  ...httpProviders,
  context7,
  duckduckgo,
  exa,
  firecrawl,
  jina,
  ollama,
  openaiCodex,
  openaiWebSearch,
  parallel,
  searxng,
  serper,
  sofya,
  tavily,
  tinyfish,
];
```

The `providerCatalog` literal below must retain the current `DEFAULT_CONFIG.providers` order shown in the existing `src/config.ts`: `brave`, `brave-llm`, `context7`, `duckduckgo`, `exa`, `fastcrw`, `firecrawl`, `jina`, `langsearch`, `linkup`, `marginalia`, `ollama`, `openai-codex`, `openai-web-search`, `parallel`, `perplexity`, `searxng`, `serper`, `sofya`, `tavily`, `tinyfish`, `websearchapi`, `youcom`. The `allProviders` projection must instead follow the current `all.ts` order: `brave`, `brave-llm`, `fastcrw`, `langsearch`, `linkup`, `marginalia`, `perplexity`, `websearchapi`, `youcom`, `context7`, `duckduckgo`, `exa`, `firecrawl`, `jina`, `ollama`, `openai-codex`, `openai-web-search`, `parallel`, `searxng`, `serper`, `sofya`, `tavily`, `tinyfish`.

Then use a lookup helper that fails at module load if an adapter import and catalog entry diverge:

```ts
const providerMetaByName = new Map(
  providerMetas.map((meta) => [meta.name, meta] as const),
);

function catalogEntry(
  name: string,
  defaultConfig: ProviderConfigEntry,
  fallbackEnv?: string,
): ProviderCatalogEntry {
  const meta = providerMetaByName.get(name);
  if (!meta) throw new Error(`Missing provider metadata for ${name}`);
  return { meta, defaultConfig, fallbackEnv };
}
```

The implementation must contain all 23 current provider defaults, including disabled and local/unlimited providers, with these exact values:

```ts
const providerCatalog: readonly ProviderCatalogEntry[] = [
  catalogEntry(
    "brave",
    {
      enabled: true,
      budget: {
        mode: "hard",
        limit: 5,
        period: "month",
        unit: "usd",
        pool: "brave",
      },
      apiKey: "BRAVE_API_KEY",
    },
    "BRAVE_API_KEY",
  ),
  catalogEntry(
    "brave-llm",
    {
      enabled: true,
      budget: {
        mode: "hard",
        limit: 5,
        period: "month",
        unit: "usd",
        pool: "brave",
      },
      apiKey: "BRAVE_API_KEY",
    },
    "BRAVE_API_KEY",
  ),
  catalogEntry(
    "context7",
    {
      enabled: true,
      budget: { mode: "hard", limit: 1000, period: "month", unit: "request" },
      apiKey: "CONTEXT7_API_KEY",
    },
    "CONTEXT7_API_KEY",
  ),
  catalogEntry("duckduckgo", { enabled: true, budget: { mode: "unlimited" } }),
  catalogEntry(
    "exa",
    {
      enabled: true,
      budget: {
        mode: "hard",
        limit: 10,
        period: "month",
        unit: "usd",
        pool: "exa",
      },
      apiKey: "EXA_API_KEY",
    },
    "EXA_API_KEY",
  ),
  catalogEntry(
    "fastcrw",
    {
      enabled: false,
      budget: { mode: "hard", limit: 500, period: "lifetime", unit: "credit" },
      apiKey: "FASTCRW_API_KEY",
    },
    "FASTCRW_API_KEY",
  ),
  catalogEntry(
    "firecrawl",
    {
      enabled: true,
      budget: { mode: "hard", limit: 1000, period: "month", unit: "credit" },
      apiKey: "FIRECRAWL_API_KEY",
    },
    "FIRECRAWL_API_KEY",
  ),
  catalogEntry(
    "jina",
    { enabled: true, budget: { mode: "managed" } },
    "JINA_API_KEY",
  ),
  catalogEntry(
    "langsearch",
    {
      enabled: false,
      budget: { mode: "hard", limit: 1000, period: "day", unit: "request" },
      apiKey: "LANGSEARCH_API_KEY",
    },
    "LANGSEARCH_API_KEY",
  ),
  catalogEntry(
    "linkup",
    {
      enabled: false,
      budget: { mode: "hard", limit: 20, period: "month", unit: "usd" },
      apiKey: "LINKUP_API_KEY",
    },
    "LINKUP_API_KEY",
  ),
  catalogEntry(
    "marginalia",
    { enabled: false, budget: { mode: "managed" } },
    "MARGINALIA_API_KEY",
  ),
  catalogEntry(
    "ollama",
    {
      enabled: false,
      budget: { mode: "unlimited" },
      apiKey: "OLLAMA_API_KEY",
    },
    "OLLAMA_API_KEY",
  ),
  catalogEntry("openai-codex", { enabled: true, budget: { mode: "managed" } }),
  catalogEntry(
    "openai-web-search",
    {
      enabled: true,
      budget: { mode: "managed" },
      apiKey: "OPENAI_API_KEY",
    },
    "OPENAI_API_KEY",
  ),
  catalogEntry(
    "parallel",
    {
      enabled: false,
      budget: { mode: "managed" },
      apiKey: "PARALLEL_API_KEY",
    },
    "PARALLEL_API_KEY",
  ),
  catalogEntry(
    "perplexity",
    {
      enabled: true,
      budget: { mode: "managed" },
      apiKey: "PERPLEXITY_API_KEY",
    },
    "PERPLEXITY_API_KEY",
  ),
  catalogEntry("searxng", {
    enabled: false,
    budget: { mode: "unlimited" },
    instanceUrl: "http://localhost:8080",
  }),
  catalogEntry(
    "serper",
    {
      enabled: false,
      budget: {
        mode: "hard",
        limit: 2500,
        period: "lifetime",
        unit: "request",
      },
      apiKey: "SERPER_API_KEY",
    },
    "SERPER_API_KEY",
  ),
  catalogEntry(
    "sofya",
    {
      enabled: false,
      budget: { mode: "managed" },
      apiKey: "SOFYA_API_KEY",
    },
    "SOFYA_API_KEY",
  ),
  catalogEntry(
    "tavily",
    {
      enabled: false,
      budget: { mode: "hard", limit: 1000, period: "month", unit: "credit" },
      apiKey: "TAVILY_API_KEY",
    },
    "TAVILY_API_KEY",
  ),
  catalogEntry(
    "tinyfish",
    {
      enabled: true,
      budget: { mode: "unlimited" },
      apiKey: "TINYFISH_API_KEY",
    },
    "TINYFISH_API_KEY",
  ),
  catalogEntry(
    "websearchapi",
    {
      enabled: false,
      budget: { mode: "hard", limit: 2000, period: "month", unit: "credit" },
      apiKey: "WEBSEARCHAPI_API_KEY",
    },
    "WEBSEARCHAPI_API_KEY",
  ),
  catalogEntry(
    "youcom",
    {
      enabled: false,
      budget: { mode: "hard", limit: 100, period: "lifetime", unit: "usd" },
      apiKey: "YOUCOM_API_KEY",
    },
    "YOUCOM_API_KEY",
  ),
];
```

Derive config and fallback projections from `providerCatalog`; keep `allProviders` as the validated adapter-order metadata projection:

```ts
export { providerCatalog };

export const allProviders: ProviderMeta[] = [...providerMetas];

export const defaultProviderConfigs: Record<string, ProviderConfigEntry> =
  Object.fromEntries(
    providerCatalog.map(({ meta, defaultConfig }) => [
      meta.name,
      defaultConfig,
    ]),
  );

export const fallbackEnvMap: Record<string, string> = Object.fromEntries([
  ...providerCatalog.flatMap(({ meta, fallbackEnv }) =>
    fallbackEnv ? [[meta.name, fallbackEnv] as const] : [],
  ),
  ["gemini", "GEMINI_API_KEY"] as const,
]);
```

Before exporting projections, validate that every catalog metadata name is unique, every imported metadata name has one catalog entry, and Gemini is not accidentally treated as a provider. A module-load error is preferable to silently dropping a provider from registration:

```ts
const catalogNames = new Set(providerCatalog.map(({ meta }) => meta.name));
if (catalogNames.size !== providerCatalog.length)
  throw new Error("Duplicate provider catalog name");
if (catalogNames.size !== providerMetas.length)
  throw new Error("Provider metadata and catalog entry counts differ");
for (const meta of providerMetas) {
  if (!catalogNames.has(meta.name))
    throw new Error(`Provider ${meta.name} is missing from catalog`);
}
```

Do not export the mutable source tables. Export the catalog and projections only.

- [ ] **Step 3: Add catalog consistency tests before consumers change.**

Create `tests/providers/catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  allProviders,
  defaultProviderConfigs,
  fallbackEnvMap,
  providerCatalog,
} from "../../src/providers/catalog.ts";

describe("provider catalog", () => {
  it("has one entry per provider and no duplicate names", () => {
    const names = providerCatalog.map(({ meta }) => meta.name);
    expect(names.length).toBe(23);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(allProviders.map(({ name }) => name))).toEqual(
      new Set(names),
    );
    expect(names).toEqual([
      "brave",
      "brave-llm",
      "context7",
      "duckduckgo",
      "exa",
      "fastcrw",
      "firecrawl",
      "jina",
      "langsearch",
      "linkup",
      "marginalia",
      "ollama",
      "openai-codex",
      "openai-web-search",
      "parallel",
      "perplexity",
      "searxng",
      "serper",
      "sofya",
      "tavily",
      "tinyfish",
      "websearchapi",
      "youcom",
    ]);
    expect(allProviders.map(({ name }) => name)).toEqual([
      "brave",
      "brave-llm",
      "fastcrw",
      "langsearch",
      "linkup",
      "marginalia",
      "perplexity",
      "websearchapi",
      "youcom",
      "context7",
      "duckduckgo",
      "exa",
      "firecrawl",
      "jina",
      "ollama",
      "openai-codex",
      "openai-web-search",
      "parallel",
      "searxng",
      "serper",
      "sofya",
      "tavily",
      "tinyfish",
    ]);
    expect(Object.keys(defaultProviderConfigs)).toEqual(names);
  });

  it("has a valid default config for every provider", () => {
    for (const { meta, defaultConfig } of providerCatalog) {
      expect(defaultProviderConfigs[meta.name]).toEqual(defaultConfig);
      expect(typeof defaultConfig.enabled).toBe("boolean");
      expect(defaultConfig.budget.mode).toMatch(/^(hard|managed|unlimited)$/);
    }
  });

  it("keeps fallback env mappings in the catalog projection", () => {
    expect(fallbackEnvMap.brave).toBe("BRAVE_API_KEY");
    expect(fallbackEnvMap.exa).toBe("EXA_API_KEY");
    expect(fallbackEnvMap.gemini).toBe("GEMINI_API_KEY");
    expect(fallbackEnvMap["openai-codex"]).toBeUndefined();
  });
});
```

Run:

```bash
pnpm exec vitest run tests/providers/catalog.test.ts
```

Expected: the new catalog tests pass before the existing consumers are switched.

- [ ] **Step 4: Keep the compatibility barrel.**

Replace the provider assembly in `src/providers/all.ts` with:

```ts
export { allProviders, providerCatalog } from "./catalog.ts";
```

Existing imports of `allProviders` must continue to compile. Do not make callers import individual adapter modules just to access provider metadata.

### Task 2: Make config consume catalog projections

**Files:**

- Modify: `src/config.ts`
- Modify: `src/providers/searxng.ts`
- Modify: `tests/config.test.ts`
- Modify: `tests/providers/searxng.test.ts`

- [ ] **Step 1: Replace duplicate maps in `config.ts`.**

Import the value projections from the catalog:

```ts
import { defaultProviderConfigs, fallbackEnvMap } from "./providers/catalog.ts";
```

Replace the manually maintained `FALLBACK_ENV_MAP` object with:

```ts
export const FALLBACK_ENV_MAP = fallbackEnvMap;
```

Replace the literal `DEFAULT_CONFIG.providers` object with:

```ts
providers: defaultProviderConfigs,
```

Leave `DEFAULT_GITHUB_CONFIG`, `DEFAULT_COMBINE_CONFIG`, `DEFAULT_DEEP_RESEARCH_CONFIG`, Gemini, YouTube, Video, and PDF defaults in `config.ts`; they are not provider catalog entries. Preserve the existing `loadMergedConfig` merge order and validation.

- [ ] **Step 2: Break the provider-to-config runtime cycle in SearXNG.**

`src/providers/searxng.ts` currently imports `resolveApiKey` as a runtime value. `ConfigManager` already resolves `providerConfig.apiKey` before calling `meta.create`, so pass the injected `key` directly:

```ts
create: (key, providerConfig) => ({
  search: new SearXNGProvider({
    instanceUrl: providerConfig?.instanceUrl,
    apiKey: key,
  }),
}),
```

Remove the `resolveApiKey` import. This preserves explicit keys, environment-variable indirection, and shell commands because `ConfigManager` still resolves those values with `resolveApiKey` before calling the factory. Direct extraction paths that use `resolveProviderKey` continue to read the catalog-backed `FALLBACK_ENV_MAP`. Do not add fallback resolution to `ConfigManager` in this phase.

Update `tests/providers/searxng.test.ts` so the provider-factory test passes the already resolved literal key as the first `create` argument. The factory no longer resolves `providerConfig.apiKey` itself; the `ConfigManager` injection test in Task 3 proves the production path.

- [ ] **Step 3: Prove defaults and fallback behavior did not drift.**

Keep the existing `FALLBACK_ENV_MAP` assertions and add a comparison in `tests/config.test.ts` between `Object.keys(loadConfig().providers)` and `Object.keys(defaultProviderConfigs)`. Keep `tests/extract/config-video.test.ts` unchanged; its existing Gemini assertion already covers the public `FALLBACK_ENV_MAP` export.

Import `defaultProviderConfigs` from `src/providers/catalog.ts` in that test only for the provider-name/order comparison; do not export `DEFAULT_CONFIG` just to make the test observable.

Run:

```bash
pnpm exec vitest run tests/providers/catalog.test.ts tests/providers/all.test.ts tests/config.test.ts tests/providers/searxng.test.ts
```

Expected: provider count, names, built-in budgets, fallback env resolution, and Gemini config defaults remain unchanged.

### Task 3: Route registration and dashboard metadata through the catalog

**Files:**

- Modify: `src/config-manager.ts`
- Modify: `src/index.ts`
- Modify: `tests/config-manager.test.ts`
- Modify: `tests/providers/all.test.ts`

- [ ] **Step 1: Pass the catalog projection into `ConfigManager`.**

Keep `ConfigManager`’s provider metadata argument typed as `readonly ProviderMeta[]` and pass `allProviders` from the catalog. Do not make `ConfigManager` know about individual provider modules. If the constructor is widened from `ProviderMeta[]` to `readonly ProviderMeta[]`, update tests and callers without changing registration behavior.

- [ ] **Step 2: Build dashboard identity from the catalog-backed provider projection.**

In `src/index.ts`, build the dashboard tier map from `allProviders`, which is exported by the catalog module in the existing `all.ts` order:

```ts
const tierMap = new Map<string, ProviderTier>(
  allProviders.map((meta) => [meta.name, meta.tier]),
);
const allProviderNames = allProviders.map(({ name }) => name);
```

The dashboard must continue showing all built-ins, including disabled providers, in the current `all.ts` order. Do not import `providerCatalog` separately just to rebuild the same metadata lookup.

- [ ] **Step 3: Add the SearXNG injection regression test.**

In `tests/config-manager.test.ts`, instantiate the real `searxng` metadata with a config key and spy on the resulting provider request headers. Assert that `ConfigManager` resolves the key and injects it into the provider factory. The production module import graph proves the provider no longer imports `config.ts` at runtime; keep the test deterministic by using the existing mocked `resolveApiKey`.

- [ ] **Step 4: Run the registration and dashboard tests.**

Run:

```bash
pnpm exec vitest run tests/config-manager.test.ts tests/providers/all.test.ts tests/commands/tools.test.ts tests/commands/tools-actions.test.ts tests/commands/tools-dashboard.test.ts
```

Expected: all provider registration, name/tier display, and configuration command tests pass.

### Task 4: Complete the phase gate and commit

- [ ] **Step 1: Search for stale duplicate sources.**

Run:

```bash
rg -n "const (FALLBACK_ENV_MAP|DEFAULT_CONFIG)|export const allProviders|providerMeta as" src/config.ts src/providers src/index.ts
```

Expected: the provider default map and fallback map exist only as catalog projections; `all.ts` only re-exports catalog values; adapter imports remain in `catalog.ts`.

- [ ] **Step 2: Run the complete phase gate.**

```bash
pnpm exec vitest run tests/providers/catalog.test.ts tests/providers/all.test.ts tests/config.test.ts tests/config-manager.test.ts tests/providers/searxng.test.ts tests/extract/config-video.test.ts tests/commands/tools.test.ts tests/commands/tools-actions.test.ts tests/commands/tools-dashboard.test.ts
pnpm check
git diff --check
```

Expected: focused tests and the full suite pass with only the documented pre-existing Biome and Node-engine warnings.

- [ ] **Step 3: Commit the atomic phase.**

```bash
git add src/providers/catalog.ts src/providers/all.ts src/providers/searxng.ts src/config.ts src/config-manager.ts src/index.ts tests/providers/catalog.test.ts tests/config.test.ts tests/providers/searxng.test.ts tests/config-manager.test.ts tests/providers/all.test.ts
git commit -m "refactor: centralize provider catalog"
```

The commit must not include operation execution, tool re-registration, or extraction fallback changes.

## Phase completion gate

- Every built-in provider has exactly one catalog entry and one default config.
- Fallback env names, including the Gemini service fallback, are catalog-derived.
- `allProviders`, `ConfigManager`, config loading, and the dashboard consume catalog projections.
- User overrides and provider registration behavior are unchanged.
- Focused tests, `pnpm check`, and `git diff --check` pass.
