# Phase 4: web_search Tool Integration + Wiring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire fusion into the web_search tool: add the `combine` parameter, branch execution between fallback and fusion, update output formatting, and connect everything in `index.ts`.

**Architecture:** `createWebSearchTool` gains a `combineConfig` parameter. When fusion is active, it calls `executeWithFusion()` from Phase 2. The `resolveCandidates` closure in `index.ts` gains a `combine` flag to select the right provider pool. Output formatting adds provider attribution in the summary line and expanded view.

**Tech Stack:** TypeScript, Vitest, @sinclair/typebox

**Spec:** `docs/superpowers/specs/2026-07-08-multi-provider-fusion-rrf-design.md` (sections "web_search Tool Changes" and "Integration & Wiring")

**Prerequisites:** Phases 1-3 complete.

---

### Task 1: Update web_search tool factory signature and add combine param

**Files:**

- Modify: `src/tools/web-search.ts`

- [ ] **Step 1: Add combine param to schema and update factory signature**

In `src/tools/web-search.ts`:

1. Add import at the top:

```typescript
import type { CombineConfig } from "../config.ts";
import { executeWithFusion } from "../providers/fusion.ts";
import type { FusedResult } from "../providers/fusion.ts";
```

2. Add `combine` to `WebSearchParams` (after the `compact` field):

```typescript
  combine: Type.Optional(
    Type.Boolean({
      description:
        "Override fusion setting: true to fuse multiple providers, false for single-provider fallback",
    }),
  ),
```

3. Update the `WebSearchDetails` interface:

```typescript
interface WebSearchDetails {
  provider: string;
  resultCount: number;
  fusionMeta?: {
    providersUsed: string[];
    degraded: boolean;
    results: Array<{ url: string; providers: string[] }>;
  };
}
```

4. Update the factory function signature to accept `combineConfig`:

```typescript
export function createWebSearchTool(
  resolveCandidates: (name?: string, combine?: boolean) => SearchProvider[],
  onSuccess?: (providerName: string, latencyMs: number) => void,
  guidance?: GuidanceOverride,
  onFailure?: (providerName: string) => void,
  onResult?: (providerName: string, resultCount: number, requestedCount: number) => void,
  combineConfig?: CombineConfig,
): ToolDefinition<typeof WebSearchParams, WebSearchDetails> {
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS — all new params are optional, existing callers still compile.

- [ ] **Step 3: Commit**

```bash
git add src/tools/web-search.ts
git commit -m "feat(web-search): add combine param and fusionMeta to details type"
```

---

### Task 2: Add fusion execution branch

**Files:**

- Modify: `src/tools/web-search.ts`

- [ ] **Step 4: Add fusion execution path inside the execute function**

Replace the body of the `execute` method. The key change: check `params.combine ?? combineConfig?.enabled` to branch between fusion and fallback. Here is the complete `execute` method:

```typescript
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const combineActive = params.combine ?? (combineConfig?.enabled === true);
      const candidates = resolveCandidates(params.provider, combineActive);

      if (candidates.length === 0) {
        return {
          content: [{ type: "text" as const, text: "Search error: No search providers available" }],
          details: { provider: "none", resultCount: 0 },
        };
      }

      const maxResults = params.numResults ?? 5;
      const filters = buildFilters(params);

      if (combineActive && candidates.length > 1 && combineConfig) {
        return executeFusion(candidates, maxResults, filters, signal, params.compact, combineConfig);
      }

      // Existing fallback path
      try {
        const { result: results, providerName } = await executeWithFallback({
          candidates: candidates.map((provider) => ({
            name: provider.name,
            execute: () => provider.search(params.query, maxResults, signal ?? undefined, filters),
          })),
          operation: "search",
          onSuccess,
          onFailure,
        });

        onResult?.(providerName, results.length, maxResults);

        const text = params.compact
          ? formatResultsCompact(results)
          : formatResults(results);

        return {
          content: [{ type: "text" as const, text }],
          details: { provider: providerName, resultCount: results.length },
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Search error: ${msg}` }],
          details: { provider: "none", resultCount: 0 },
        };
      }
    },
```

Note: the `executeFusion` helper is a private function we'll define next. We need `params.query` in it, so capture it properly.

Actually, let's inline the logic more cleanly. Replace with this structure where `executeFusion` is a local helper defined inside `createWebSearchTool`:

```typescript
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const combineActive = params.combine ?? (combineConfig?.enabled === true);
      const candidates = resolveCandidates(params.provider, combineActive);

      if (candidates.length === 0) {
        return {
          content: [{ type: "text" as const, text: "Search error: No search providers available" }],
          details: { provider: "none", resultCount: 0 },
        };
      }

      const maxResults = params.numResults ?? 5;
      const filters = buildFilters(params);

      // Fusion path
      if (combineActive && candidates.length > 1 && combineConfig) {
        try {
          const fusionResult = await executeWithFusion({
            candidates: candidates.map((provider) => ({
              name: provider.name,
              execute: (n: number) =>
                provider.search(params.query, n, signal ?? undefined, filters),
            })),
            maxResults,
            mode: combineConfig.mode,
            targetBackends: combineConfig.targetBackends,
            k: combineConfig.k,
            onSuccess,
            onFailure,
          });

          for (const pr of fusionResult.providersUsed) {
            const providerResultCount = fusionResult.results.filter(
              (f) => f.providers.includes(pr),
            ).length;
            onResult?.(pr, providerResultCount, maxResults);
          }

          const searchResults = fusionResult.results.map((f) => f.result);
          const text = formatFusionOutput(
            searchResults,
            fusionResult,
            params.compact ?? false,
          );

          return {
            content: [{ type: "text" as const, text }],
            details: {
              provider: "fusion",
              resultCount: fusionResult.results.length,
              fusionMeta: {
                providersUsed: fusionResult.providersUsed,
                degraded: fusionResult.degraded,
                results: fusionResult.results.map((f) => ({
                  url: f.result.url,
                  providers: f.providers,
                })),
              },
            },
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text" as const, text: `Search error: ${msg}` }],
            details: { provider: "none", resultCount: 0 },
          };
        }
      }

      // Existing fallback path (unchanged)
      try {
        const { result: results, providerName } = await executeWithFallback({
          candidates: candidates.map((provider) => ({
            name: provider.name,
            execute: () => provider.search(params.query, maxResults, signal ?? undefined, filters),
          })),
          operation: "search",
          onSuccess,
          onFailure,
        });

        onResult?.(providerName, results.length, maxResults);

        const text = params.compact
          ? formatResultsCompact(results)
          : formatResults(results);

        return {
          content: [{ type: "text" as const, text }],
          details: { provider: providerName, resultCount: results.length },
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Search error: ${msg}` }],
          details: { provider: "none", resultCount: 0 },
        };
      }
    },
```

- [ ] **Step 5: Add the formatFusionOutput helper function**

Add before `createWebSearchTool`:

```typescript
function formatFusionOutput(
  results: SearchResult[],
  fusionResult: {
    providersUsed: string[];
    degraded: boolean;
    results: FusedResult[];
  },
  compact: boolean,
): string {
  const lines: string[] = [];

  if (fusionResult.degraded) {
    lines.push(
      `Warning: Only ${fusionResult.providersUsed.length} of target providers responded (quota exhaustion)`,
    );
  }

  if (results.length === 0) {
    lines.push("No results found.");
    return lines.join("\n");
  }

  const resultText = compact
    ? formatResultsCompact(results)
    : formatResults(results);
  lines.push(resultText);

  return lines.join("\n");
}
```

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/tools/web-search.ts
git commit -m "feat(web-search): add fusion execution branch with output formatting"
```

---

### Task 3: Update index.ts wiring

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 8: Update resolveCandidates and tool registration**

In `src/index.ts`, update the `resolveCandidates` closure:

```typescript
const resolveCandidates = (name?: string, combine?: boolean) => {
  configManager.refresh();
  const resolved = name ?? configManager.current.defaultProvider;
  const combineActive = combine ?? configManager.current.combine.enabled;

  if (combineActive) {
    return registry.selectSearchForFusion(
      configManager.current.selectionStrategy,
      resolved,
    );
  }

  if (configManager.current.selectionStrategy === "best-performing") {
    const provider = registry.selectSearchByPerformance(resolved);
    return provider ? [provider] : [];
  }
  return registry.selectSearchCandidates(resolved);
};
```

Update the `createWebSearchTool` call to pass `combineConfig`:

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
    configManager.current.combine,
  ),
);
```

- [ ] **Step 9: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/index.ts
git commit -m "feat(index): wire combine config and fusion-aware resolveCandidates"
```

---

### Task 4: Write fusion integration tests for web_search tool

**Files:**

- Modify: `tests/tools/web-search.test.ts`

- [ ] **Step 11: Add fusion-specific tests**

Add a new `describe` block at the bottom of `tests/tools/web-search.test.ts`:

```typescript
describe("web_search fusion mode", () => {
  const resultA: SearchResult = {
    title: "Result A",
    url: "https://a.com",
    snippet: "Snippet A",
  };
  const resultB: SearchResult = {
    title: "Result B",
    url: "https://b.com",
    snippet: "Snippet B",
  };
  const resultC: SearchResult = {
    title: "Result C",
    url: "https://c.com",
    snippet: "Snippet C",
  };

  const combineConfig = {
    enabled: true,
    mode: "targeted" as const,
    targetBackends: 3,
    k: 60,
  };

  it("combine param triggers fusion path and returns fused results", async () => {
    const providerBrave = makeProvider("brave", [resultA, resultB]);
    const providerExa = makeProvider("exa", [resultB, resultC]);

    const tool = createWebSearchTool(
      () => [providerBrave, providerExa],
      vi.fn(),
      undefined,
      vi.fn(),
      vi.fn(),
      combineConfig,
    );
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-fuse-1",
      { query: "test", combine: true },
      undefined,
      undefined,
      ctx,
    );

    expect(result.details.provider).toBe("fusion");
    expect(result.details.resultCount).toBeGreaterThan(0);
    expect(result.details.fusionMeta).toBeDefined();
    expect(result.details.fusionMeta!.providersUsed).toContain("brave");
    expect(result.details.fusionMeta!.providersUsed).toContain("exa");
  });

  it("combine=false forces fallback even when config has enabled=true", async () => {
    const providerBrave = makeProvider("brave", [resultA]);
    const providerExa = makeProvider("exa", [resultB]);

    const tool = createWebSearchTool(
      () => [providerBrave, providerExa],
      vi.fn(),
      undefined,
      vi.fn(),
      vi.fn(),
      combineConfig,
    );
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-fuse-2",
      { query: "test", combine: false },
      undefined,
      undefined,
      ctx,
    );

    // Fallback path: single provider
    expect(result.details.provider).toBe("brave");
    expect(result.details.fusionMeta).toBeUndefined();
  });

  it("config-driven fusion (no param override)", async () => {
    const providerBrave = makeProvider("brave", [resultA]);
    const providerExa = makeProvider("exa", [resultB]);

    const tool = createWebSearchTool(
      (_name, combine) => {
        // Simulate: when combine=true, return multiple providers
        if (combine) return [providerBrave, providerExa];
        return [providerBrave];
      },
      vi.fn(),
      undefined,
      vi.fn(),
      vi.fn(),
      combineConfig,
    );
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-fuse-3",
      { query: "test" },
      undefined,
      undefined,
      ctx,
    );

    // combine.enabled=true in config, so fusion is active
    expect(result.details.provider).toBe("fusion");
  });

  it("degraded warning appears when fewer providers than target", async () => {
    const providerBrave = makeProvider("brave", [resultA]);
    const failingProvider = makeFailingProvider("exa", "API error");

    const tool = createWebSearchTool(
      () => [providerBrave, failingProvider],
      vi.fn(),
      undefined,
      vi.fn(),
      vi.fn(),
      { ...combineConfig, targetBackends: 3 },
    );
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-fuse-4",
      { query: "test", combine: true },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Warning");
    expect(result.details.fusionMeta!.degraded).toBe(true);
  });

  it("falls back to single-provider when only 1 candidate available", async () => {
    const providerBrave = makeProvider("brave", [resultA]);

    const tool = createWebSearchTool(
      () => [providerBrave],
      vi.fn(),
      undefined,
      vi.fn(),
      vi.fn(),
      combineConfig,
    );
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-fuse-5",
      { query: "test", combine: true },
      undefined,
      undefined,
      ctx,
    );

    // Only 1 candidate: fusion path skipped, uses fallback
    expect(result.details.provider).toBe("brave");
    expect(result.details.fusionMeta).toBeUndefined();
  });

  it("fusion output includes provider summary line in expanded view data", async () => {
    const providerBrave = makeProvider("brave", [resultA, resultB]);
    const providerExa = makeProvider("exa", [resultA, resultC]);

    const tool = createWebSearchTool(
      () => [providerBrave, providerExa],
      vi.fn(),
      undefined,
      vi.fn(),
      vi.fn(),
      combineConfig,
    );
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-fuse-6",
      { query: "test", combine: true },
      undefined,
      undefined,
      ctx,
    );

    // fusionMeta.results tracks which providers found each URL
    const metaResults = result.details.fusionMeta!.results;
    const aEntry = metaResults.find((r) => r.url === "https://a.com");
    expect(aEntry?.providers).toContain("brave");
    expect(aEntry?.providers).toContain("exa");
  });
});
```

- [ ] **Step 12: Run web_search tests**

Run: `pnpm vitest run tests/tools/web-search.test.ts`
Expected: All tests PASS (both existing and new fusion tests)

- [ ] **Step 13: Commit**

```bash
git add tests/tools/web-search.test.ts
git commit -m "test(web-search): add fusion integration tests"
```

---

### Task 5: Update renderResult for fusion expanded view

**Files:**

- Modify: `src/tools/web-search.ts`

- [ ] **Step 14: Update renderResult to show provider attribution in expanded mode**

In the `renderResult` function, update the `options.expanded` branch:

```typescript
    renderResult(result, options, theme: Theme, context) {
      const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      if (context.isPartial) {
        text.setText(theme.fg("warning", "Searching..."));
        return text;
      }
      const count = result.details?.resultCount ?? 0;
      const provider = result.details?.provider ?? "unknown";

      if (options.expanded) {
        const raw =
          result.content[0] && "text" in result.content[0] ? result.content[0].text : "";

        if (result.details?.fusionMeta) {
          const meta = result.details.fusionMeta;
          const header = meta.degraded
            ? theme.fg("warning", `${count} results fused (degraded) from ${meta.providersUsed.join(", ")}`)
            : theme.fg("toolOutput", `${count} results fused from ${meta.providersUsed.join(", ")}`);

          const resultLines = raw.split("\n").slice(0, 15);
          text.setText([header, ...resultLines.map((l) => theme.fg("toolOutput", l))].join("\n"));
        } else {
          const lines = raw.split("\n").slice(0, 15);
          text.setText(lines.map((l) => theme.fg("toolOutput", l)).join("\n"));
        }
      } else {
        if (result.details?.fusionMeta) {
          const meta = result.details.fusionMeta;
          const status = meta.degraded
            ? `${count} results fused (degraded) from ${meta.providersUsed.join(", ")}`
            : `${count} results fused from ${meta.providersUsed.join(", ")}`;
          text.setText(theme.fg("toolOutput", status));
        } else {
          text.setText(theme.fg("toolOutput", `${count} results via ${provider}`));
        }
      }
      return text;
    },
```

- [ ] **Step 15: Run typecheck and tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 16: Commit**

```bash
git add src/tools/web-search.ts
git commit -m "feat(web-search): update renderResult with fusion attribution display"
```

---

### Task 6: Full regression suite

- [ ] **Step 17: Run the full test suite**

Run: `pnpm check`
Expected: All tests pass, no lint errors, no type errors.

- [ ] **Step 18: Final commit (if any formatting changes from biome)**

```bash
git add -u
git commit -m "style: format after fusion integration"
```

Only commit if biome changed anything. If `pnpm check` passed cleanly, skip this step.
