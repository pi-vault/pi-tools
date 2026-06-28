# Phase 2: DuckDuckGo Provider + web_search Tool

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a working `web_search` tool using DuckDuckGo via the `ddgs` CLI (free, no key). After this phase, the extension registers a functional search tool that returns real web search results.

**Spec:** `docs/superpowers/specs/2026-06-28-phase-2-ddgs-cli-design.md`

**Depends on:** Phase 1 (types, test helpers, config)

**Produces:** `src/providers/duckduckgo.ts`, `src/tools/web-search.ts`, updated `src/index.ts`, updated `tests/helpers.ts`

---

## Task 2.1: DuckDuckGo Search Provider (ddgs CLI)

**Files:**

- Create: `src/providers/duckduckgo.ts`
- Test: `tests/providers/duckduckgo.test.ts`
- Modify: `tests/helpers.ts` (add `stubExec`)

- [ ] **Step 1: Add `stubExec` test helper**

Add to `tests/helpers.ts` -- intercepts `child_process.execFile` calls and writes fixture data to the output file path extracted from the command args.

```typescript
// Append to tests/helpers.ts

export interface ExecStub {
  /** Set the JSON data that ddgs will "return" via the output file. */
  setOutput(data: unknown): void;
  /** Set a non-zero exit code to simulate CLI failure. */
  setError(error: { code?: number; message?: string }): void;
  /** Make ddgs appear unavailable (command not found). */
  setUnavailable(): void;
  /** Restore original execFile. */
  restore(): void;
  /** The args from the most recent execFile call. */
  lastArgs(): string[] | undefined;
}

export function stubExec(): ExecStub {
  const original = childProcess.execFile;
  let outputData: unknown = [];
  let errorConfig: { code?: number; message?: string } | null = null;
  let unavailable = false;
  let capturedArgs: string[] | undefined;

  // Monkey-patch execFile
  (childProcess as any).execFile = (
    cmd: string,
    args: string[],
    opts: any,
    callback: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    capturedArgs = args;

    if (unavailable) {
      const err = new Error(`spawn ${cmd} ENOENT`) as any;
      err.code = "ENOENT";
      callback(err, "", "");
      return { kill: vi.fn() };
    }

    if (errorConfig) {
      const err = new Error(errorConfig.message ?? "ddgs failed") as any;
      err.code = errorConfig.code ?? 1;
      callback(err, "", errorConfig.message ?? "");
      return { kill: vi.fn() };
    }

    // Extract output file path from args: -o <path>
    const oIdx = args.indexOf("-o");
    if (oIdx !== -1 && oIdx + 1 < args.length) {
      const outPath = args[oIdx + 1];
      fs.writeFileSync(outPath, JSON.stringify(outputData));
    }

    callback(null, "", "");
    return { kill: vi.fn() };
  };

  return {
    setOutput(data: unknown) {
      outputData = data;
      errorConfig = null;
      unavailable = false;
    },
    setError(error) {
      errorConfig = error;
      unavailable = false;
    },
    setUnavailable() {
      unavailable = true;
      errorConfig = null;
    },
    restore() {
      (childProcess as any).execFile = original;
    },
    lastArgs() {
      return capturedArgs;
    },
  };
}
```

Add the required imports at the top of `tests/helpers.ts`:

```typescript
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
```

- [ ] **Step 2: Write failing provider tests**

```typescript
// tests/providers/duckduckgo.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDuckGoProvider } from "../../src/providers/duckduckgo.ts";
import { stubExec } from "../helpers.ts";

describe("DuckDuckGoProvider", () => {
  let execStub: ReturnType<typeof stubExec>;
  let provider: DuckDuckGoProvider;

  beforeEach(() => {
    execStub = stubExec();
    execStub.setOutput([
      {
        title: "Example Result",
        href: "https://example.com",
        body: "This is a snippet about example",
      },
      {
        title: "Another Result",
        href: "https://another.com",
        body: "More information here",
      },
      {
        title: "Third Result",
        href: "https://third.com",
        body: "Third snippet",
      },
    ]);
    provider = new DuckDuckGoProvider();
  });

  afterEach(() => {
    execStub.restore();
  });

  it("has correct name and label", () => {
    expect(provider.name).toBe("duckduckgo");
    expect(provider.label).toBe("DuckDuckGo");
  });

  it("returns normalized search results", async () => {
    const results = await provider.search("test query", 5);
    expect(results.length).toBe(3);
    expect(results[0]).toEqual({
      title: "Example Result",
      url: "https://example.com",
      snippet: "This is a snippet about example",
    });
  });

  it("respects maxResults", async () => {
    const results = await provider.search("test", 2);
    expect(results.length).toBeLessThanOrEqual(2);
    // Verify -m flag is passed to ddgs
    const args = execStub.lastArgs();
    expect(args).toContain("-m");
    const mIdx = args!.indexOf("-m");
    expect(args![mIdx + 1]).toBe("2");
  });

  it("throws on ddgs CLI failure", async () => {
    execStub.setError({ code: 1, message: "ddgs error" });
    await expect(provider.search("test", 5)).rejects.toThrow();
  });

  it("throws when ddgs not found", async () => {
    execStub.setUnavailable();
    await expect(provider.search("test", 5)).rejects.toThrow(/install/i);
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      provider.search("test", 5, controller.signal),
    ).rejects.toThrow();
  });

  it("cleans up temp file after success", async () => {
    const os = await import("node:os");
    const fsSync = await import("node:fs");
    const before = fsSync
      .readdirSync(os.tmpdir())
      .filter((f) => f.startsWith("ddgs-") && f.endsWith(".json"));
    await provider.search("test", 5);
    const after = fsSync
      .readdirSync(os.tmpdir())
      .filter((f) => f.startsWith("ddgs-") && f.endsWith(".json"));
    // No new ddgs temp files should remain
    expect(after.length).toBeLessThanOrEqual(before.length);
  });

  it("includes stderr in error on CLI failure", async () => {
    execStub.setError({ code: 1, message: "rate limited" });
    await expect(provider.search("test", 5)).rejects.toThrow(/rate limited/i);
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `pnpm test -- tests/providers/duckduckgo.test.ts`
Expected: FAIL (DuckDuckGoProvider does not exist yet).

- [ ] **Step 4: Implement DuckDuckGo provider**

```typescript
// src/providers/duckduckgo.ts
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { SearchProvider, SearchResult } from "./types.ts";

interface DDGSResult {
  title: string;
  href: string;
  body: string;
}

const EXEC_TIMEOUT_MS = 15_000;

export class DuckDuckGoProvider implements SearchProvider {
  readonly name = "duckduckgo";
  readonly label = "DuckDuckGo";

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    if (signal?.aborted) {
      throw new Error("Search aborted");
    }

    const tmpFile = path.join(os.tmpdir(), `ddgs-${crypto.randomUUID()}.json`);

    try {
      // runDdgs catches ENOENT from execFile and rethrows with install hint
      await this.runDdgs(query, maxResults, tmpFile, signal);

      let raw: string;
      try {
        raw = await fs.readFile(tmpFile, "utf-8");
      } catch {
        throw new Error("Failed to parse ddgs output: output file not created");
      }

      const data: DDGSResult[] = JSON.parse(raw);
      return data.slice(0, maxResults).map((r) => ({
        title: r.title,
        url: r.href,
        snippet: r.body,
      }));
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  }

  private runDdgs(
    query: string,
    maxResults: number,
    outPath: string,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        "ddgs",
        ["text", "-q", query, "-m", String(maxResults), "-o", outPath],
        { timeout: EXEC_TIMEOUT_MS },
        (error, _stdout, stderr) => {
          if (error) {
            // ENOENT from execFile means the ddgs binary is missing
            if ((error as any).code === "ENOENT") {
              reject(
                new Error(
                  "ddgs CLI not found. Install with: pip install ddgs (or: uv tool install ddgs)",
                ),
              );
              return;
            }
            // Include stderr in the error message when available
            const detail = stderr?.trim();
            reject(
              detail
                ? new Error(`ddgs failed: ${detail}`)
                : error,
            );
          } else {
            resolve();
          }
        },
      );

      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            child.kill();
            reject(new Error("Search aborted"));
          },
          { once: true },
        );
      }
    });
  }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm test -- tests/providers/duckduckgo.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/providers/duckduckgo.ts tests/providers/duckduckgo.test.ts tests/helpers.ts
git commit -m "feat: add DuckDuckGo search provider (ddgs CLI)"
```

## Task 2.2: web_search Tool Definition

**Files:**

- Create: `src/tools/web-search.ts`
- Test: `tests/tools/web-search.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests**

Tool tests use an inline stub `SearchProvider` to stay provider-agnostic. They don't know about CLI internals.

```typescript
// tests/tools/web-search.test.ts
import { describe, expect, it } from "vitest";
import { createWebSearchTool } from "../../src/tools/web-search.ts";
import { makeCtx } from "../helpers.ts";
import type {
  SearchProvider,
  SearchResult,
} from "../../src/providers/types.ts";

function makeStubProvider(results: SearchResult[]): SearchProvider {
  return {
    name: "stub",
    label: "Stub",
    async search(_query: string, maxResults: number, _signal?: AbortSignal) {
      return results.slice(0, maxResults);
    },
  };
}

function makeFailingProvider(message: string): SearchProvider {
  return {
    name: "stub",
    label: "Stub",
    async search() {
      throw new Error(message);
    },
  };
}

describe("web_search tool", () => {
  const sampleResults: SearchResult[] = [
    {
      title: "TypeScript",
      url: "https://typescriptlang.org",
      snippet: "A typed superset of JavaScript",
    },
    {
      title: "MDN Web Docs",
      url: "https://developer.mozilla.org",
      snippet: "Web technology reference",
    },
  ];

  it("has correct tool metadata", () => {
    const tool = createWebSearchTool(() => makeStubProvider(sampleResults));
    expect(tool.name).toBe("web_search");
    expect(tool.label).toBe("Web Search");
    expect(tool.parameters).toBeDefined();
  });

  it("executes search and returns formatted results", async () => {
    const tool = createWebSearchTool(() => makeStubProvider(sampleResults));
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-1",
      { query: "typescript" },
      undefined,
      undefined,
      ctx,
    );
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0]).toHaveProperty("type", "text");
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("TypeScript");
    expect(text).toContain("https://typescriptlang.org");
  });

  it("returns error result on provider failure", async () => {
    const tool = createWebSearchTool(() =>
      makeFailingProvider("Provider exploded"),
    );
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-2",
      { query: "test" },
      undefined,
      undefined,
      ctx,
    );
    // Tool should not throw — it returns an error in content
    expect(result.content[0]).toHaveProperty("type", "text");
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("error");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/tools/web-search.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement web_search tool**

```typescript
// src/tools/web-search.ts
import { Type, type Static } from "typebox";
import type {
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { SearchProvider, SearchResult } from "../providers/types.ts";
import { sanitizeError } from "../utils/errors.ts";

const WebSearchParams = Type.Object({
  query: Type.String({ description: "Search query" }),
  numResults: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: 20,
      default: 5,
      description: "Number of results (1-20, default 5)",
    }),
  ),
  provider: Type.Optional(
    Type.String({ description: "Provider name or 'auto' (default)" }),
  ),
});

type WebSearchInput = Static<typeof WebSearchParams>;

interface WebSearchDetails {
  provider: string;
  resultCount: number;
}

function formatResults(results: SearchResult[]): string {
  if (results.length === 0) return "No results found.";
  return results
    .map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`)
    .join("\n\n");
}

export function createWebSearchTool(
  resolveProvider: (name?: string) => SearchProvider,
  onSuccess?: (providerName: string) => void,
): ToolDefinition<typeof WebSearchParams, WebSearchDetails> {
  return {
    name: "web_search",
    label: "Web Search",
    description: "Search the web for up-to-date information.",
    promptSnippet: "Search the web for up-to-date information.",
    promptGuidelines: [
      "Use web_search for information beyond training data -- recent events, current library versions, live API docs.",
      "After answering, include a Sources: section listing relevant URLs as markdown hyperlinks.",
      "Use one web_search call per search angle rather than batching multiple queries.",
    ],
    parameters: WebSearchParams,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        const provider = resolveProvider(params.provider);
        const maxResults = params.numResults ?? 5;
        const results = await provider.search(
          params.query,
          maxResults,
          signal ?? undefined,
        );
        const text = formatResults(results);

        // Record successful usage for quota tracking (increment on success only)
        onSuccess?.(provider.name);

        return {
          content: [{ type: "text" as const, text }],
          details: { provider: provider.name, resultCount: results.length },
        };
      } catch (error) {
        const msg = sanitizeError(error);
        return {
          content: [{ type: "text" as const, text: `Search error: ${msg}` }],
          details: { provider: "unknown", resultCount: 0 },
        };
      }
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/tools/web-search.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Wire up in index.ts**

Replace the contents of `src/index.ts`:

```typescript
// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { DuckDuckGoProvider } from "./providers/duckduckgo.ts";
import type { SearchProvider } from "./providers/types.ts";
import { createWebSearchTool } from "./tools/web-search.ts";

export default function createExtension(pi: ExtensionAPI): void {
  const config = loadConfig();
  const duckduckgo = new DuckDuckGoProvider();

  function resolveSearchProvider(name?: string): SearchProvider {
    // Phase 2: only DuckDuckGo. Phase 5 adds the full registry.
    return duckduckgo;
  }

  pi.registerTool(createWebSearchTool(resolveSearchProvider));
}
```

- [ ] **Step 6: Update existing test**

```typescript
// tests/index.test.ts
import { describe, expect, it } from "vitest";
import createExtension from "../src/index.ts";
import { createMockPi } from "./helpers.ts";

describe("tools extension", () => {
  it("exports a function", () => {
    expect(typeof createExtension).toBe("function");
  });

  it("registers web_search tool", () => {
    const pi = createMockPi();
    createExtension(pi as any);
    expect(pi.tools.some((t) => t.name === "web_search")).toBe(true);
  });
});
```

- [ ] **Step 7: Run all tests**

Run: `pnpm check`
Expected: All lint, typecheck, and tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/tools/web-search.ts src/index.ts tests/tools/web-search.test.ts tests/index.test.ts
git commit -m "feat: add web_search tool with DuckDuckGo provider"
```

## Phase 2 Checkpoint

The extension now registers a functional `web_search` tool. When loaded by Pi, agents can search the web via the `ddgs` CLI, returning real search results with titles, URLs, and snippets. The `ddgs` CLI must be pre-installed (`pip install ddgs` or `uv tool install ddgs`).
