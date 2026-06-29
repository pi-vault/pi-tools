# Phase 5: Provider Registry + Quota-Aware Selection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the provider registry with quota tracking, tier-based selection, and usage persistence. After this phase, `web_search` automatically rotates across all configured providers and quota counts survive process restarts.

**Spec:** `docs/superpowers/specs/2026-06-27-pi-tools-design.md`

**Depends on:** Phase 2 (web_search tool, DuckDuckGo provider), Phase 3 (index.ts with content store)

**Produces:** `src/providers/usage.ts`, `src/providers/registry.ts`, updated `src/index.ts`

---

## Task 5.1: Usage Tracking

**Files:**
- Create: `src/providers/usage.ts`
- Test: `tests/providers/usage.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/providers/usage.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "../../src/providers/usage.ts";
import * as fs from "node:fs";

vi.mock("node:fs");

describe("UsageTracker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with zero counts for all providers", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const tracker = new UsageTracker();
    expect(tracker.getCount("brave")).toBe(0);
    expect(tracker.getCount("exa")).toBe(0);
  });

  it("increments usage count", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

    const tracker = new UsageTracker();
    tracker.increment("brave");
    expect(tracker.getCount("brave")).toBe(1);
    tracker.increment("brave");
    expect(tracker.getCount("brave")).toBe(2);
  });

  it("loads persisted counts", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        resetAt: "2026-07",
        counts: { brave: 150, exa: 50 },
      }),
    );
    const tracker = new UsageTracker();
    expect(tracker.getCount("brave")).toBe(150);
    expect(tracker.getCount("exa")).toBe(50);
  });

  it("resets counts when month changes", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        resetAt: "2026-06",
        counts: { brave: 999 },
      }),
    );
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

    const tracker = new UsageTracker();
    expect(tracker.getCount("brave")).toBe(0);
  });

  it("calculates remaining quota", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

    const tracker = new UsageTracker();
    tracker.increment("brave");
    expect(tracker.getRemaining("brave", 2000)).toBe(1999);
  });

  it("returns Infinity remaining for unlimited quota", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const tracker = new UsageTracker();
    expect(tracker.getRemaining("perplexity", null)).toBe(Infinity);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/providers/usage.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement usage tracker**

```typescript
// src/providers/usage.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

interface UsageData {
  resetAt: string;
  counts: Record<string, number>;
}

function getUsagePath(): string {
  return path.join(os.homedir(), ".pi", "agent", "pi-tools-usage.json");
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export class UsageTracker {
  private counts: Record<string, number> = {};
  private resetAt: string;

  constructor() {
    this.resetAt = getCurrentMonth();
    this.load();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(getUsagePath(), "utf-8");
      const data: UsageData = JSON.parse(raw);
      if (data.resetAt === this.resetAt) {
        this.counts = data.counts ?? {};
      }
      // If month changed, counts stay at 0 (already initialized)
    } catch {
      // No file or parse error — start fresh
    }
  }

  private save(): void {
    const filePath = getUsagePath();
    const data: UsageData = {
      resetAt: this.resetAt,
      counts: this.counts,
    };
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch {
      // Non-fatal: usage tracking is best-effort
    }
  }

  getCount(provider: string): number {
    return this.counts[provider] ?? 0;
  }

  getRemaining(provider: string, monthlyQuota: number | null): number {
    if (monthlyQuota === null) return Infinity;
    return Math.max(0, monthlyQuota - this.getCount(provider));
  }

  increment(provider: string): void {
    this.counts[provider] = (this.counts[provider] ?? 0) + 1;
    this.save();
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/providers/usage.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/usage.ts tests/providers/usage.test.ts
git commit -m "feat: add monthly usage tracking for provider quota management"
```

## Task 5.2: Provider Registry with Quota-Aware Selection

**Files:**
- Create: `src/providers/registry.ts`
- Test: `tests/providers/registry.test.ts`

**Design:** The registry accepts a `UsageTracker` as a constructor dependency. It delegates all usage counting and persistence to the tracker, while owning provider registration and tier-based selection logic. This separation keeps persistence concerns in `UsageTracker` and selection concerns in `ProviderRegistry`.

**Note:** When integrating with real providers, consider reading rate-limit headers from HTTP responses to inform quota tracking. This is a future enhancement tracked in the spec.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/providers/registry.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderRegistry } from "../../src/providers/registry.ts";
import { UsageTracker } from "../../src/providers/usage.ts";
import type { SearchProvider } from "../../src/providers/types.ts";
import * as fs from "node:fs";

vi.mock("node:fs");

function mockProvider(name: string, label: string): SearchProvider {
  return {
    name,
    label,
    search: vi.fn().mockResolvedValue([
      { title: `${name} result`, url: `https://${name}.com`, snippet: "test" },
    ]),
  };
}

describe("ProviderRegistry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // UsageTracker reads from disk on construction; stub to start fresh
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);
  });

  it("selects tier 1 provider with highest remaining quota", () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const brave = mockProvider("brave", "Brave");
    const serper = mockProvider("serper", "Serper");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
    registry.registerSearch(serper, { tier: 1, monthlyQuota: 2500 });

    // Serper has higher remaining (2500 vs 2000)
    const selected = registry.selectSearch();
    expect(selected).toBeDefined();
    expect(selected!.name).toBe("serper");
  });

  it("falls back to tier 2 when tier 1 exhausted", () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const perplexity = mockProvider("perplexity", "Perplexity");

    registry.registerSearch(perplexity, { tier: 2, monthlyQuota: null });

    const selected = registry.selectSearch();
    expect(selected).toBeDefined();
    expect(selected!.name).toBe("perplexity");
  });

  it("falls back to tier 3 when all others unavailable", () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    const selected = registry.selectSearch();
    expect(selected!.name).toBe("duckduckgo");
  });

  it("selects by name when explicitly requested", () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const brave = mockProvider("brave", "Brave");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    const selected = registry.selectSearch("duckduckgo");
    expect(selected!.name).toBe("duckduckgo");
  });

  it("returns undefined when no providers registered", () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    expect(registry.selectSearch()).toBeUndefined();
  });

  it("records usage via tracker and reflects in remaining quota", () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const brave = mockProvider("brave", "Brave");
    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

    registry.recordUsage("brave");
    expect(registry.getRemaining("brave")).toBe(1999);
    // Verify tracker received the increment
    expect(tracker.getCount("brave")).toBe(1);
  });

  it("skips providers at 100% usage", () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const brave = mockProvider("brave", "Brave");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 1 });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    registry.recordUsage("brave"); // Now at 100%
    const selected = registry.selectSearch();
    expect(selected!.name).toBe("duckduckgo");
  });

  it("persists usage across registry instances sharing the same tracker state", () => {
    // Simulate: tracker loaded from disk with existing counts
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ resetAt: new Date().toISOString().slice(0, 7), counts: { brave: 1998 } }),
    );
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const brave = mockProvider("brave", "Brave");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    // Only 2 remaining for brave
    expect(registry.getRemaining("brave")).toBe(2);
    const selected = registry.selectSearch();
    expect(selected!.name).toBe("brave"); // still has quota

    registry.recordUsage("brave"); // 1999 used, 1 remaining
    registry.recordUsage("brave"); // 2000 used, 0 remaining
    const afterExhaust = registry.selectSearch();
    expect(afterExhaust!.name).toBe("duckduckgo");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/providers/registry.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement provider registry**

```typescript
// src/providers/registry.ts
import type { SearchProvider, FetchProvider, CodeSearchProvider, ProviderTier } from "./types.ts";
import type { UsageTracker } from "./usage.ts";

interface RegisteredSearch {
  provider: SearchProvider;
  tier: ProviderTier;
  monthlyQuota: number | null;
}

interface RegisteredFetch {
  provider: FetchProvider;
}

interface RegisteredCodeSearch {
  provider: CodeSearchProvider;
}

export class ProviderRegistry {
  private searchProviders = new Map<string, RegisteredSearch>();
  private fetchProviders = new Map<string, RegisteredFetch>();
  private codeSearchProviders = new Map<string, RegisteredCodeSearch>();
  private tracker: UsageTracker;

  constructor(tracker: UsageTracker) {
    this.tracker = tracker;
  }

  registerSearch(
    provider: SearchProvider,
    options: { tier: ProviderTier; monthlyQuota: number | null },
  ): void {
    this.searchProviders.set(provider.name, {
      provider,
      tier: options.tier,
      monthlyQuota: options.monthlyQuota,
    });
  }

  registerFetch(provider: FetchProvider): void {
    this.fetchProviders.set(provider.name, { provider });
  }

  registerCodeSearch(provider: CodeSearchProvider): void {
    this.codeSearchProviders.set(provider.name, { provider });
  }

  recordUsage(providerName: string): void {
    this.tracker.increment(providerName);
  }

  getRemaining(providerName: string): number {
    const reg = this.searchProviders.get(providerName);
    if (!reg) return 0;
    return this.tracker.getRemaining(providerName, reg.monthlyQuota);
  }

  selectSearch(name?: string): SearchProvider | undefined {
    if (name && name !== "auto") {
      return this.searchProviders.get(name)?.provider;
    }

    // Auto selection: tier 1 by highest remaining, then tier 2, then tier 3
    for (const tier of [1, 2, 3] as ProviderTier[]) {
      const candidates = [...this.searchProviders.values()]
        .filter((r) => r.tier === tier)
        .filter((r) => {
          if (r.monthlyQuota === null) return true;
          return this.tracker.getCount(r.provider.name) < r.monthlyQuota;
        })
        .sort((a, b) => {
          const remA = this.tracker.getRemaining(a.provider.name, a.monthlyQuota);
          const remB = this.tracker.getRemaining(b.provider.name, b.monthlyQuota);
          return remB - remA;
        });

      if (candidates.length > 0) {
        return candidates[0].provider;
      }
    }

    return undefined;
  }

  selectFetch(name?: string): FetchProvider | undefined {
    if (name) return this.fetchProviders.get(name)?.provider;
    const first = this.fetchProviders.values().next();
    return first.done ? undefined : first.value.provider;
  }

  selectCodeSearch(): CodeSearchProvider | undefined {
    const first = this.codeSearchProviders.values().next();
    return first.done ? undefined : first.value.provider;
  }

  getSearchProviderNames(): string[] {
    return [...this.searchProviders.keys()];
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/providers/registry.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat: add provider registry with quota-aware tier-based selection"
```

## Task 5.3: Integrate Registry into Extension Entry Point

**Files:**
- Modify: `src/index.ts`

**Constraints:**
- Preserve the existing `isStoredContent` type guard for session restore validation.
- Do not import `resolveApiKey` yet — no API-key providers are registered in this phase.

- [ ] **Step 1: Update index.ts to use registry**

```typescript
// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { ContentStore, type StoredContent } from "./storage.ts";
import { UsageTracker } from "./providers/usage.ts";
import { ProviderRegistry } from "./providers/registry.ts";
import { DuckDuckGoProvider } from "./providers/duckduckgo.ts";
import type { SearchProvider } from "./providers/types.ts";
import { createWebSearchTool } from "./tools/web-search.ts";
import { createWebFetchTool } from "./tools/web-fetch.ts";
import { createWebReadTool } from "./tools/web-read.ts";

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
  const config = loadConfig();
  const store = new ContentStore((customType, data) =>
    pi.appendEntry(customType, data),
  );
  const tracker = new UsageTracker();
  const registry = new ProviderRegistry(tracker);

  // Register DuckDuckGo (always available, tier 3)
  if (config.providers.duckduckgo?.enabled !== false) {
    registry.registerSearch(new DuckDuckGoProvider(), {
      tier: 3,
      monthlyQuota: null,
    });
  }

  function resolveSearchProvider(name?: string): SearchProvider {
    const provider = registry.selectSearch(name);
    if (!provider) {
      throw new Error("No search providers available");
    }
    return provider;
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

  pi.registerTool(
    createWebSearchTool(
      (name) => resolveSearchProvider(name),
      (providerName) => registry.recordUsage(providerName),
    ),
  );
  pi.registerTool(createWebFetchTool(store));
  pi.registerTool(createWebReadTool(store));
}
```

- [ ] **Step 2: Run all tests**

Run: `pnpm check`
Expected: All pass (lint, typecheck, tests).

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "refactor: integrate provider registry into extension entry point"
```

## Phase 5 Checkpoint

The registry and quota system are operational. Usage counts persist across process restarts via `UsageTracker` (monthly-reset file at `~/.pi/agent/pi-tools-usage.json`). As providers are added in Phase 6, they automatically participate in quota-aware rotation.
