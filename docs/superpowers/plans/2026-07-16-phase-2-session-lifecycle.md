# Phase 2: Extract Session Lifecycle from index.ts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract session lifecycle logic (content restore, trust recording, OpenAI native rewrite, shutdown cleanup) from `src/index.ts` into a new `src/session.ts` module. index.ts becomes thin wiring — it connects deep modules but contains no business logic.

**Architecture:** `src/session.ts` exports pure functions that accept Pi events + dependencies. `src/index.ts` wires them as `pi.on("event", (event, ctx) => handleX(event, ctx, ...deps))`. Each function is independently testable without mocking the full Pi ExtensionAPI. The `model_select` trust one-liner stays inline in index.ts.

**Tech Stack:** TypeScript (ES2022, Node16 modules), Vitest, Pi ExtensionAPI (`@earendil-works/pi-coding-agent`)

**Spec:** `docs/superpowers/specs/2026-07-16-architecture-deepening-design.md` (Phase 2)

---

### Task 1: Create `src/session.ts` with extracted lifecycle functions

**Files:**
- Create: `src/session.ts`

- [ ] **Step 1: Create `src/session.ts` with all lifecycle functions**

```typescript
// src/session.ts
import type {
  BeforeProviderRequestEvent,
  BeforeProviderRequestEventResult,
  ExtensionContext,
  SessionEntry,
  SessionShutdownEvent,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import type { PiToolsConfig } from "./config.ts";
import {
  isOpenAiNativeModel,
  rewriteNativeWebSearch,
} from "./providers/openai-native-rewrite.ts";
import type { ContentStore, StoredContent } from "./storage.ts";
import { recordProjectTrust } from "./utils/trust.ts";

/** Type guard for validating stored content entries from session restore. */
export function isStoredContent(data: unknown): data is StoredContent {
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

/** Filter valid stored content from session entries and restore into the store. */
export function restoreContent(entries: SessionEntry[], store: ContentStore): void {
  const restored = entries
    .filter((e) => e.type === "custom" && e.customType === "pi-tools-content" && e.data)
    .map((e) => (e as { data: unknown }).data)
    .filter(isStoredContent);
  if (restored.length > 0) {
    store.restore(restored);
  }
}

/**
 * Handle session_start: restore persisted content, record trust, refresh config.
 */
export function handleSessionStart(
  _event: SessionStartEvent,
  ctx: ExtensionContext,
  store: ContentStore,
  refresh: () => void,
  _configGetter: () => PiToolsConfig,
): void {
  const entries = ctx.sessionManager.getEntries();
  restoreContent(entries, store);
  recordProjectTrust(ctx);
  refresh();
}

/**
 * Handle before_provider_request: record trust + OpenAI native web search rewrite.
 * Returns the rewritten payload for OpenAI models, undefined otherwise.
 */
export function handleProviderRequest(
  event: BeforeProviderRequestEvent,
  ctx: ExtensionContext,
  configGetter: () => PiToolsConfig,
): BeforeProviderRequestEventResult | void {
  recordProjectTrust(ctx);

  const config = configGetter();
  const openaiNativeConfig = config.providers["openai-web-search"];
  if (openaiNativeConfig?.enabled === false) return undefined;
  if (!isOpenAiNativeModel(ctx?.model as { provider?: string } | undefined)) return undefined;
  const result = rewriteNativeWebSearch(event.payload as { tools?: unknown[] });
  return result.rewritten.length > 0 ? result.payload : undefined;
}

/**
 * Handle session_shutdown: reset activity monitor.
 */
export function handleSessionShutdown(
  _event: SessionShutdownEvent,
  _ctx: ExtensionContext,
  resetMonitor: () => void,
): void {
  resetMonitor();
}
```

---

### Task 2: Write tests for `src/session.ts`

**Files:**
- Create: `tests/session.test.ts`

- [ ] **Step 2: Create `tests/session.test.ts` with unit tests for all exported functions**

```typescript
import { describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  handleProviderRequest,
  handleSessionShutdown,
  handleSessionStart,
  isStoredContent,
  restoreContent,
} from "../src/session.ts";
import type { PiToolsConfig } from "../src/config.ts";
import { makeCtx } from "./helpers.ts";

describe("isStoredContent", () => {
  it("returns true for valid stored content", () => {
    expect(
      isStoredContent({
        id: "wc-1",
        url: "https://example.com",
        text: "hello",
        chars: 5,
        storedAt: "2026-01-01T00:00:00Z",
        source: "web_fetch",
      }),
    ).toBe(true);
  });

  it("returns true for web_docs_fetch source", () => {
    expect(
      isStoredContent({
        id: "wc-2",
        url: "https://docs.example.com",
        text: "docs",
        chars: 4,
        storedAt: "2026-01-01T00:00:00Z",
        source: "web_docs_fetch",
      }),
    ).toBe(true);
  });

  it("returns false for null", () => {
    expect(isStoredContent(null)).toBe(false);
  });

  it("returns false for non-object", () => {
    expect(isStoredContent("string")).toBe(false);
  });

  it("returns false when id is missing", () => {
    expect(
      isStoredContent({
        url: "https://example.com",
        text: "hello",
        chars: 5,
        storedAt: "2026-01-01T00:00:00Z",
        source: "web_fetch",
      }),
    ).toBe(false);
  });

  it("returns false for invalid source", () => {
    expect(
      isStoredContent({
        id: "wc-1",
        url: "https://example.com",
        text: "hello",
        chars: 5,
        storedAt: "2026-01-01T00:00:00Z",
        source: "unknown",
      }),
    ).toBe(false);
  });

  it("returns false when chars is not a number", () => {
    expect(
      isStoredContent({
        id: "wc-1",
        url: "https://example.com",
        text: "hello",
        chars: "5",
        storedAt: "2026-01-01T00:00:00Z",
        source: "web_fetch",
      }),
    ).toBe(false);
  });
});

describe("restoreContent", () => {
  it("restores valid pi-tools-content entries into the store", () => {
    const store = { restore: vi.fn() };
    const entries = [
      {
        type: "custom" as const,
        id: "e1",
        parentId: null,
        timestamp: "2026-01-01T00:00:00Z",
        customType: "pi-tools-content",
        data: {
          id: "wc-1",
          url: "https://example.com",
          text: "content",
          chars: 7,
          storedAt: "2026-01-01T00:00:00Z",
          source: "web_fetch",
        },
      },
    ] as unknown as SessionEntry[];

    restoreContent(entries, store as any);

    expect(store.restore).toHaveBeenCalledWith([
      {
        id: "wc-1",
        url: "https://example.com",
        text: "content",
        chars: 7,
        storedAt: "2026-01-01T00:00:00Z",
        source: "web_fetch",
      },
    ]);
  });

  it("filters out corrupt entries", () => {
    const store = { restore: vi.fn() };
    const entries = [
      {
        type: "custom" as const,
        id: "e1",
        parentId: null,
        timestamp: "2026-01-01T00:00:00Z",
        customType: "pi-tools-content",
        data: { id: "wc-corrupt", garbage: true },
      },
    ] as unknown as SessionEntry[];

    restoreContent(entries, store as any);

    expect(store.restore).not.toHaveBeenCalled();
  });

  it("filters out non-matching custom types", () => {
    const store = { restore: vi.fn() };
    const entries = [
      {
        type: "custom" as const,
        id: "e1",
        parentId: null,
        timestamp: "2026-01-01T00:00:00Z",
        customType: "other-extension",
        data: { foo: "bar" },
      },
    ] as unknown as SessionEntry[];

    restoreContent(entries, store as any);

    expect(store.restore).not.toHaveBeenCalled();
  });

  it("does not call restore when no valid entries exist", () => {
    const store = { restore: vi.fn() };
    restoreContent([] as unknown as SessionEntry[], store as any);
    expect(store.restore).not.toHaveBeenCalled();
  });
});

describe("handleSessionStart", () => {
  it("restores content, records trust, and refreshes config", () => {
    const store = { restore: vi.fn() };
    const refresh = vi.fn();
    const configGetter = vi.fn();

    const ctx = makeCtx({
      sessionManager: {
        getEntries: () => [
          {
            type: "custom",
            id: "e1",
            parentId: null,
            timestamp: "2026-01-01T00:00:00Z",
            customType: "pi-tools-content",
            data: {
              id: "wc-1",
              url: "https://example.com",
              text: "restored",
              chars: 8,
              storedAt: "2026-01-01T00:00:00Z",
              source: "web_fetch",
            },
          },
        ],
      } as any,
    });

    handleSessionStart(
      { type: "session_start", reason: "resume" },
      ctx,
      store as any,
      refresh,
      configGetter,
    );

    expect(store.restore).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("calls refresh even when no entries to restore", () => {
    const store = { restore: vi.fn() };
    const refresh = vi.fn();
    const configGetter = vi.fn();
    const ctx = makeCtx();

    handleSessionStart(
      { type: "session_start", reason: "startup" },
      ctx,
      store as any,
      refresh,
      configGetter,
    );

    expect(store.restore).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("handleProviderRequest", () => {
  const baseConfig: PiToolsConfig = {
    defaultProvider: "duckduckgo",
    selectionStrategy: "auto",
    providers: {},
    github: { enabled: false, maxRepoSizeMB: 100, cloneTimeoutSeconds: 30 },
    ssrf: { allowRanges: [] },
    combine: { enabled: false, mode: "targeted", targetBackends: 3, k: 10 },
    deepResearch: { enabled: false },
  };

  it("rewrites web_search to native format for OpenAI models", () => {
    const payload = {
      tools: [{ type: "function", function: { name: "web_search", parameters: {} } }],
      messages: [{ role: "user", content: "hello" }],
    };
    const ctx = makeCtx({ model: { provider: "openai" } as any });

    const result = handleProviderRequest(
      { type: "before_provider_request", payload },
      ctx,
      () => baseConfig,
    ) as typeof payload;

    expect(result?.tools?.[0]).toEqual({ type: "web_search", external_web_access: true });
    expect(result?.messages).toEqual(payload.messages);
  });

  it("returns undefined for non-OpenAI models", () => {
    const payload = {
      tools: [{ type: "function", function: { name: "web_search", parameters: {} } }],
    };
    const ctx = makeCtx({ model: { provider: "anthropic" } as any });

    const result = handleProviderRequest(
      { type: "before_provider_request", payload },
      ctx,
      () => baseConfig,
    );

    expect(result).toBeUndefined();
  });

  it("returns undefined when openai-web-search is disabled", () => {
    const config: PiToolsConfig = {
      ...baseConfig,
      providers: { "openai-web-search": { enabled: false } },
    };
    const payload = {
      tools: [{ type: "function", function: { name: "web_search", parameters: {} } }],
    };
    const ctx = makeCtx({ model: { provider: "openai" } as any });

    const result = handleProviderRequest(
      { type: "before_provider_request", payload },
      ctx,
      () => config,
    );

    expect(result).toBeUndefined();
  });

  it("returns undefined when payload has no tools", () => {
    const payload = { messages: [{ role: "user", content: "hello" }] };
    const ctx = makeCtx({ model: { provider: "openai" } as any });

    const result = handleProviderRequest(
      { type: "before_provider_request", payload },
      ctx,
      () => baseConfig,
    );

    expect(result).toBeUndefined();
  });

  it("returns undefined when no web_search tool in payload", () => {
    const payload = {
      tools: [{ type: "function", function: { name: "other_tool", parameters: {} } }],
    };
    const ctx = makeCtx({ model: { provider: "openai" } as any });

    const result = handleProviderRequest(
      { type: "before_provider_request", payload },
      ctx,
      () => baseConfig,
    );

    expect(result).toBeUndefined();
  });
});

describe("handleSessionShutdown", () => {
  it("calls resetMonitor callback", () => {
    const resetMonitor = vi.fn();
    const ctx = makeCtx();

    handleSessionShutdown(
      { type: "session_shutdown", reason: "quit" },
      ctx,
      resetMonitor,
    );

    expect(resetMonitor).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run session tests to verify they pass**

```bash
pnpm vitest run tests/session.test.ts
```

Expected: all tests PASS.

---

### Task 3: Update `src/index.ts` to use `src/session.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 4: Replace imports and remove `isStoredContent` from `src/index.ts`**

Replace the top of `src/index.ts` (lines 1-36) with:

```typescript
// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ContentCache } from "./cache.ts";
import { createToolsCommand } from "./commands/tools.ts";
import { ConfigManager } from "./config-manager.ts";
import { allProviders } from "./providers/all.ts";
import { createFilePersistence, ProviderRegistry } from "./providers/registry.ts";
import type { ProviderTier } from "./providers/types.ts";
import { ContentStore } from "./storage.ts";
import { createCodeSearchTool } from "./tools/code-search.ts";
import { createWebDocsFetchTool } from "./tools/web-docs-fetch.ts";
import { createWebDocsSearchTool } from "./tools/web-docs-search.ts";
import { createWebFetchTool } from "./tools/web-fetch.ts";
import { createWebReadTool } from "./tools/web-read.ts";
import { createWebResearchTool } from "./tools/web-research.ts";
import { createWebSearchTool } from "./tools/web-search.ts";
import { resolveApiKey } from "./config.ts";
import { buildAugmentedGuidance, detectCapabilities } from "./utils/capabilities.ts";
import { recordProjectTrust } from "./utils/trust.ts";
import {
  handleProviderRequest,
  handleSessionShutdown,
  handleSessionStart,
} from "./session.ts";
```

- [ ] **Step 5: Replace the lifecycle event handlers in `createExtension`**

Replace the event handler block (lines 46-76 in the original file, the section from the `// Restore stored content` comment through the OpenAI native rewrite handler) with:

```typescript
  // Session lifecycle — delegated to session.ts
  pi.on("session_start", (event, ctx) =>
    handleSessionStart(event, ctx, store, () => configManager.refresh(), () => configManager.current),
  );
  pi.on("model_select", (_event, ctx) => {
    recordProjectTrust(ctx);
  });
  pi.on("before_provider_request", (event, ctx) =>
    handleProviderRequest(event, ctx, () => configManager.current),
  );
```

- [ ] **Step 6: Replace the `session_shutdown` handler**

Replace lines 184-187 (the session_shutdown block) with:

```typescript
  // Session lifecycle: reset activity monitor on session boundaries
  pi.on("session_shutdown", (event, ctx) =>
    handleSessionShutdown(event, ctx, () => toolsCommand.resetMonitor()),
  );
```

The final `src/index.ts` should look like this:

```typescript
// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ContentCache } from "./cache.ts";
import { createToolsCommand } from "./commands/tools.ts";
import { ConfigManager } from "./config-manager.ts";
import { allProviders } from "./providers/all.ts";
import { createFilePersistence, ProviderRegistry } from "./providers/registry.ts";
import type { ProviderTier } from "./providers/types.ts";
import { ContentStore } from "./storage.ts";
import { createCodeSearchTool } from "./tools/code-search.ts";
import { createWebDocsFetchTool } from "./tools/web-docs-fetch.ts";
import { createWebDocsSearchTool } from "./tools/web-docs-search.ts";
import { createWebFetchTool } from "./tools/web-fetch.ts";
import { createWebReadTool } from "./tools/web-read.ts";
import { createWebResearchTool } from "./tools/web-research.ts";
import { createWebSearchTool } from "./tools/web-search.ts";
import { resolveApiKey } from "./config.ts";
import { buildAugmentedGuidance, detectCapabilities } from "./utils/capabilities.ts";
import { recordProjectTrust } from "./utils/trust.ts";
import {
  handleProviderRequest,
  handleSessionShutdown,
  handleSessionStart,
} from "./session.ts";

export default function createExtension(pi: ExtensionAPI): void {
  const store = new ContentStore((customType, data) => pi.appendEntry(customType, data));
  const registry = new ProviderRegistry(createFilePersistence());
  const configManager = new ConfigManager(process.cwd(), registry, allProviders);

  // Detect environment capabilities once at startup
  const caps = detectCapabilities();

  // Session lifecycle — delegated to session.ts
  pi.on("session_start", (event, ctx) =>
    handleSessionStart(event, ctx, store, () => configManager.refresh(), () => configManager.current),
  );
  pi.on("model_select", (_event, ctx) => {
    recordProjectTrust(ctx);
  });
  pi.on("before_provider_request", (event, ctx) =>
    handleProviderRequest(event, ctx, () => configManager.current),
  );

  const resolveCandidates = (name?: string, combine?: boolean) => {
    configManager.refresh();
    const resolved = name ?? configManager.current.defaultProvider;
    const combineActive = combine ?? configManager.current.combine.enabled;

    if (combineActive) {
      return registry.selectSearchForFusion(configManager.current.selectionStrategy, resolved);
    }

    if (configManager.current.selectionStrategy === "best-performing") {
      const provider = registry.selectSearchByPerformance(resolved);
      return provider ? [provider] : [];
    }
    return registry.selectSearchCandidates(resolved);
  };

  // Guidance values are evaluated once at registration time; changing guidance
  // mid-session requires a restart (dynamic guidance would need 6 factory changes).
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
      configManager.current.combine,
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
      buildAugmentedGuidance(configManager.current.guidance?.web_fetch, caps),
      configManager.current.github,
      configManager.current.ssrf.allowRanges,
      configManager.current.pdf,
      configManager.current.gemini,
    ),
  );
  pi.registerTool(createWebReadTool(store, configManager.current.guidance?.web_read));
  pi.registerTool(
    createCodeSearchTool(
      () => {
        configManager.refresh();
        return registry.selectCodeSearch();
      },
      // Usage tick only — code-search has no failure callback
      (providerName) => registry.recordOutcome(providerName, { success: true }),
      configManager.current.guidance?.code_search,
    ),
  );

  // Register docs tools when Context7 provider is available
  const docsProvider = registry.selectDocs();
  if (docsProvider) {
    const selectDocs = () => {
      configManager.refresh();
      return registry.selectDocs() ?? docsProvider;
    };
    pi.registerTool(
      createWebDocsSearchTool(selectDocs, configManager.current.guidance?.web_docs_search),
    );
    pi.registerTool(
      createWebDocsFetchTool(selectDocs, store, configManager.current.guidance?.web_docs_fetch),
    );
  }

  // Register web_research when Exa key is available and deep research enabled
  const exaConfig = configManager.current.providers?.exa;
  const resolvedExaKey = resolveApiKey(exaConfig?.apiKey);
  if (resolvedExaKey && configManager.current.deepResearch?.enabled !== false) {
    pi.registerTool(
      createWebResearchTool(
        resolvedExaKey,
        configManager.current.deepResearch,
        (customType, data) => pi.appendEntry(customType, data),
        configManager.current.deepResearch?.guidance,
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
  const toolsCommand = createToolsCommand(registry, tierMap, allProviderNames, () =>
    configManager.refresh(true),
  );
  pi.registerCommand(toolsCommand.name, {
    description: toolsCommand.description,
    handler: toolsCommand.handler,
  });

  // Session lifecycle: reset activity monitor on session boundaries
  pi.on("session_shutdown", (event, ctx) =>
    handleSessionShutdown(event, ctx, () => toolsCommand.resetMonitor()),
  );
}
```

---

### Task 4: Update `tests/index.test.ts` handler indices

**Files:**
- Modify: `tests/index.test.ts`

- [ ] **Step 7: Update event handler indices in `tests/index.test.ts`**

With session.ts combining trust recording and OpenAI rewrite into a single `handleProviderRequest`, there is now only **one** `before_provider_request` handler instead of two. The existing tests index into `pi.events.get("before_provider_request")?.[1]` — this must change to `?.[0]`.

Similarly, session_start goes from two handlers (restore + trust) to one combined handler. The restore test at `pi.events.get("session_start")?.[0]` still works since there is exactly one handler.

Replace every occurrence of `pi.events.get("before_provider_request")?.[1]` with `pi.events.get("before_provider_request")?.[0]`:

In the test "rewrites web_search tool to native format for OpenAI models" (around line 177):

```typescript
    // Handler is the combined handleProviderRequest from session.ts
    const handler = pi.events.get("before_provider_request")?.[0];
```

In the test "does not rewrite for non-OpenAI models" (around line 198):

```typescript
    const handler = pi.events.get("before_provider_request")?.[0];
```

In the test "does not rewrite when openai-web-search is disabled in config" (around line 225):

```typescript
    const handler = pi.events.get("before_provider_request")?.[0];
```

---

### Task 5: Verify all tests pass

- [ ] **Step 8: Run both test files together**

```bash
pnpm vitest run tests/index.test.ts tests/session.test.ts
```

Expected: all tests PASS. The session.test.ts tests verify lifecycle logic through the session.ts interface. The index.test.ts tests verify wiring — that handlers are registered and produce correct results.

- [ ] **Step 9: Run full test suite**

```bash
pnpm test
```

Expected: all tests PASS — no regressions.

- [ ] **Step 10: Run typecheck and lint**

```bash
pnpm run typecheck && pnpm run lint
```

Expected: no type errors, no lint errors.

---

### Task 6: Commit

- [ ] **Step 11: Commit the changes**

```bash
git add src/session.ts tests/session.test.ts src/index.ts tests/index.test.ts
git commit -m "refactor: extract session lifecycle from index.ts into session.ts

Move content restore, trust recording, OpenAI native rewrite, and
shutdown cleanup into src/session.ts as pure functions. index.ts
becomes thin wiring that connects deep modules.

- handleSessionStart: restore content + trust + config refresh
- handleProviderRequest: trust recording + OpenAI native rewrite
- handleSessionShutdown: reset activity monitor
- isStoredContent, restoreContent: extracted as testable utilities

model_select trust one-liner stays inline in index.ts.

Phase 2 of architecture deepening.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

**Phase 2 complete.** index.ts drops from 188 lines to ~160 lines, and more importantly sheds all lifecycle business logic. Session lifecycle is independently testable through `tests/session.test.ts` without mocking the full Pi ExtensionAPI.
