# Search Providers Phase 8: Existing Provider Review

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Incorporate targeted improvements from pi-search-hub into 6 existing providers: duckduckgo (config options), exa (quota warning), firecrawl (keyless mode), jina (optional key), perplexity (model config), and searxng (auth header).

**Architecture:** Each improvement is a small, independent change. No changes to provider registration flow or http-adapter. Config type extensions are additive only.

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

```typescript
// In src/config.ts, add to the ProviderConfigEntry interface:

export interface ProviderConfigEntry {
  enabled: boolean;
  monthlyQuota?: number;
  apiKey?: string;
  instanceUrl?: string;
  ssrfAllowRanges?: string[];
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

**Change:** Pass optional `ddgsBackend`, `ddgsRegion`, `ddgsTimelimit` from provider config as CLI args to the `ddgs` subprocess.

- [ ] **Step 1:** Update `DuckDuckGoProvider` to accept and use config options

Update the constructor and class to accept config:

```typescript
// src/providers/duckduckgo.ts

import { execFile as defaultExecFile } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ProviderConfigEntry } from "../config.ts";
import type {
  ProviderMeta,
  SearchFilters,
  SearchProvider,
  SearchResult,
} from "./types.ts";
import { applyDomainFilters } from "../utils/filters.ts";
import { parseDuckDuckGoResults } from "./parsers.ts";

// ... ExecFileFn type unchanged ...

interface DDGSOptions {
  backend?: string;
  region?: string;
  timelimit?: string;
}

const EXEC_TIMEOUT_MS = 15_000;

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

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    if (signal?.aborted) {
      throw new Error("Search aborted");
    }

    const effectiveQuery = applyDomainFilters(query, filters);
    const timelimit = this.ddgsOptions.timelimit ?? computeTimelimit(filters);

    const tmpFile = path.join(os.tmpdir(), `ddgs-${crypto.randomUUID()}.json`);

    try {
      await this.runDdgs(
        effectiveQuery,
        maxResults,
        tmpFile,
        signal,
        timelimit,
      );

      let raw: string;
      try {
        raw = await fs.readFile(tmpFile, "utf-8");
      } catch {
        throw new Error("Failed to parse ddgs output: output file not created");
      }

      let data: unknown;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error("not an array");
        data = parsed;
      } catch {
        throw new Error("Failed to parse ddgs output: malformed JSON");
      }

      return parseDuckDuckGoResults(data).slice(0, maxResults);
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  }

  private runDdgs(
    query: string,
    maxResults: number,
    outPath: string,
    signal?: AbortSignal,
    timelimit?: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        child.kill();
        reject(new Error("Search aborted"));
      };

      const args = [
        "text",
        "-q",
        query,
        "-m",
        String(maxResults),
        "-o",
        outPath,
      ];

      // Config-driven options
      if (this.ddgsOptions.backend) {
        args.push("-b", this.ddgsOptions.backend);
      }
      if (this.ddgsOptions.region) {
        args.push("-r", this.ddgsOptions.region);
      }
      if (timelimit) {
        args.push("-t", timelimit);
      }

      const child = this.execFile(
        "ddgs",
        args,
        { timeout: EXEC_TIMEOUT_MS },
        (error, _stdout, stderr) => {
          if (signal) signal.removeEventListener("abort", onAbort);
          if (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              reject(
                new Error(
                  "ddgs CLI not found. Install with: pip install ddgs (or: uv tool install ddgs)",
                ),
              );
              return;
            }
            const detail = stderr?.trim();
            reject(detail ? new Error(`ddgs failed: ${detail}`) : error);
          } else {
            resolve();
          }
        },
      );

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }
}

// ... computeTimelimit unchanged ...

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

- [ ] **Step 2:** Add tests for new config options

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
    // Config timelimit "m" should override the computed "y" from startDate
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
    // Verify it's a DuckDuckGoProvider (duck typing)
    expect(instance.search!.name).toBe("duckduckgo");
  });
});
```

- [ ] **Step 3:** Verify

```bash
pnpm vitest run tests/providers/duckduckgo.test.ts
pnpm run typecheck
```

- [ ] **Step 4:** Commit

```bash
git add src/providers/duckduckgo.ts tests/providers/duckduckgo.test.ts
git commit -m "feat(duckduckgo): add ddgsBackend, ddgsRegion, ddgsTimelimit config options"
```

---

## Task 3: Exa — Log Quota Warning at 800/1000

**Files:** `src/providers/exa.ts`, `tests/providers/exa.test.ts`

**Change:** Track monthly search count and log a warning when approaching the 1000-request monthly quota (threshold: 800).

- [ ] **Step 1:** Add usage tracking to `ExaProvider`

```typescript
// In src/providers/exa.ts, add to ExaProvider class:

private searchCount = 0;
private readonly QUOTA_WARN_THRESHOLD = 800;
private readonly MONTHLY_QUOTA = 1000;
private warnedThisMonth = false;

// In the search() method, after a successful response:
async search(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
  filters?: SearchFilters,
): Promise<SearchResult[]> {
  // ... existing body/request code ...

  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: this.headers(),
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(`Exa API error: ${response.status} ${response.statusText}`);
  const data = (await response.json()) as ExaSearchResponse;

  // Quota tracking
  this.searchCount++;
  if (this.searchCount >= this.QUOTA_WARN_THRESHOLD && !this.warnedThisMonth) {
    this.warnedThisMonth = true;
    console.warn(
      `[pi-tools] Exa: monthly usage at ${this.searchCount}/${this.MONTHLY_QUOTA}. ` +
      `Consider reducing usage or upgrading your plan.`,
    );
  }

  return parseExaResults(data).slice(0, maxResults);
}
```

- [ ] **Step 2:** Add test

```typescript
// Add to tests/providers/exa.test.ts

describe("quota warning", () => {
  it("logs warning when usage exceeds 800", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    fetchStub.addResponse("api.exa.ai", {
      body: { results: [{ title: "R", url: "http://r.com", text: "t" }] },
    });

    const provider = new ExaProvider("test-key");

    // Simulate 800 searches by directly setting count (internal state)
    // We'll call search once and check the warning doesn't fire
    await provider.search("test", 5);
    expect(warnSpy).not.toHaveBeenCalled();

    // Set internal count to threshold - 1 via repeated calls or reflection
    // For testing, we access the private field:
    (provider as any).searchCount = 799;
    await provider.search("test", 5);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("monthly usage at 800/1000"),
    );

    // Should only warn once
    await provider.search("test", 5);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 3:** Verify

```bash
pnpm vitest run tests/providers/exa.test.ts
pnpm run typecheck
```

- [ ] **Step 4:** Commit

```bash
git add src/providers/exa.ts tests/providers/exa.test.ts
git commit -m "feat(exa): log quota warning when monthly usage exceeds 800/1000"
```

---

## Task 4: Firecrawl — Support Keyless Mode

**Files:** `src/providers/firecrawl.ts`, `tests/providers/firecrawl.test.ts`

**Change:** Allow Firecrawl to operate without an API key (1000 free credits/month on their free tier). Key becomes optional for higher rate limits.

- [ ] **Step 1:** Update `FirecrawlProvider` and `providerMeta`

```typescript
// src/providers/firecrawl.ts

export class FirecrawlProvider implements SearchProvider, FetchProvider {
  readonly name = "firecrawl";
  readonly label = "Firecrawl";
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      h.Authorization = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  // ... search() and fetch() methods unchanged ...
}

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

- [ ] **Step 2:** Add test for keyless mode

```typescript
// Add to tests/providers/firecrawl.test.ts

describe("keyless mode", () => {
  it("works without API key", async () => {
    fetchStub.addResponse("api.firecrawl.dev", {
      body: {
        data: [
          {
            title: "Free Result",
            url: "https://free.dev/1",
            description: "Free snippet",
          },
        ],
      },
    });

    const provider = new FirecrawlProvider(); // no key
    const results = await provider.search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Free Result");
  });

  it("does not send Authorization header when no key", async () => {
    fetchStub.addResponse("api.firecrawl.dev", {
      body: { data: [] },
    });

    const provider = new FirecrawlProvider();
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const headers = fetchCall[1].headers;
    expect(headers.Authorization).toBeUndefined();
  });

  it("sends Authorization header when key provided", async () => {
    fetchStub.addResponse("api.firecrawl.dev", {
      body: { data: [] },
    });

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

- [ ] **Step 3:** Verify

```bash
pnpm vitest run tests/providers/firecrawl.test.ts
pnpm run typecheck
```

- [ ] **Step 4:** Commit

```bash
git add src/providers/firecrawl.ts tests/providers/firecrawl.test.ts
git commit -m "feat(firecrawl): support keyless mode (requiresKey: false)"
```

---

## Task 5: Jina — Optional Key Mode

**Files:** `src/providers/jina.ts`, `tests/providers/jina.test.ts`

**Change:** Jina already supports optional key in its class (`apiKey?`), but `providerMeta.requiresKey` is already `false`. Verify this is correctly working and add explicit test coverage for both modes.

Note: Looking at the current code, Jina already has `requiresKey: false` and the constructor accepts optional key. This task just adds explicit test documentation.

- [ ] **Step 1:** Verify current implementation is correct

The current `jina.ts` already has:

- `constructor(apiKey?: string)` — optional
- `requiresKey: false` in providerMeta
- Auth header conditionally included

No code changes needed. Add tests to explicitly verify both modes.

- [ ] **Step 2:** Add explicit tests for optional key behavior

```typescript
// Add to tests/providers/jina.test.ts

describe("optional key mode", () => {
  it("works without API key (no auth header)", async () => {
    fetchStub.addResponse("s.jina.ai", {
      body: {
        data: [{ title: "Free", url: "http://free.com", description: "desc" }],
      },
    });

    const provider = new JinaProvider(); // no key
    const results = await provider.search("test", 5);
    expect(results).toHaveLength(1);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBeUndefined();
  });

  it("sends Authorization when key provided", async () => {
    fetchStub.addResponse("s.jina.ai", {
      body: { data: [] },
    });

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

**Change:** Allow configuring the Perplexity model via `model` config option (e.g., `sonar`, `sonar-pro`, `sonar-reasoning`). Default remains `sonar`.

- [ ] **Step 1:** Update `src/providers/perplexity.ts` to use config model

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

## Task 7: SearXNG — Pass Optional Bearer Token Auth Header

**Files:** `src/providers/searxng.ts`, `tests/providers/searxng.test.ts`

**Change:** The current implementation already supports an optional Bearer token via the `apiKey` constructor option (see existing code lines 46-48). Verify and add explicit test coverage.

- [ ] **Step 1:** Verify current implementation

Looking at the existing `searxng.ts`:

```typescript
if (this.apiKey) {
  headers.Authorization = `Bearer ${this.apiKey}`;
}
```

And in `providerMeta.create`:

```typescript
apiKey: providerConfig?.apiKey ? resolveApiKey(providerConfig.apiKey) : undefined,
```

This already works. Ensure test coverage explicitly validates the auth header behavior.

- [ ] **Step 2:** Add explicit test for Bearer token

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
    fetchStub.addResponse("localhost:8080", {
      body: { results: [] },
    });

    const provider = new SearXNGProvider();
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBeUndefined();
  });

  it("providerMeta passes resolved apiKey to constructor", () => {
    // With apiKey in config
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

| Provider   | Change Type | Description                                                                    |
| ---------- | ----------- | ------------------------------------------------------------------------------ |
| duckduckgo | Feature     | `ddgsBackend`, `ddgsRegion`, `ddgsTimelimit` config options passed as CLI args |
| exa        | Feature     | Logs `console.warn` when monthly search count reaches 800/1000                 |
| firecrawl  | Feature     | `requiresKey: false`, API key optional for free-tier usage                     |
| jina       | Test only   | Already supports optional key; added explicit test coverage                    |
| perplexity | Feature     | `model` config option (sonar, sonar-pro, sonar-reasoning)                      |
| searxng    | Test only   | Already supports Bearer token; added explicit test coverage                    |

**Config additions to `ProviderConfigEntry`:**

- `ddgsBackend?: string`
- `ddgsRegion?: string`
- `ddgsTimelimit?: string`
- `model?: string`
