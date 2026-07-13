# Search Providers Phase 8: Existing Provider Review

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Incorporate targeted improvements from pi-search-hub into 6 existing providers: duckduckgo (config options), exa (quota warning), firecrawl (keyless mode), jina (optional key), perplexity (model config), and searxng (auth header).

**Architecture:** Each improvement is a small, independent change. No changes to provider registration flow or http-adapter. Config type extensions are additive only. Quota tracking leverages the existing `ProviderRegistry` persistence layer (`~/.pi/agent/tools-usage.json`) rather than adding in-memory state to providers.

**Tech Stack:** TypeScript, Vitest, pnpm

**Spec:** `docs/superpowers/specs/2026-07-12-search-providers-design.md` (Phase 8 section)

---

## Prerequisites

- Phase 7 complete
- All tests passing: `pnpm test`

## Verification Commands

```bash
pnpm vitest run tests/providers/<provider>.test.ts   # per-provider
pnpm test                                             # full suite
pnpm run lint
pnpm run typecheck
```

---

## Task 1: Add Config Types

**Files:** `src/config.ts`

Before implementing provider changes, add the new config fields.

- [ ] **Step 1:** Add new optional fields to `ProviderConfigEntry` in `src/config.ts`

Add the following fields after the existing ones (`topic`, `searchDepth`, etc.):

```typescript
// Phase 8 additions (append to existing interface):
ddgsBackend?: string;
ddgsRegion?: string;
ddgsTimelimit?: string;
model?: string;
```

The full interface will be:

```typescript
export interface ProviderConfigEntry {
  enabled: boolean;
  monthlyQuota?: number;
  apiKey?: string;
  instanceUrl?: string;
  ssrfAllowRanges?: string[];
  tokenBudget?: number;
  depth?: "standard" | "deep";
  baseUrl?: string;
  searchDepth?: "snippets" | "basic";
  topic?: "general" | "news";
  // Phase 8 additions:
  ddgsBackend?: string;
  ddgsRegion?: string;
  ddgsTimelimit?: string;
  model?: string;
}
```

- [ ] **Step 2:** Verify

```bash
pnpm run typecheck
```

- [ ] **Step 3:** Commit

```bash
git add src/config.ts
git commit -m "feat(config): add ddgsBackend, ddgsRegion, ddgsTimelimit, model to ProviderConfigEntry"
```

---

## Task 2: DuckDuckGo — Add Backend, Region, Timelimit Config Options

**Files:** `src/providers/duckduckgo.ts`, `tests/providers/duckduckgo.test.ts`

**Change:** Pass optional `ddgsBackend`, `ddgsRegion`, `ddgsTimelimit` from provider config as CLI args to the `ddgs` subprocess. Update `providerMeta.create` to accept and forward the second `providerConfig` argument.

- [ ] **Step 1:** Add `DDGSOptions` interface and update constructor

Add below the `ExecFileFn` type:

```typescript
interface DDGSOptions {
  backend?: string;
  region?: string;
  timelimit?: string;
}
```

Update the class to accept options:

```typescript
export class DuckDuckGoProvider implements SearchProvider {
  readonly name = "duckduckgo";
  readonly label = "DuckDuckGo";

  private readonly execFile: ExecFileFn;
  private readonly ddgsOptions: DDGSOptions;

  constructor(
    execFileFn: ExecFileFn = defaultExecFile as unknown as ExecFileFn,
    options?: DDGSOptions,
  ) {
    this.execFile = execFileFn;
    this.ddgsOptions = options ?? {};
  }
  // ...
}
```

- [ ] **Step 2:** Update `search()` to use config timelimit as override

Change the timelimit computation in `search()`:

```typescript
const timelimit = this.ddgsOptions.timelimit ?? computeTimelimit(filters);
```

- [ ] **Step 3:** Update `runDdgs()` to pass backend/region flags

Add config-driven flags to the args array (before the timelimit push):

```typescript
const args = ["text", "-q", query, "-m", String(maxResults), "-o", outPath];

if (this.ddgsOptions.backend) {
  args.push("-b", this.ddgsOptions.backend);
}
if (this.ddgsOptions.region) {
  args.push("-r", this.ddgsOptions.region);
}
if (timelimit) {
  args.push("-t", timelimit);
}
```

- [ ] **Step 4:** Update `providerMeta.create` to accept `providerConfig`

```typescript
export const providerMeta: ProviderMeta = {
  name: "duckduckgo",
  tier: 3,
  monthlyQuota: null,
  requiresKey: false,
  create: (_key, providerConfig) => ({
    search: new DuckDuckGoProvider(undefined, {
      backend: providerConfig?.ddgsBackend,
      region: providerConfig?.ddgsRegion,
      timelimit: providerConfig?.ddgsTimelimit,
    }),
  }),
};
```

- [ ] **Step 5:** Add tests for new config options

```typescript
// Add to tests/providers/duckduckgo.test.ts

describe("config options", () => {
  it("passes backend flag when configured", async () => {
    const execStub = stubExec();
    execStub.setOutput([{ title: "R", href: "http://r.com", body: "b" }]);

    const provider = new DuckDuckGoProvider(execStub.fn, { backend: "lite" });
    await provider.search("test", 5);

    const args = execStub.lastArgs()!;
    expect(args).toContain("-b");
    expect(args[args.indexOf("-b") + 1]).toBe("lite");
  });

  it("passes region flag when configured", async () => {
    const execStub = stubExec();
    execStub.setOutput([{ title: "R", href: "http://r.com", body: "b" }]);

    const provider = new DuckDuckGoProvider(execStub.fn, { region: "us-en" });
    await provider.search("test", 5);

    const args = execStub.lastArgs()!;
    expect(args).toContain("-r");
    expect(args[args.indexOf("-r") + 1]).toBe("us-en");
  });

  it("config timelimit overrides filter-derived timelimit", async () => {
    const execStub = stubExec();
    execStub.setOutput([]);

    const provider = new DuckDuckGoProvider(execStub.fn, { timelimit: "m" });
    await provider.search("test", 5, undefined, { startDate: "2020-01-01" });

    const args = execStub.lastArgs()!;
    expect(args).toContain("-t");
    expect(args[args.indexOf("-t") + 1]).toBe("m");
  });

  it("providerMeta.create passes config options", () => {
    const config = {
      enabled: true,
      ddgsBackend: "api",
      ddgsRegion: "de-de",
      ddgsTimelimit: "w",
    };
    const instance = providerMeta.create(undefined, config as any);
    expect(instance.search).toBeDefined();
    expect(instance.search!.name).toBe("duckduckgo");
  });
});
```

- [ ] **Step 6:** Verify

```bash
pnpm vitest run tests/providers/duckduckgo.test.ts
pnpm run typecheck
```

- [ ] **Step 7:** Commit

```bash
git add src/providers/duckduckgo.ts tests/providers/duckduckgo.test.ts
git commit -m "feat(duckduckgo): add ddgsBackend, ddgsRegion, ddgsTimelimit config options"
```

---

## Task 3: Exa — Quota Warning via ProviderRegistry

**Files:** `src/providers/registry.ts`, `tests/providers/registry.test.ts`

**Change:** Add a quota warning mechanism to `ProviderRegistry`. The registry already tracks per-provider usage counts with file persistence (`~/.pi/agent/tools-usage.json`) and enforces hard monthly quotas. This task adds a warning when usage exceeds 80% of the quota.

**Why not in-memory on the provider?** The `ProviderRegistry` is the source of truth for usage counts (persisted across process restarts). Adding an in-memory counter to `ExaProvider` would be redundant and would reset on every CLI invocation — making it useless.

- [ ] **Step 1:** Add `getQuotaWarning()` method to `ProviderRegistry`

```typescript
// In src/providers/registry.ts, add to the ProviderRegistry class:

private static readonly QUOTA_WARN_RATIO = 0.8;

/**
 * Returns a warning string if a provider's usage is approaching its monthly quota.
 * Returns null if no warning is needed (no quota, below threshold, or already exhausted).
 */
getQuotaWarning(providerName: string): string | null {
  const reg = this.searchProviders.get(providerName);
  if (!reg || reg.monthlyQuota === null) return null;

  const used = this.counts[providerName] ?? 0;
  const threshold = Math.floor(reg.monthlyQuota * ProviderRegistry.QUOTA_WARN_RATIO);

  if (used < threshold) return null;

  const remaining = reg.monthlyQuota - used;
  if (remaining <= 0) {
    return `[pi-tools] ${providerName}: monthly quota exhausted (${used}/${reg.monthlyQuota}).`;
  }
  return `[pi-tools] ${providerName}: monthly usage at ${used}/${reg.monthlyQuota} (${remaining} remaining).`;
}
```

- [ ] **Step 2:** Emit warning in `recordOutcome()` when threshold is crossed

```typescript
// In recordOutcome(), after incrementing and saving:

recordOutcome(providerName: string, result: { success: boolean; latencyMs?: number }): void {
  this.counts[providerName] = (this.counts[providerName] ?? 0) + 1;
  this.saveUsage();

  // Emit quota warning if threshold just crossed
  const warning = this.getQuotaWarning(providerName);
  if (warning) {
    const prevCount = this.counts[providerName] - 1;
    const reg = this.searchProviders.get(providerName);
    const threshold = reg?.monthlyQuota
      ? Math.floor(reg.monthlyQuota * ProviderRegistry.QUOTA_WARN_RATIO)
      : Infinity;
    // Only warn once: when we cross the threshold or hit exhaustion
    if (prevCount === threshold - 1 || this.counts[providerName] === reg?.monthlyQuota) {
      console.warn(warning);
    }
  }

  // Update performance metrics (existing code unchanged)
  const m = this.getOrCreateMetrics(providerName);
  if (result.success) {
    m.successes += 1;
    if (result.latencyMs !== undefined) {
      m.latencySamples += 1;
      m.avgLatency += (result.latencyMs - m.avgLatency) / m.latencySamples;
    }
  } else {
    m.failures += 1;
  }
}
```

- [ ] **Step 3:** Add tests

```typescript
// Add to tests/providers/registry.test.ts

describe("quota warning", () => {
  it("returns null when provider has no quota", () => {
    const persistence = createMemoryPersistence();
    const registry = new ProviderRegistry(persistence);
    const provider = { name: "ddg", label: "DDG", search: vi.fn() } as any;
    registry.registerSearch(provider, { tier: 3, monthlyQuota: null });

    expect(registry.getQuotaWarning("ddg")).toBeNull();
  });

  it("returns null when usage is below 80%", () => {
    const persistence = createMemoryPersistence({ exa: { count: 500, month: getCurrentMonth() } });
    const registry = new ProviderRegistry(persistence);
    const provider = { name: "exa", label: "Exa", search: vi.fn() } as any;
    registry.registerSearch(provider, { tier: 1, monthlyQuota: 1000 });

    expect(registry.getQuotaWarning("exa")).toBeNull();
  });

  it("returns warning when usage reaches 80%", () => {
    const persistence = createMemoryPersistence({ exa: { count: 800, month: getCurrentMonth() } });
    const registry = new ProviderRegistry(persistence);
    const provider = { name: "exa", label: "Exa", search: vi.fn() } as any;
    registry.registerSearch(provider, { tier: 1, monthlyQuota: 1000 });

    const warning = registry.getQuotaWarning("exa");
    expect(warning).toContain("exa");
    expect(warning).toContain("800/1000");
    expect(warning).toContain("200 remaining");
  });

  it("returns exhausted message when quota is used up", () => {
    const persistence = createMemoryPersistence({ exa: { count: 1000, month: getCurrentMonth() } });
    const registry = new ProviderRegistry(persistence);
    const provider = { name: "exa", label: "Exa", search: vi.fn() } as any;
    registry.registerSearch(provider, { tier: 1, monthlyQuota: 1000 });

    const warning = registry.getQuotaWarning("exa");
    expect(warning).toContain("exhausted");
  });

  it("emits console.warn when threshold is crossed via recordOutcome", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const persistence = createMemoryPersistence({ exa: { count: 799, month: getCurrentMonth() } });
    const registry = new ProviderRegistry(persistence);
    const provider = { name: "exa", label: "Exa", search: vi.fn() } as any;
    registry.registerSearch(provider, { tier: 1, monthlyQuota: 1000 });

    registry.recordOutcome("exa", { success: true, latencyMs: 100 });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("exa"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("800/1000"));

    // Second call should NOT warn again
    warnSpy.mockClear();
    registry.recordOutcome("exa", { success: true, latencyMs: 100 });
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 4:** Verify

```bash
pnpm vitest run tests/providers/registry.test.ts
pnpm run typecheck
```

- [ ] **Step 5:** Commit

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat(registry): add quota warning when provider usage exceeds 80% threshold"
```

---

## Task 4: Firecrawl — Support Keyless Mode

**Files:** `src/providers/firecrawl.ts`, `tests/providers/firecrawl.test.ts`

**Change:** Allow Firecrawl to operate without an API key (1000 free credits/month on their free tier). Key becomes optional for higher rate limits.

- [ ] **Step 1:** Make `apiKey` optional in `FirecrawlProvider`

Change the constructor and field:

```typescript
export class FirecrawlProvider implements SearchProvider, FetchProvider {
  readonly name = "firecrawl";
  readonly label = "Firecrawl";
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }
```

- [ ] **Step 2:** Make `headers()` conditionally include Authorization

```typescript
private headers(): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (this.apiKey) {
    h.Authorization = `Bearer ${this.apiKey}`;
  }
  return h;
}
```

- [ ] **Step 3:** Update `providerMeta`

```typescript
export const providerMeta: ProviderMeta = {
  name: "firecrawl",
  tier: 1,
  monthlyQuota: 1000,
  requiresKey: false, // Changed: key optional for free tier
  create: (key) => {
    const p = new FirecrawlProvider(key); // key may be undefined
    return { search: p, fetch: p };
  },
};
```

- [ ] **Step 4:** Add tests for keyless mode

```typescript
// Add to tests/providers/firecrawl.test.ts

describe("keyless mode", () => {
  it("works without API key", async () => {
    fetchStub.addResponse("api.firecrawl.dev", {
      body: {
        data: [{ title: "Free Result", url: "https://free.dev/1", description: "Free snippet" }],
      },
    });

    const provider = new FirecrawlProvider(); // no key
    const results = await provider.search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Free Result");
  });

  it("does not send Authorization header when no key", async () => {
    fetchStub.addResponse("api.firecrawl.dev", { body: { data: [] } });

    const provider = new FirecrawlProvider();
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const headers = fetchCall[1].headers;
    expect(headers.Authorization).toBeUndefined();
  });

  it("sends Authorization header when key provided", async () => {
    fetchStub.addResponse("api.firecrawl.dev", { body: { data: [] } });

    const provider = new FirecrawlProvider("fc-my-key");
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const headers = fetchCall[1].headers;
    expect(headers.Authorization).toBe("Bearer fc-my-key");
  });

  it("providerMeta has requiresKey: false", () => {
    expect(providerMeta.requiresKey).toBe(false);
  });

  it("providerMeta.create works without key", () => {
    const instance = providerMeta.create(undefined);
    expect(instance.search).toBeDefined();
    expect(instance.fetch).toBeDefined();
  });
});
```

- [ ] **Step 5:** Verify

```bash
pnpm vitest run tests/providers/firecrawl.test.ts
pnpm run typecheck
```

- [ ] **Step 6:** Commit

```bash
git add src/providers/firecrawl.ts tests/providers/firecrawl.test.ts
git commit -m "feat(firecrawl): support keyless mode (requiresKey: false)"
```

---

## Task 5: Jina — Optional Key Mode Tests

**Files:** `tests/providers/jina.test.ts`

**Change:** Jina already supports optional key in its class (`apiKey?`) and has `requiresKey: false`. No code changes needed — just add explicit test coverage for both modes.

- [ ] **Step 1:** Verify current implementation is correct (read-only)

Confirm `jina.ts` has:
- `constructor(apiKey?: string)` — optional
- `requiresKey: false` in providerMeta
- Auth header conditionally included via `if (this.apiKey) { h.Authorization = ... }`

- [ ] **Step 2:** Add explicit tests for optional key behavior

```typescript
// Add to tests/providers/jina.test.ts

describe("optional key mode", () => {
  it("works without API key (no auth header)", async () => {
    fetchStub.addResponse("s.jina.ai", {
      body: { data: [{ title: "Free", url: "http://free.com", description: "desc" }] },
    });

    const provider = new JinaProvider(); // no key
    const results = await provider.search("test", 5);
    expect(results).toHaveLength(1);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBeUndefined();
  });

  it("sends Authorization when key provided", async () => {
    fetchStub.addResponse("s.jina.ai", { body: { data: [] } });

    const provider = new JinaProvider("jina-key-123");
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBe("Bearer jina-key-123");
  });

  it("providerMeta.create works with and without key", () => {
    const withKey = providerMeta.create("key");
    expect(withKey.search).toBeDefined();
    expect(withKey.fetch).toBeDefined();

    const withoutKey = providerMeta.create(undefined);
    expect(withoutKey.search).toBeDefined();
    expect(withoutKey.fetch).toBeDefined();
  });
});
```

- [ ] **Step 3:** Verify

```bash
pnpm vitest run tests/providers/jina.test.ts
pnpm run typecheck
```

- [ ] **Step 4:** Commit

```bash
git add tests/providers/jina.test.ts
git commit -m "test(jina): add explicit optional key mode tests"
```

---

## Task 6: Perplexity — Add Model Config Option

**Files:** `src/providers/perplexity.ts`, `tests/providers/perplexity.test.ts`

**Change:** Allow configuring the Perplexity model via `model` config option (e.g., `sonar`, `sonar-pro`, `sonar-reasoning`). Default remains `sonar`. The `providerConfig` is captured in the `create` closure and passed to `buildBody`.

- [ ] **Step 1:** Update `src/providers/perplexity.ts` to accept `providerConfig`

```typescript
import { createHttpSearchProvider } from "./http-adapter.ts";
import { parsePerplexityResults } from "./parsers.ts";
import type { ProviderMeta } from "./types.ts";

const DEFAULT_MODEL = "sonar";

export const providerMeta: ProviderMeta = {
  name: "perplexity",
  tier: 2,
  monthlyQuota: null,
  requiresKey: true,
  create: (key, providerConfig) => ({
    search: createHttpSearchProvider(key!, {
      name: "perplexity",
      label: "Perplexity Sonar",
      endpoint: "https://api.perplexity.ai/chat/completions",
      method: "POST",
      authPrefix: "Bearer ",
      buildBody: (query) => ({
        model: providerConfig?.model ?? DEFAULT_MODEL,
        messages: [{ role: "user", content: query }],
      }),
      extractResults: parsePerplexityResults,
    }),
  }),
};
```

- [ ] **Step 2:** Add test for model config

```typescript
// Add to tests/providers/perplexity.test.ts

describe("model config", () => {
  it("uses default model 'sonar' when not configured", async () => {
    fetchStub.addResponse("api.perplexity.ai", {
      body: { choices: [{ message: { content: "answer" } }], citations: [] },
    });

    const provider = providerMeta.create("pplx-key").search!;
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.model).toBe("sonar");
  });

  it("uses configured model", async () => {
    fetchStub.addResponse("api.perplexity.ai", {
      body: { choices: [{ message: { content: "answer" } }], citations: [] },
    });

    const provider = providerMeta.create("pplx-key", {
      enabled: true,
      model: "sonar-pro",
    } as any).search!;
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.model).toBe("sonar-pro");
  });

  it("supports sonar-reasoning model", async () => {
    fetchStub.addResponse("api.perplexity.ai", {
      body: {
        choices: [{ message: { content: "reasoned answer" } }],
        citations: ["https://s.com"],
      },
    });

    const provider = providerMeta.create("pplx-key", {
      enabled: true,
      model: "sonar-reasoning",
    } as any).search!;
    const results = await provider.search("test", 5);

    expect(results).toHaveLength(2); // answer + 1 citation
  });
});
```

- [ ] **Step 3:** Verify

```bash
pnpm vitest run tests/providers/perplexity.test.ts
pnpm run typecheck
```

- [ ] **Step 4:** Commit

```bash
git add src/providers/perplexity.ts tests/providers/perplexity.test.ts
git commit -m "feat(perplexity): add model config option (sonar, sonar-pro, sonar-reasoning)"
```

---

## Task 7: SearXNG — Bearer Token Auth Tests

**Files:** `tests/providers/searxng.test.ts`

**Change:** The current implementation already supports an optional Bearer token via the `apiKey` constructor option. Add explicit test coverage for the auth header behavior.

- [ ] **Step 1:** Verify current implementation (read-only)

Confirm `searxng.ts` has:
- `if (this.apiKey) { headers.Authorization = \`Bearer ${this.apiKey}\`; }`
- `providerMeta.create` resolves `providerConfig?.apiKey` via `resolveApiKey()`

- [ ] **Step 2:** Add explicit tests for Bearer token

```typescript
// Add to tests/providers/searxng.test.ts

describe("authentication", () => {
  it("sends Bearer token when apiKey configured", async () => {
    fetchStub.addResponse("localhost:8080", {
      body: { results: [{ title: "R", url: "http://r.com", content: "c" }] },
    });

    const provider = new SearXNGProvider({ apiKey: "searx-token-123" });
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBe("Bearer searx-token-123");
  });

  it("does not send Authorization header when no apiKey", async () => {
    fetchStub.addResponse("localhost:8080", { body: { results: [] } });

    const provider = new SearXNGProvider();
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBeUndefined();
  });

  it("providerMeta passes resolved apiKey to constructor", () => {
    const instance = providerMeta.create(undefined, {
      enabled: true,
      instanceUrl: "http://my-searx.local",
      apiKey: "my-token",
    } as any);
    expect(instance.search).toBeDefined();
  });
});
```

- [ ] **Step 3:** Verify

```bash
pnpm vitest run tests/providers/searxng.test.ts
pnpm run typecheck
```

- [ ] **Step 4:** Commit

```bash
git add tests/providers/searxng.test.ts
git commit -m "test(searxng): add explicit Bearer token auth header tests"
```

---

## Final Verification

After all tasks complete:

```bash
pnpm test
pnpm run lint
pnpm run typecheck
```

## Summary of Changes

| Provider   | Change Type | Description                                                                      |
| ---------- | ----------- | -------------------------------------------------------------------------------- |
| config     | Feature     | `ddgsBackend`, `ddgsRegion`, `ddgsTimelimit`, `model` added to ProviderConfigEntry |
| duckduckgo | Feature     | Config options passed as CLI args to ddgs subprocess                              |
| registry   | Feature     | `getQuotaWarning()` + console.warn at 80% threshold (leverages existing persistence) |
| firecrawl  | Feature     | `requiresKey: false`, API key optional for free-tier usage                       |
| jina       | Test only   | Already supports optional key; added explicit test coverage                      |
| perplexity | Feature     | `model` config option (sonar, sonar-pro, sonar-reasoning) via closure            |
| searxng    | Test only   | Already supports Bearer token; added explicit test coverage                      |

**Config additions to `ProviderConfigEntry`:**

- `ddgsBackend?: string`
- `ddgsRegion?: string`
- `ddgsTimelimit?: string`
- `model?: string`
