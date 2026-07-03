# Phase 9: Provider Registration Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move provider metadata (tier, quota, key requirement, factory) from the centralized `providerFactories` map in `index.ts` into each provider file. Create a barrel that collects them. Shrink `index.ts` from ~220 lines to ~100 lines.

**Architecture:** Each provider exports a `providerMeta` object conforming to a `ProviderMeta` interface defined in `types.ts`. A barrel file `src/providers/all.ts` imports and re-exports all metas as an array. `index.ts` iterates this array instead of maintaining its own factory map.

**Tech Stack:** TypeScript 6, Vitest 4, Node 24+

---

## Context

Current state in `src/index.ts`:
- Lines 7-19: 13 concrete provider imports
- Lines 28-37: `ProviderFactory` interface (local, not exported)
- Lines 39-112: `providerFactories` map (73 lines of metadata + factory logic)
- Lines 136-156: Registration loop that reads from the map

The `create` function signature is: `(key?: string, providerConfig?: ProviderConfigEntry) => { search?: SearchProvider; fetch?: FetchProvider; codeSearch?: CodeSearchProvider }`

**Key constraint — avoiding circular imports:** The `ProviderMeta` type lives in `types.ts`. Provider files import the type from `types.ts`. The barrel `all.ts` imports values from provider files. This gives a clean dependency graph: `types.ts` ← providers ← `all.ts` ← `index.ts`.

---

### Task 1: Replace dead types in types.ts with ProviderMeta

**Files:**
- Modify: `src/providers/types.ts`
- Modify: `tests/providers/types.test.ts`

The existing `ProviderMeta`, `ProviderCapabilities`, and `ProviderConfig` interfaces in `types.ts` (lines 52-73) are unused in production code. Replace them with the new `ProviderMeta` that carries a factory function.

- [ ] **Step 1: Replace dead types with the new ProviderMeta and ProviderInstances**

Replace lines 52-73 in `src/providers/types.ts` with:

```ts
export interface ProviderInstances {
  search?: SearchProvider;
  fetch?: FetchProvider;
  codeSearch?: CodeSearchProvider;
}

export interface ProviderMeta {
  name: string;
  tier: ProviderTier;
  monthlyQuota: number | null;
  requiresKey: boolean;
  create: (key?: string, providerConfig?: ProviderConfigEntry) => ProviderInstances;
}
```

Add the required import at the top of `types.ts`:

```ts
import type { ProviderConfigEntry } from "../config.ts";
```

- [ ] **Step 2: Update the types test**

Replace the `ProviderMeta` test in `tests/providers/types.test.ts` to match the new shape:

```ts
it("ProviderMeta describes provider registration", () => {
  const meta: ProviderMeta = {
    name: "brave",
    tier: 1,
    monthlyQuota: 2000,
    requiresKey: true,
    create: (key) => ({ search: { name: "brave", label: "Brave", search: async () => [] } }),
  };
  expect(meta.tier).toBe(1);
  expect(meta.requiresKey).toBe(true);
  expect(meta.monthlyQuota).toBe(2000);
  expect(meta.create("key")).toHaveProperty("search");
});
```

Also update the import to remove `ProviderMeta` references to old fields (`ProviderCapabilities` is gone).

- [ ] **Step 3: Run typecheck and tests**

Run: `pnpm run typecheck && pnpm vitest run tests/providers/types.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/providers/types.ts tests/providers/types.test.ts
git commit -m "refactor: replace dead ProviderMeta/ProviderCapabilities/ProviderConfig with factory-aware ProviderMeta"
```

---

### Task 2: Add providerMeta to all 13 provider files

**Files:**
- Modify: `src/providers/brave.ts`
- Modify: `src/providers/duckduckgo.ts`
- Modify: `src/providers/jina.ts`
- Modify: `src/providers/serper.ts`
- Modify: `src/providers/tavily.ts`
- Modify: `src/providers/exa.ts`
- Modify: `src/providers/perplexity.ts`
- Modify: `src/providers/firecrawl.ts`
- Modify: `src/providers/exa-mcp.ts`
- Modify: `src/providers/openai-native.ts`
- Modify: `src/providers/parallel.ts`
- Modify: `src/providers/searxng.ts`
- Modify: `src/providers/websearchapi.ts`

Each provider file gets a `providerMeta` export that imports `ProviderMeta` from `./types.ts` (no circular dependency — types.ts has no runtime imports from provider files).

- [ ] **Step 1: Add providerMeta to brave.ts**

Add import and append to `src/providers/brave.ts`:

```ts
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "brave",
  tier: 1,
  monthlyQuota: 2000,
  requiresKey: true,
  create: (key) => ({ search: new BraveProvider(key!) }),
};
```

- [ ] **Step 2: Add providerMeta to duckduckgo.ts**

```ts
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "duckduckgo",
  tier: 3,
  monthlyQuota: null,
  requiresKey: false,
  create: () => ({ search: new DuckDuckGoProvider() }),
};
```

- [ ] **Step 3: Add providerMeta to jina.ts**

```ts
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "jina",
  tier: 3,
  monthlyQuota: null,
  requiresKey: false,
  create: (key) => {
    const p = new JinaProvider(key);
    return { search: p, fetch: p };
  },
};
```

- [ ] **Step 4: Add providerMeta to serper.ts**

```ts
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "serper",
  tier: 1,
  monthlyQuota: 2500,
  requiresKey: true,
  create: (key) => ({ search: new SerperProvider(key!) }),
};
```

- [ ] **Step 5: Add providerMeta to tavily.ts**

```ts
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "tavily",
  tier: 1,
  monthlyQuota: 1000,
  requiresKey: true,
  create: (key) => {
    const p = new TavilyProvider(key!);
    return { search: p, fetch: p };
  },
};
```

- [ ] **Step 6: Add providerMeta to exa.ts**

```ts
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "exa",
  tier: 1,
  monthlyQuota: 1000,
  requiresKey: true,
  create: (key) => {
    const p = new ExaProvider(key!);
    return { search: p, fetch: p, codeSearch: p };
  },
};
```

- [ ] **Step 7: Add providerMeta to perplexity.ts**

```ts
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "perplexity",
  tier: 2,
  monthlyQuota: null,
  requiresKey: true,
  create: (key) => ({ search: new PerplexityProvider(key!) }),
};
```

- [ ] **Step 8: Add providerMeta to firecrawl.ts**

```ts
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "firecrawl",
  tier: 1,
  monthlyQuota: 1000,
  requiresKey: true,
  create: (key) => {
    const p = new FirecrawlProvider(key!);
    return { search: p, fetch: p };
  },
};
```

- [ ] **Step 9: Add providerMeta to exa-mcp.ts**

```ts
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "exa-mcp",
  tier: 3,
  monthlyQuota: null,
  requiresKey: false,
  create: () => ({ search: new ExaMcpProvider() }),
};
```

- [ ] **Step 10: Add providerMeta to openai-native.ts**

```ts
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "openai-native",
  tier: 1,
  monthlyQuota: null,
  requiresKey: true,
  create: (key) => ({ search: new OpenAINativeProvider(key!) }),
};
```

- [ ] **Step 11: Add providerMeta to parallel.ts**

```ts
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "parallel",
  tier: 1,
  monthlyQuota: null,
  requiresKey: true,
  create: (key) => {
    const p = new ParallelProvider(key!);
    return { search: p, fetch: p };
  },
};
```

- [ ] **Step 12: Add providerMeta to searxng.ts**

```ts
import type { ProviderMeta } from "./types.ts";
import { resolveApiKey } from "../config.ts";

export const providerMeta: ProviderMeta = {
  name: "searxng",
  tier: 2,
  monthlyQuota: null,
  requiresKey: false,
  create: (_key, providerConfig) => ({
    search: new SearXNGProvider({
      instanceUrl: providerConfig?.instanceUrl,
      apiKey: providerConfig?.apiKey ? resolveApiKey(providerConfig.apiKey) : undefined,
    }),
  }),
};
```

- [ ] **Step 13: Add providerMeta to websearchapi.ts**

```ts
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "websearchapi",
  tier: 1,
  monthlyQuota: null,
  requiresKey: true,
  create: (key) => ({ search: new WebSearchApiProvider(key!) }),
};
```

- [ ] **Step 14: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 15: Commit**

```bash
git add src/providers/brave.ts src/providers/duckduckgo.ts src/providers/jina.ts \
  src/providers/serper.ts src/providers/tavily.ts src/providers/exa.ts \
  src/providers/perplexity.ts src/providers/firecrawl.ts src/providers/exa-mcp.ts \
  src/providers/openai-native.ts src/providers/parallel.ts src/providers/searxng.ts \
  src/providers/websearchapi.ts
git commit -m "feat: add providerMeta exports to all 13 provider files"
```

---

### Task 3: Create the barrel and add a smoke test

**Files:**
- Create: `src/providers/all.ts`
- Create: `tests/providers/all.test.ts`

- [ ] **Step 1: Create the barrel file**

Create `src/providers/all.ts`:

```ts
import { providerMeta as brave } from "./brave.ts";
import { providerMeta as duckduckgo } from "./duckduckgo.ts";
import { providerMeta as exa } from "./exa.ts";
import { providerMeta as exaMcp } from "./exa-mcp.ts";
import { providerMeta as firecrawl } from "./firecrawl.ts";
import { providerMeta as jina } from "./jina.ts";
import { providerMeta as openaiNative } from "./openai-native.ts";
import { providerMeta as parallel } from "./parallel.ts";
import { providerMeta as perplexity } from "./perplexity.ts";
import { providerMeta as searxng } from "./searxng.ts";
import { providerMeta as serper } from "./serper.ts";
import { providerMeta as tavily } from "./tavily.ts";
import { providerMeta as websearchapi } from "./websearchapi.ts";

import type { ProviderMeta } from "./types.ts";
export type { ProviderMeta };

export const allProviders: ProviderMeta[] = [
  brave,
  duckduckgo,
  exa,
  exaMcp,
  firecrawl,
  jina,
  openaiNative,
  parallel,
  perplexity,
  searxng,
  serper,
  tavily,
  websearchapi,
];
```

- [ ] **Step 2: Add barrel smoke test**

Create `tests/providers/all.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { allProviders } from "../../src/providers/all.ts";

describe("allProviders barrel", () => {
  it("exports exactly 13 providers", () => {
    expect(allProviders).toHaveLength(13);
  });

  it("every entry has required ProviderMeta fields", () => {
    for (const meta of allProviders) {
      expect(meta.name).toBeTypeOf("string");
      expect([1, 2, 3]).toContain(meta.tier);
      expect(meta.monthlyQuota === null || typeof meta.monthlyQuota === "number").toBe(true);
      expect(meta.requiresKey).toBeTypeOf("boolean");
      expect(meta.create).toBeTypeOf("function");
    }
  });

  it("has no duplicate names", () => {
    const names = allProviders.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("contains all expected provider names", () => {
    const names = allProviders.map((m) => m.name).sort();
    expect(names).toEqual([
      "brave",
      "duckduckgo",
      "exa",
      "exa-mcp",
      "firecrawl",
      "jina",
      "openai-native",
      "parallel",
      "perplexity",
      "searxng",
      "serper",
      "tavily",
      "websearchapi",
    ]);
  });
});
```

- [ ] **Step 3: Run typecheck and test**

Run: `pnpm run typecheck && pnpm vitest run tests/providers/all.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/providers/all.ts tests/providers/all.test.ts
git commit -m "feat: create provider barrel with smoke test"
```

---

### Task 4: Rewrite index.ts to use the barrel

**Files:**
- Modify: `src/index.ts`
- Test: `tests/index.test.ts`, `tests/index-strategy.test.ts`

- [ ] **Step 1: Rewrite index.ts**

Replace `src/index.ts` with:

```ts
// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadMergedConfig, resolveApiKey } from "./config.ts";
import { ContentStore, type StoredContent } from "./storage.ts";
import { UsageTracker } from "./providers/usage.ts";
import { ProviderRegistry } from "./providers/registry.ts";
import { allProviders } from "./providers/all.ts";
import type { ProviderTier } from "./providers/types.ts";
import { createWebSearchTool } from "./tools/web-search.ts";
import { createWebFetchTool } from "./tools/web-fetch.ts";
import { createWebReadTool } from "./tools/web-read.ts";
import { createCodeSearchTool } from "./tools/code-search.ts";
import { createToolsCommand } from "./commands/tools.ts";
import { ContentCache } from "./cache.ts";

function isStoredContent(data: unknown): data is StoredContent {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.id === "string" &&
    typeof d.url === "string" &&
    typeof d.text === "string" &&
    typeof d.chars === "number" &&
    typeof d.storedAt === "string" &&
    (d.source === "web_fetch" || d.source === "web_search")
  );
}

export default function createExtension(pi: ExtensionAPI): void {
  const config = loadMergedConfig(process.cwd());
  const store = new ContentStore((customType, data) =>
    pi.appendEntry(customType, data),
  );
  const tracker = new UsageTracker();
  const registry = new ProviderRegistry(tracker);

  // Register providers from the barrel
  for (const meta of allProviders) {
    const providerConfig = config.providers[meta.name];
    if (providerConfig?.enabled === false) continue;

    const resolvedKey = resolveApiKey(providerConfig?.apiKey);
    if (meta.requiresKey && !resolvedKey) continue;

    const instances = meta.create(resolvedKey, providerConfig);
    const quota = providerConfig?.monthlyQuota ?? meta.monthlyQuota;

    if (instances.search) {
      registry.registerSearch(instances.search, { tier: meta.tier, monthlyQuota: quota });
    }
    if (instances.fetch) {
      registry.registerFetch(instances.fetch);
    }
    if (instances.codeSearch) {
      registry.registerCodeSearch(instances.codeSearch);
    }
  }

  // Restore stored content from previous session
  pi.on("session_start", (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries();
    const restored = entries
      .filter((e) => e.type === "custom" && e.customType === "pi-tools-content" && e.data)
      .map((e) => (e as { data: unknown }).data)
      .filter(isStoredContent);
    if (restored.length > 0) {
      store.restore(restored);
    }
  });

  const resolveCandidates = config.selectionStrategy === "best-performing"
    ? (name?: string) => {
        const provider = registry.selectSearchByPerformance(name);
        return provider ? [provider] : [];
      }
    : (name?: string) => registry.selectSearchCandidates(name);

  pi.registerTool(
    createWebSearchTool(
      resolveCandidates,
      (providerName, latencyMs) => {
        registry.recordUsage(providerName);
        registry.recordSuccess(providerName, latencyMs);
      },
      config.guidance?.web_search,
      (providerName) => registry.recordFailure(providerName),
    ),
  );
  const fetchCache = new ContentCache(200, 5 * 60_000);
  pi.registerTool(
    createWebFetchTool(
      store,
      () => registry.selectFetchCandidates(),
      fetchCache,
      config.guidance?.web_fetch,
      config.github,
    ),
  );
  pi.registerTool(createWebReadTool(store, config.guidance?.web_read));
  pi.registerTool(
    createCodeSearchTool(
      () => registry.selectCodeSearch(),
      (providerName) => registry.recordUsage(providerName),
      config.guidance?.code_search,
    ),
  );

  // Build tier map for status display
  const tierMap = new Map<string, ProviderTier>();
  for (const meta of allProviders) {
    tierMap.set(meta.name, meta.tier);
  }

  // Register /tools command
  const allProviderNames = allProviders.map((m) => m.name);
  const toolsCommand = createToolsCommand(registry, tierMap, allProviderNames);
  pi.registerCommand(toolsCommand.name, {
    description: toolsCommand.description,
    handler: toolsCommand.handler,
  });
}
```

- [ ] **Step 2: Run full test suite**

Run: `pnpm vitest run`
Expected: All tests PASS

- [ ] **Step 3: Run full verification**

Run: `pnpm check`
Expected: lint PASS, typecheck PASS, tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "refactor: replace providerFactories map with barrel import from providers/all.ts"
```

---

### Task 5: Inline ProviderError interface (audit shrink)

**Files:**
- Modify: `src/utils/errors.ts`
- Test: `tests/utils/errors.test.ts`

The `ProviderError` interface is used only inside `errors.ts` by `AggregateProviderError`. No external code imports it directly. Inline the type.

- [ ] **Step 1: Inline the ProviderError interface**

In `src/utils/errors.ts`, remove the `ProviderError` interface and inline the type into `AggregateProviderError`:

```ts
const SECRETS_PATTERN =
  /(bearer|token|api[-_]?key|authorization|secret|password)\s*[:=]?\s*[\w./-]{8,}/gi;
const MAX_LENGTH = 300;

export function sanitizeError(error: unknown): string {
  let msg: string;
  if (error === null || error === undefined) {
    return "Unknown error";
  }
  if (error instanceof Error) {
    msg = error.message;
  } else if (typeof error === "string") {
    msg = error;
  } else {
    msg = String(error);
  }

  msg = msg.replace(SECRETS_PATTERN, "[redacted]");

  if (msg.length > MAX_LENGTH) {
    msg = msg.slice(0, MAX_LENGTH);
  }

  return msg;
}

export class AggregateProviderError extends Error {
  readonly errors: Array<{ provider: string; error: string }>;

  constructor(context: string, errors: Array<{ provider: string; error: string }>) {
    const lines = errors.map((e) => `- ${e.provider}: ${sanitizeError(e.error)}`);
    super(`All ${context} providers failed:\n${lines.join("\n")}`);
    this.name = "AggregateProviderError";
    this.errors = errors;
  }
}
```

- [ ] **Step 2: Verify no external imports of ProviderError**

Run: `grep -rn "import.*ProviderError" src/ tests/`

Expected: No results (only `AggregateProviderError` is imported externally). If any references exist, update them.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run tests/utils/errors.test.ts`
Expected: PASS (existing tests pass since the shape `{ provider: string; error: string }` is unchanged)

- [ ] **Step 4: Run full verification**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/errors.ts
git commit -m "refactor: inline ProviderError interface into AggregateProviderError"
```

---

## Design decisions

- **`ProviderMeta` in `types.ts`, not `all.ts`:** Avoids circular imports. Provider files import the type from `types.ts`; the barrel imports values from provider files.
- **Replaced dead types:** The existing `ProviderMeta`, `ProviderCapabilities`, and `ProviderConfig` in `types.ts` were unused in production. Removing them avoids naming confusion and dead code.
- **Barrel created fully formed (no empty placeholder):** The barrel is created in Task 3 after all providers have their meta exports. No intermediate empty-array step.
- **Smoke test for barrel:** Verifies count, shape, uniqueness, and expected names — catches future regressions like adding a provider without registering it in the barrel.
- **`isStoredContent` kept as a named function:** Type guards cannot be inlined without losing TypeScript's `is` narrowing in the calling context. Keeping it as a named function above `createExtension` is the idiomatic approach.
