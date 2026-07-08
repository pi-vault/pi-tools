# Config Auto-Reload — Phase 3: Wire ConfigManager into Extension + /tools --reload

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static `loadMergedConfig()` call in `index.ts` with the `ConfigManager` from Phase 2, so tool closures dynamically read config on each invocation. Add `--reload` flag to the `/tools` command for forced refresh.

**Architecture:** `createExtension` constructs a `ConfigManager` instead of calling `loadMergedConfig` directly. The provider registration loop is removed from `index.ts` (ConfigManager does it internally). Tool closures switch from closed-over `config` to `configManager.current`. The `createToolsCommand` function accepts an optional `onReload` callback that it calls when `--reload` is passed.

**Tech Stack:** TypeScript, Vitest, existing pi-tools infrastructure.

**Spec:** `docs/superpowers/specs/2026-07-08-config-auto-reload-design.md`
**Main plan:** `docs/superpowers/plans/2026-07-08-config-auto-reload.md`

**Depends on:** Phase 2 (ConfigManager)
**Produces:** Fully wired config auto-reload. Edits to `tools.json` take effect within 30 seconds (or immediately via `/tools --reload`).

**Known limitation:** Guidance overrides (`config.guidance.*`) are passed to tool factories at registration time and evaluated once. Changing guidance mid-session requires a restart. Making guidance dynamic would mean changing 6 tool factory signatures and their tests — out of scope for this phase. The critical dynamic values (`selectionStrategy`, `defaultProvider`, provider add/remove/key-change) all work correctly via closures.

---

## Context for the Engineer

### Current index.ts flow (lines 30-147)

`createExtension(pi)` does:

1. `const config = loadMergedConfig(process.cwd())` — static snapshot (line 31)
2. Provider registration loop (lines 38-60) — iterates `allProviders`, resolves keys, registers with registry
3. Session restore handler (lines 63-72)
4. Closure creation (lines 74-81):
   - `resolveProviderName` — uses `config.defaultProvider`
   - `resolveCandidates` — branches on `config.selectionStrategy`
5. Tool registrations (lines 83-131) — pass `config.guidance.*`, `config.github`, closures
6. `/tools` command registration (lines 134-146)

After this change:

- Steps 1+2 collapse into `new ConfigManager(cwd, registry, allProviders)`
- Step 4 closures read `configManager.current.*` instead of `config.*`
- Step 5 passes getter-based references

### Current tools.ts signature (line 152-171)

```typescript
export function createToolsCommand(
  registry: ProviderRegistry,
  tierMap: ReadonlyMap<string, ProviderTier>,
  allProviderNames?: string[],
);
```

We add an optional `onReload` callback parameter. When `--reload` is in args, call it before rendering status.

### Test helpers

`tests/helpers.ts` exports:

- `makeCtx()` — creates a mock `ExtensionContext` with `ui.notify`, `ui.confirm`, etc.
- `createMockPi()` — creates a mock `ExtensionAPI` for integration tests

---

### Task 3.1: Add --reload flag to /tools command

**Files:**

- Modify: `src/commands/tools.ts:152-171`
- Modify: `tests/commands/tools.test.ts`

- [ ] **Step 1: Write failing test for --reload flag**

Append a new describe block at the end of `tests/commands/tools.test.ts`:

```typescript
describe("tools --reload command", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls onReload callback when --reload is passed", async () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

    const tierMap = new Map<string, ProviderTier>([["brave", 1]]);
    const onReload = vi.fn();
    const command = createToolsCommand(registry, tierMap, ["brave"], onReload);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("--reload", ctx);

    expect(onReload).toHaveBeenCalledTimes(1);
    // Should also show status after reload
    expect(ctx.ui.notify).toHaveBeenCalled();
    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(output).toContain("brave");
  });

  it("--reload without callback still shows status", async () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

    const tierMap = new Map<string, ProviderTier>([["brave", 1]]);
    // No onReload callback provided
    const command = createToolsCommand(registry, tierMap, ["brave"]);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("--reload", ctx);

    // Should not throw, just show status
    expect(ctx.ui.notify).toHaveBeenCalled();
  });

  it("--reload --status shows refreshed status", async () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

    const tierMap = new Map<string, ProviderTier>([["brave", 1]]);
    const onReload = vi.fn();
    const command = createToolsCommand(registry, tierMap, ["brave"], onReload);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("--reload --status", ctx);

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/commands/tools.test.ts`

Expected: Failures — `createToolsCommand` does not accept a 4th argument (the test may pass trivially if the extra arg is ignored, but the `onReload` callback won't be called).

- [ ] **Step 3: Update createToolsCommand to accept onReload**

In `src/commands/tools.ts`, update the `createToolsCommand` function signature and handler:

Replace the existing function (lines 152-171) with:

```typescript
export function createToolsCommand(
  registry: ProviderRegistry,
  tierMap: ReadonlyMap<string, ProviderTier>,
  allProviderNames?: string[],
  onReload?: () => void,
) {
  return {
    name: "tools",
    description:
      "Manage search/fetch providers. Use --status to see provider status, --reload to refresh config.",
    async handler(args: string, ctx: ExtensionCommandContext) {
      if (args.includes("--reload")) {
        onReload?.();
        const table = buildStatusTable(registry, tierMap);
        ctx.ui.notify(table);
        return;
      }

      if (args.includes("--status")) {
        const table = buildStatusTable(registry, tierMap);
        ctx.ui.notify(table);
        return;
      }

      await handleInteractiveSetup(ctx, allProviderNames ?? []);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/commands/tools.test.ts`

Expected: All tests pass, including the new `--reload` tests.

- [ ] **Step 5: Commit**

```bash
git add src/commands/tools.ts tests/commands/tools.test.ts
git commit -m "feat(tools): add --reload flag for forced config refresh

Accept optional onReload callback in createToolsCommand. When
--reload is passed, invoke the callback then show status table.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

### Task 3.2: Replace static config with ConfigManager in index.ts

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Update imports**

Replace the existing imports at the top of `src/index.ts` (lines 1-16). Change:

```typescript
import { loadMergedConfig, resolveApiKey } from "./config.ts";
```

to:

```typescript
import { ConfigManager } from "./config-manager.ts";
```

All other imports stay the same.

- [ ] **Step 2: Replace the config loading and provider registration**

Replace lines 30-61 of `createExtension` (from the function signature through the provider registration loop) with:

```typescript
export default function createExtension(pi: ExtensionAPI): void {
  const store = new ContentStore((customType, data) =>
    pi.appendEntry(customType, data),
  );
  const registry = new ProviderRegistry(createFilePersistence());
  const configManager = new ConfigManager(process.cwd(), registry, allProviders);
```

This replaces:

- `const config = loadMergedConfig(process.cwd());` (line 31)
- The `ContentStore` creation (lines 32-34) — stays the same
- `const registry = new ProviderRegistry(...)` (line 35) — stays the same
- The entire provider registration loop (lines 38-60) — removed, ConfigManager does it

- [ ] **Step 3: Update the session_start handler**

The session restore handler (lines 63-72) stays exactly the same. No changes needed.

- [ ] **Step 4: Update resolveCandidates closure**

Replace lines 74-81:

```typescript
const resolveProviderName = (name?: string) => name ?? config.defaultProvider;

const resolveCandidates =
  config.selectionStrategy === "best-performing"
    ? (name?: string) => {
        const provider = registry.selectSearchByPerformance(
          resolveProviderName(name),
        );
        return provider ? [provider] : [];
      }
    : (name?: string) =>
        registry.selectSearchCandidates(resolveProviderName(name));
```

with:

```typescript
const resolveCandidates = (name?: string) => {
  configManager.refresh();
  const resolved = name ?? configManager.current.defaultProvider;
  if (configManager.current.selectionStrategy === "best-performing") {
    const provider = registry.selectSearchByPerformance(resolved);
    return provider ? [provider] : [];
  }
  return registry.selectSearchCandidates(resolved);
};
```

- [ ] **Step 5: Update tool registrations to use configManager.current**

Replace the web_search tool registration (lines 83-95):

```typescript
pi.registerTool(
  createWebSearchTool(
    resolveCandidates,
    (providerName, latencyMs) => {
      registry.recordOutcome(providerName, { success: true, latencyMs });
    },
    config.guidance?.web_search,
    (providerName) => registry.recordOutcome(providerName, { success: false }),
    (providerName, resultCount, requestedCount) => {
      registry.recordResultQuality(providerName, resultCount, requestedCount);
    },
  ),
);
```

with:

```typescript
pi.registerTool(
  createWebSearchTool(
    resolveCandidates,
    (providerName, latencyMs) => {
      registry.recordOutcome(providerName, { success: true, latencyMs });
    },
    configManager.current.guidance?.web_search,
    (providerName) => registry.recordOutcome(providerName, { success: false }),
    (providerName, resultCount, requestedCount) => {
      registry.recordResultQuality(providerName, resultCount, requestedCount);
    },
  ),
);
```

Replace the web_fetch tool registration (lines 96-105):

```typescript
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
```

with:

```typescript
const fetchCache = new ContentCache(200, 5 * 60_000);
pi.registerTool(
  createWebFetchTool(
    store,
    () => {
      configManager.refresh();
      return registry.selectFetchCandidates();
    },
    fetchCache,
    configManager.current.guidance?.web_fetch,
    configManager.current.github,
  ),
);
```

Replace the web_read tool registration (line 106):

```typescript
pi.registerTool(createWebReadTool(store, config.guidance?.web_read));
```

with:

```typescript
pi.registerTool(
  createWebReadTool(store, configManager.current.guidance?.web_read),
);
```

Replace the code_search tool registration (lines 107-114):

```typescript
pi.registerTool(
  createCodeSearchTool(
    () => registry.selectCodeSearch(),
    (providerName) => registry.recordOutcome(providerName, { success: true }),
    config.guidance?.code_search,
  ),
);
```

with:

```typescript
pi.registerTool(
  createCodeSearchTool(
    () => {
      configManager.refresh();
      return registry.selectCodeSearch();
    },
    (providerName) => registry.recordOutcome(providerName, { success: true }),
    configManager.current.guidance?.code_search,
  ),
);
```

Replace the docs tool registration (lines 117-132):

```typescript
const docsProvider = registry.selectDocs();
if (docsProvider) {
  pi.registerTool(
    createWebDocsSearchTool(
      () => docsProvider,
      config.guidance?.web_docs_search,
    ),
  );
  pi.registerTool(
    createWebDocsFetchTool(
      () => docsProvider,
      store,
      config.guidance?.web_docs_fetch,
    ),
  );
}
```

with:

```typescript
const docsProvider = registry.selectDocs();
if (docsProvider) {
  pi.registerTool(
    createWebDocsSearchTool(() => {
      configManager.refresh();
      return registry.selectDocs() ?? docsProvider;
    }, configManager.current.guidance?.web_docs_search),
  );
  pi.registerTool(
    createWebDocsFetchTool(
      () => {
        configManager.refresh();
        return registry.selectDocs() ?? docsProvider;
      },
      store,
      configManager.current.guidance?.web_docs_fetch,
    ),
  );
}
```

- [ ] **Step 6: Update /tools command registration to wire onReload**

Replace lines 134-146:

```typescript
const tierMap = new Map<string, ProviderTier>();
for (const meta of allProviders) {
  tierMap.set(meta.name, meta.tier);
}

const allProviderNames = allProviders.map((m) => m.name);
const toolsCommand = createToolsCommand(registry, tierMap, allProviderNames);
pi.registerCommand(toolsCommand.name, {
  description: toolsCommand.description,
  handler: toolsCommand.handler,
});
```

with:

```typescript
const tierMap = new Map<string, ProviderTier>();
for (const meta of allProviders) {
  tierMap.set(meta.name, meta.tier);
}

const allProviderNames = allProviders.map((m) => m.name);
const toolsCommand = createToolsCommand(
  registry,
  tierMap,
  allProviderNames,
  () => configManager.refresh(true),
);
pi.registerCommand(toolsCommand.name, {
  description: toolsCommand.description,
  handler: toolsCommand.handler,
});
```

- [ ] **Step 7: Verify the complete index.ts**

The final `src/index.ts` should look like this:

```typescript
// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ConfigManager } from "./config-manager.ts";
import { ContentStore, type StoredContent } from "./storage.ts";
import {
  ProviderRegistry,
  createFilePersistence,
} from "./providers/registry.ts";
import { allProviders } from "./providers/all.ts";
import type { ProviderTier } from "./providers/types.ts";
import { createWebSearchTool } from "./tools/web-search.ts";
import { createWebFetchTool } from "./tools/web-fetch.ts";
import { createWebReadTool } from "./tools/web-read.ts";
import { createCodeSearchTool } from "./tools/code-search.ts";
import { createWebDocsSearchTool } from "./tools/web-docs-search.ts";
import { createWebDocsFetchTool } from "./tools/web-docs-fetch.ts";
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
    (d.source === "web_fetch" || d.source === "web_docs_fetch")
  );
}

export default function createExtension(pi: ExtensionAPI): void {
  const store = new ContentStore((customType, data) =>
    pi.appendEntry(customType, data),
  );
  const registry = new ProviderRegistry(createFilePersistence());
  const configManager = new ConfigManager(
    process.cwd(),
    registry,
    allProviders,
  );

  // Restore stored content from previous session
  pi.on("session_start", (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries();
    const restored = entries
      .filter(
        (e) =>
          e.type === "custom" && e.customType === "pi-tools-content" && e.data,
      )
      .map((e) => (e as { data: unknown }).data)
      .filter(isStoredContent);
    if (restored.length > 0) {
      store.restore(restored);
    }
  });

  const resolveCandidates = (name?: string) => {
    configManager.refresh();
    const resolved = name ?? configManager.current.defaultProvider;
    if (configManager.current.selectionStrategy === "best-performing") {
      const provider = registry.selectSearchByPerformance(resolved);
      return provider ? [provider] : [];
    }
    return registry.selectSearchCandidates(resolved);
  };

  pi.registerTool(
    createWebSearchTool(
      resolveCandidates,
      (providerName, latencyMs) => {
        registry.recordOutcome(providerName, { success: true, latencyMs });
      },
      configManager.current.guidance?.web_search,
      (providerName) =>
        registry.recordOutcome(providerName, { success: false }),
      (providerName, resultCount, requestedCount) => {
        registry.recordResultQuality(providerName, resultCount, requestedCount);
      },
    ),
  );
  const fetchCache = new ContentCache(200, 5 * 60_000);
  pi.registerTool(
    createWebFetchTool(
      store,
      () => {
        configManager.refresh();
        return registry.selectFetchCandidates();
      },
      fetchCache,
      configManager.current.guidance?.web_fetch,
      configManager.current.github,
    ),
  );
  pi.registerTool(
    createWebReadTool(store, configManager.current.guidance?.web_read),
  );
  pi.registerTool(
    createCodeSearchTool(
      () => {
        configManager.refresh();
        return registry.selectCodeSearch();
      },
      (providerName) => registry.recordOutcome(providerName, { success: true }),
      configManager.current.guidance?.code_search,
    ),
  );

  // Register docs tools when Context7 provider is available
  const docsProvider = registry.selectDocs();
  if (docsProvider) {
    pi.registerTool(
      createWebDocsSearchTool(() => {
        configManager.refresh();
        return registry.selectDocs() ?? docsProvider;
      }, configManager.current.guidance?.web_docs_search),
    );
    pi.registerTool(
      createWebDocsFetchTool(
        () => {
          configManager.refresh();
          return registry.selectDocs() ?? docsProvider;
        },
        store,
        configManager.current.guidance?.web_docs_fetch,
      ),
    );
  }

  // Build tier map for status display
  const tierMap = new Map<string, ProviderTier>();
  for (const meta of allProviders) {
    tierMap.set(meta.name, meta.tier);
  }

  // Register /tools command
  const allProviderNames = allProviders.map((m) => m.name);
  const toolsCommand = createToolsCommand(
    registry,
    tierMap,
    allProviderNames,
    () => configManager.refresh(true),
  );
  pi.registerCommand(toolsCommand.name, {
    description: toolsCommand.description,
    handler: toolsCommand.handler,
  });
}
```

- [ ] **Step 8: Run full test suite**

Run: `pnpm vitest run`

Expected: All tests pass. The existing `tests/index.test.ts` and `tests/index-strategy.test.ts` should still work because they mock `loadMergedConfig` at the module level — verify this. If they fail because `ConfigManager` imports `loadMergedConfig`, the existing mocks should still apply since `ConfigManager` imports from the same `./config.ts` module.

If tests in `tests/index.test.ts` or `tests/index-strategy.test.ts` fail due to the import change (from `loadMergedConfig` to `ConfigManager`), add a mock for `../src/config-manager.ts` that delegates to the already-mocked `loadMergedConfig`:

```typescript
vi.mock("../src/config-manager.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/config-manager.ts")>();
  return actual;
});
```

This should be unnecessary if the existing `vi.mock("../src/config.ts")` covers the transitive import, but check.

- [ ] **Step 9: Run lint and typecheck**

Run: `pnpm biome check src/index.ts src/commands/tools.ts && pnpm tsc --noEmit`

Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add src/index.ts src/commands/tools.ts
git commit -m "feat: wire ConfigManager into extension for auto-reload

Replace static loadMergedConfig with ConfigManager in createExtension.
Tool closures now read configManager.current on each invocation.
Config auto-reloads every 30s; /tools --reload forces immediate refresh.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

- [ ] **Step 11: Run full verification**

Run: `pnpm biome check . && pnpm tsc --noEmit && pnpm vitest run`

Expected: All lint, typecheck, and tests pass. The config auto-reload feature is complete.
