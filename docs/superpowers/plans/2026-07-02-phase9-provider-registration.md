# Phase 9: Provider Registration Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move provider metadata (tier, quota, key requirement, factory) from the centralized `providerFactories` map in `index.ts` into each provider file. Create a barrel that collects them. Shrink `index.ts` from ~219 lines to ~100 lines.

**Architecture:** Each provider exports a `providerMeta` object with `name`, `tier`, `monthlyQuota`, `requiresKey`, and `create()`. A barrel file `src/providers/all.ts` imports and re-exports all metas as an array. `index.ts` iterates this array instead of maintaining its own factory map.

**Tech Stack:** TypeScript 6, Vitest 4, Node 24+

---

## Context

Current state in `src/index.ts`:
- Lines 7-19: 13 concrete provider imports
- Lines 28-37: `ProviderFactory` interface
- Lines 39-112: `providerFactories` map (73 lines of metadata + factory logic)
- Lines 136-156: Registration loop that reads from the map

The `create` function signature is: `(key?: string, providerConfig?: ProviderConfigEntry) => { search?: SearchProvider; fetch?: FetchProvider; codeSearch?: CodeSearchProvider }`

---

### Task 1: Define ProviderMeta type and add meta to first 3 providers

**Files:**
- Create: `src/providers/all.ts`
- Modify: `src/providers/brave.ts`
- Modify: `src/providers/duckduckgo.ts`
- Modify: `src/providers/jina.ts`

- [ ] **Step 1: Create the ProviderMeta type in the barrel file**

Create `src/providers/all.ts`:

```ts
import type { ProviderConfigEntry } from "../config.ts";
import type { CodeSearchProvider, FetchProvider, ProviderTier, SearchProvider } from "./types.ts";

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

// Will be populated as we add providerMeta to each provider file
export const allProviders: ProviderMeta[] = [];
```

- [ ] **Step 2: Add providerMeta to brave.ts**

Append to `src/providers/brave.ts`:

```ts
import type { ProviderMeta } from "./all.ts";

export const providerMeta: ProviderMeta = {
  name: "brave",
  tier: 1,
  monthlyQuota: 2000,
  requiresKey: true,
  create: (key) => ({ search: new BraveProvider(key!) }),
};
```

- [ ] **Step 3: Add providerMeta to duckduckgo.ts**

Append to `src/providers/duckduckgo.ts`:

```ts
import type { ProviderMeta } from "./all.ts";

export const providerMeta: ProviderMeta = {
  name: "duckduckgo",
  tier: 3,
  monthlyQuota: null,
  requiresKey: false,
  create: () => ({ search: new DuckDuckGoProvider() }),
};
```

- [ ] **Step 4: Add providerMeta to jina.ts**

Append to `src/providers/jina.ts`:

```ts
import type { ProviderMeta } from "./all.ts";

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

- [ ] **Step 5: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS (no type errors)

- [ ] **Step 6: Commit**

```bash
git add src/providers/all.ts src/providers/brave.ts src/providers/duckduckgo.ts src/providers/jina.ts
git commit -m "feat: add ProviderMeta type and meta exports to brave, duckduckgo, jina"
```

---

### Task 2: Add providerMeta to remaining 10 providers

**Files:**
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

- [ ] **Step 1: Add providerMeta to serper.ts**

Append to `src/providers/serper.ts`:

```ts
import type { ProviderMeta } from "./all.ts";

export const providerMeta: ProviderMeta = {
  name: "serper",
  tier: 1,
  monthlyQuota: 2500,
  requiresKey: true,
  create: (key) => ({ search: new SerperProvider(key!) }),
};
```

- [ ] **Step 2: Add providerMeta to tavily.ts**

Append to `src/providers/tavily.ts`:

```ts
import type { ProviderMeta } from "./all.ts";

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

- [ ] **Step 3: Add providerMeta to exa.ts**

Append to `src/providers/exa.ts`:

```ts
import type { ProviderMeta } from "./all.ts";

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

- [ ] **Step 4: Add providerMeta to perplexity.ts**

Append to `src/providers/perplexity.ts`:

```ts
import type { ProviderMeta } from "./all.ts";

export const providerMeta: ProviderMeta = {
  name: "perplexity",
  tier: 2,
  monthlyQuota: null,
  requiresKey: true,
  create: (key) => ({ search: new PerplexityProvider(key!) }),
};
```

- [ ] **Step 5: Add providerMeta to firecrawl.ts**

Append to `src/providers/firecrawl.ts`:

```ts
import type { ProviderMeta } from "./all.ts";

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

- [ ] **Step 6: Add providerMeta to exa-mcp.ts**

Append to `src/providers/exa-mcp.ts`:

```ts
import type { ProviderMeta } from "./all.ts";

export const providerMeta: ProviderMeta = {
  name: "exa-mcp",
  tier: 3,
  monthlyQuota: null,
  requiresKey: false,
  create: () => ({ search: new ExaMcpProvider() }),
};
```

- [ ] **Step 7: Add providerMeta to openai-native.ts**

Append to `src/providers/openai-native.ts`:

```ts
import type { ProviderMeta } from "./all.ts";

export const providerMeta: ProviderMeta = {
  name: "openai-native",
  tier: 1,
  monthlyQuota: null,
  requiresKey: true,
  create: (key) => ({ search: new OpenAINativeProvider(key!) }),
};
```

- [ ] **Step 8: Add providerMeta to parallel.ts**

Append to `src/providers/parallel.ts`:

```ts
import type { ProviderMeta } from "./all.ts";

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

- [ ] **Step 9: Add providerMeta to searxng.ts**

Append to `src/providers/searxng.ts`:

```ts
import type { ProviderMeta } from "./all.ts";
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

- [ ] **Step 10: Add providerMeta to websearchapi.ts**

Append to `src/providers/websearchapi.ts`:

```ts
import type { ProviderMeta } from "./all.ts";

export const providerMeta: ProviderMeta = {
  name: "websearchapi",
  tier: 1,
  monthlyQuota: null,
  requiresKey: true,
  create: (key) => ({ search: new WebSearchApiProvider(key!) }),
};
```

- [ ] **Step 11: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add src/providers/serper.ts src/providers/tavily.ts src/providers/exa.ts \
  src/providers/perplexity.ts src/providers/firecrawl.ts src/providers/exa-mcp.ts \
  src/providers/openai-native.ts src/providers/parallel.ts src/providers/searxng.ts \
  src/providers/websearchapi.ts
git commit -m "feat: add providerMeta exports to all remaining providers"
```

---

### Task 3: Populate the barrel with all provider metas

**Files:**
- Modify: `src/providers/all.ts`

- [ ] **Step 1: Import all provider metas into the barrel**

Replace `src/providers/all.ts` content:

```ts
import type { ProviderConfigEntry } from "../config.ts";
import type { CodeSearchProvider, FetchProvider, ProviderTier, SearchProvider } from "./types.ts";

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

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/providers/all.ts
git commit -m "feat: populate provider barrel with all 13 provider metas"
```

---

### Task 4: Rewrite index.ts to use the barrel

**Files:**
- Modify: `src/index.ts`
- Test: `tests/index.test.ts`

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

- [ ] **Step 1: Inline the ProviderError interface**

In `src/utils/errors.ts`, remove the exported `ProviderError` interface and inline the type:

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

- [ ] **Step 2: Check for external usages of ProviderError type**

```bash
grep -rn "ProviderError" src/ tests/
```

If any imports reference `ProviderError`, update them to use `Array<{ provider: string; error: string }>` inline.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run tests/utils/errors.test.ts`
Expected: PASS

- [ ] **Step 4: Run full verification**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/errors.ts
git commit -m "refactor: inline ProviderError interface into AggregateProviderError"
```
