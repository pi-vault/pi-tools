# Phase 5: Initialize Config from Session Context — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Initialize provider config and register tools from Pi's authoritative session cwd and trust state.

**Architecture:** Keep `ConfigManager` and `ProviderRegistry` unchanged. `handleSessionStart()` records trust before calling a session initializer; `src/index.ts` constructs `ConfigManager(ctx.cwd, ...)` and registers tools from that callback. Tool availability and guidance remain fixed until extension reload.

**Tech Stack:** TypeScript, Vitest, Pi ExtensionAPI 0.80.6+ (`@earendil-works/pi-coding-agent` 0.80.10 installed)

**Spec:** `docs/superpowers/specs/2026-07-16-phase-5-config-lifecycle-design.md`

---

## File Overview

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/session.ts` | Pass the authoritative `ExtensionContext` to session initialization after trust is recorded |
| Modify | `tests/session.test.ts` | Prove trust is recorded before initialization and the context is forwarded |
| Modify | `src/index.ts` | Defer `ConfigManager` construction and tool registration until `session_start` |
| Modify | `tests/index.test.ts` | Prove deferred registration, trusted `ctx.cwd` config, and existing wiring |

`src/config-manager.ts`, `src/providers/registry.ts`, and their tests stay unchanged.

---

### Task 1: Make session initialization explicit

**Files:**
- Modify: `tests/session.test.ts`
- Modify: `src/session.ts`

- [ ] **Step 1: Write the failing trust-order test**

Add this import to `tests/session.test.ts`:

```typescript
import { _resetTrustRegistry, isProjectTrustedCached } from "../src/utils/trust.ts";
```

Add this test inside `describe("handleSessionStart", ...)`:

```typescript
it("records trust before initializing with the session context", () => {
  _resetTrustRegistry();
  const store = { restore: vi.fn() };
  const ctx = makeCtx({
    cwd: "/projects/trusted",
    isProjectTrusted: () => true,
  });
  const initialize = vi.fn(() => {
    expect(isProjectTrustedCached(ctx.cwd)).toBe(true);
  });

  handleSessionStart(
    { type: "session_start", reason: "startup" },
    ctx,
    store as never,
    initialize,
  );

  expect(initialize).toHaveBeenCalledWith(ctx);
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
pnpm vitest run tests/session.test.ts -t "records trust before initializing"
```

Expected: FAIL because `handleSessionStart()` currently calls the callback without `ctx`.

- [ ] **Step 3: Change `handleSessionStart()` to invoke a session initializer**

Replace its comment, signature, and body in `src/session.ts` with:

```typescript
/**
 * Handle session_start: restore persisted content, record trust, initialize session state.
 */
export function handleSessionStart(
  _event: SessionStartEvent,
  ctx: ExtensionContext,
  store: ContentStore,
  initialize: (ctx: ExtensionContext) => void,
): void {
  restoreContent(ctx.sessionManager.getEntries(), store);
  recordProjectTrust(ctx);
  initialize(ctx);
}
```

In the three existing `handleSessionStart` tests, rename the local `refresh`
spy to `initialize` and change the final assertion to:

```typescript
expect(initialize).toHaveBeenCalledWith(ctx);
```

- [ ] **Step 4: Run the session tests**

Run:

```bash
pnpm vitest run tests/session.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the session contract**

```bash
git add src/session.ts tests/session.test.ts
git commit -m "refactor: initialize sessions after recording trust"
```

---

### Task 2: Defer config and tool initialization

**Files:**
- Modify: `tests/index.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add a test helper for Pi's awaited `session_start` contract**

Change the test imports to include `node:path`, `MockPi`, and the trust reset:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import createExtension from "../src/index.ts";
import { ProviderRegistry } from "../src/providers/registry.ts";
import { _resetTrustRegistry } from "../src/utils/trust.ts";
import { createMockPi, makeCtx, type MockPi } from "./helpers.ts";
```

Add this helper below `vi.mock("node:fs")`:

```typescript
function startSession(pi: MockPi, ctx = makeCtx()): void {
  const handler = pi.events.get("session_start")?.[0];
  expect(handler).toBeDefined();
  handler?.({ type: "session_start", reason: "startup" }, ctx);
}
```

- [ ] **Step 2: Write the failing deferred-registration test**

Add this test inside `describe("tools extension", ...)`:

```typescript
it("defers config-dependent tools until session_start", () => {
  const pi = createMockPi();
  createExtension(pi as never);

  expect(pi.tools).toEqual([]);

  startSession(pi);

  expect(pi.tools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining(["web_search", "web_fetch", "web_read", "code_search"]),
  );
});
```

- [ ] **Step 3: Write the failing trusted-cwd conditional-tool test**

Add this test inside `describe("tools extension", ...)`:

```typescript
it("uses trusted ctx.cwd config for conditional tools", () => {
  _resetTrustRegistry();
  vi.stubEnv("EXA_API_KEY", "");
  vi.stubEnv("CONTEXT7_API_KEY", "");

  try {
    const cwd = "/projects/trusted";
    const configPath = path.join(cwd, ".pi", "tools.json");
    vi.mocked(fs.existsSync).mockImplementation((candidate) => candidate === configPath);
    vi.mocked(fs.readFileSync).mockImplementation((candidate) => {
      const filePath = typeof candidate === "string" ? candidate : candidate.toString();
      if (filePath === configPath) {
        return JSON.stringify({
          providers: {
            exa: { enabled: true, apiKey: "literal-exa-key" },
            context7: { enabled: true, apiKey: "literal-context7-key" },
          },
          deepResearch: { enabled: true },
        });
      }
      throw new Error("ENOENT");
    });

    const untrustedPi = createMockPi();
    createExtension(untrustedPi as never);
    startSession(untrustedPi, makeCtx({ cwd, isProjectTrusted: () => false }));
    expect(untrustedPi.tools.map((tool) => tool.name)).not.toContain("web_research");
    expect(untrustedPi.tools.map((tool) => tool.name)).not.toContain("web_docs_search");

    const trustedPi = createMockPi();
    createExtension(trustedPi as never);
    startSession(trustedPi, makeCtx({ cwd, isProjectTrusted: () => true }));
    expect(trustedPi.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["web_research", "web_docs_search", "web_docs_fetch"]),
    );
  } finally {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    _resetTrustRegistry();
  }
});
```

- [ ] **Step 4: Run the new tests and verify they fail**

Run:

```bash
pnpm vitest run tests/index.test.ts -t "defers config-dependent tools|uses trusted ctx.cwd"
```

Expected: both tests FAIL. Tools are currently registered by the factory, and
the factory-time manager cannot load the trusted config for `ctx.cwd`.

- [ ] **Step 5: Defer config construction and tool registration in `src/index.ts`**

Add `ExtensionContext` to the Pi type import:

```typescript
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
```

Inside `createExtension()`, keep `store`, `registry`, capabilities, and the fetch
cache as factory-time state. Replace eager manager construction and the current
tool-registration block with this structure; existing tool behavior stays the
same inside `initializeSession`:

```typescript
const store = new ContentStore((customType, data) => pi.appendEntry(customType, data));
const registry = new ProviderRegistry(createFilePersistence());
const caps = detectCapabilities();
const fetchCache = new ContentCache(200, 5 * 60_000);
let configManager: ConfigManager;

const initializeSession = (ctx: ExtensionContext): void => {
  configManager = new ConfigManager(ctx.cwd, registry, allProviders);

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
  pi.registerTool(
    createWebFetchTool(
      store,
      () => {
        configManager.refresh();
        return registry.selectFetchCandidates();
      },
      fetchCache,
      buildAugmentedGuidance(configManager.current.guidance?.web_fetch, caps),
    ),
  );
  pi.registerTool(createWebReadTool(store, configManager.current.guidance?.web_read));
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
};
```

Register the lifecycle handlers after this callback is defined:

```typescript
pi.on("session_start", (event, ctx) =>
  handleSessionStart(event, ctx, store, initializeSession),
);
pi.on("model_select", (_event, ctx) => {
  recordProjectTrust(ctx);
});
pi.on("before_provider_request", (event, ctx) =>
  handleProviderRequest(event, ctx, () => configManager.current),
);
```

Keep the tier map, `/tools` command, and `session_shutdown` wiring at factory
scope. Its reload callback remains:

```typescript
() => configManager.refresh(true)
```

Remove the old `new ConfigManager(process.cwd(), ...)`, factory-scoped
`resolveCandidates`, and factory-scoped tool registrations.

- [ ] **Step 6: Update existing index tests to start the session before tool use**

For the four simple registration tests, use this complete pattern with the
existing expected tool name:

```typescript
const pi = createMockPi();
createExtension(pi as never);
startSession(pi);
expect(pi.tools.some((tool) => tool.name === "web_search")).toBe(true);
```

Apply it to `web_search`, `web_read`, `web_fetch`, and `code_search`.

The content-restoration tests already invoke `session_start`; leave those calls
in place. In each `before_provider_request` test, call `startSession(pi, ctx)`
after creating `ctx` and before invoking the provider-request handler. In each
`defaultProvider wiring` test, create `ctx`, call `startSession(pi, ctx)`, then
look up and execute `web_search`.

- [ ] **Step 7: Run lifecycle tests**

Run:

```bash
pnpm vitest run tests/session.test.ts tests/index.test.ts tests/config-manager.test.ts
```

Expected: PASS. Existing `ConfigManager` behavior remains covered without
moving its tests or implementation.

- [ ] **Step 8: Typecheck the deferred callback wiring**

Run:

```bash
pnpm run typecheck
```

Expected: PASS with no uninitialized-variable or callback-signature errors.

- [ ] **Step 9: Commit the lifecycle change**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "fix: initialize config from session context"
```

---

### Task 3: Verify the complete phase

**Files:** None

- [ ] **Step 1: Run the repository check**

```bash
pnpm check
```

Expected: Biome lint, TypeScript typecheck, and the full Vitest suite all PASS.

- [ ] **Step 2: Check the final diff**

```bash
git diff --check master...HEAD
git status --short
```

Expected: no whitespace errors and a clean worktree. The implementation diff
contains only `src/session.ts`, `tests/session.test.ts`, `src/index.ts`, and
`tests/index.test.ts` beyond the committed design/plan documentation.

---

## Explicitly Skipped

- Deleting or absorbing `ConfigManager`.
- Changing `ProviderRegistry`.
- Dynamic conditional-tool activation after `/tools reload`.
- Dynamic guidance updates.
- Extraction modules that independently resolve config from `process.cwd()`.
- Pi compatibility shims below version 0.80.6.
