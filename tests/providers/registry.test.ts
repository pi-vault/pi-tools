import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderBudget, ProviderConfigEntry } from "../../src/config.ts";
import {
  BudgetExceededError,
  ProviderRegistry,
  type PersistenceAdapter,
  type UsageFileV2,
} from "../../src/providers/registry.ts";
import type {
  CodeSearchProvider,
  DocsProvider,
  FetchProvider,
  ResearchProvider,
  SearchProvider,
  UsageCost,
} from "../../src/providers/types.ts";
import { UNSUPPORTED_SEARCH_FILTERS } from "../../src/providers/types.ts";

const managed: ProviderBudget = { mode: "managed" };
const hard = (
  limit = 1,
  period: "day" | "month" | "lifetime" = "month",
  unit: "request" | "credit" | "usd" = "request",
  pool?: string,
): ProviderBudget => ({ mode: "hard", limit, period, unit, ...(pool ? { pool } : {}) });

function search(name: string): SearchProvider {
  return {
    name,
    label: name,
    filterSupport: UNSUPPORTED_SEARCH_FILTERS,
    search: vi
      .fn()
      .mockResolvedValue([{ title: name, url: `https://${name}.test`, snippet: name }]),
  };
}

function config(budget: ProviderBudget): ProviderConfigEntry {
  return { enabled: true, budget };
}

function memory(initial: unknown = { version: 2, counters: {} }): {
  registry: ProviderRegistry;
  adapter: PersistenceAdapter;
  save: ReturnType<typeof vi.fn>;
} {
  const save = vi.fn();
  const adapter = { load: () => initial, save } as PersistenceAdapter;
  return { registry: new ProviderRegistry(adapter), adapter, save };
}

function fetch(name: string): FetchProvider {
  return { name, fetch: vi.fn().mockResolvedValue({ text: name }) };
}

function codeSearch(name: string): CodeSearchProvider {
  return {
    name,
    codeSearch: vi.fn().mockResolvedValue([{ title: name, url: `https://${name}.test`, snippet: name }]),
  };
}

function docs(name: string): DocsProvider {
  return {
    name,
    label: name,
    searchLibrary: vi.fn().mockResolvedValue([]),
    getContext: vi.fn().mockResolvedValue(name),
  };
}

function research(name: string): ResearchProvider {
  return {
    name,
    label: name,
    deepResearch: vi
      .fn()
      .mockResolvedValue({ results: [], raw: {}, metadata: {} }),
  };
}

function register(
  registry: ProviderRegistry,
  name: string,
  budget: ProviderBudget,
  instances: {
    search?: SearchProvider;
    fetch?: FetchProvider;
    codeSearch?: CodeSearchProvider;
    docs?: DocsProvider;
    research?: ResearchProvider;
  } = { search: search(name) },
  usageCost?: UsageCost,
  tier: 1 | 2 | 3 = 1,
): void {
  registry.registerProvider(instances, {
    name,
    tier,
    budget,
    config: config(budget),
    usageCost,
  });
}

describe("ProviderRegistry budgets", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:34:56Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reserves and persists before delegation", async () => {
    const events: string[] = [];
    const save = vi.fn(() => events.push("save"));
    const registry = new ProviderRegistry({ load: () => ({ version: 2, counters: {} }), save });
    const provider = search("brave");
    vi.mocked(provider.search).mockImplementation(async () => {
      events.push("delegate");
      return [];
    });
    register(registry, "brave", hard(1), { search: provider });

    await registry.selectSearchCandidates()[0].search("query", 10);

    expect(events).toEqual(["save", "delegate"]);
    expect(registry.getBudgetStatus("brave")).toMatchObject({ used: 1, limit: 1 });
    expect(save).toHaveBeenLastCalledWith({
      version: 2,
      counters: {
        brave: { used: 1, unit: "request", period: "month", periodKey: "2026-07" },
      },
    });
  });

  it("blocks a call that would exceed the budget without changing usage", () => {
    const { registry, save } = memory();
    register(registry, "exa", hard(0.01, "month", "usd"), undefined, () => 0.007);

    registry.consume("exa", { capability: "search", maxResults: 10 });
    expect(() => registry.consume("exa", { capability: "search", maxResults: 10 })).toThrow(
      BudgetExceededError,
    );
    expect(registry.getBudgetStatus("exa")).toMatchObject({ used: 0.007 });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does not persist managed or unlimited usage", () => {
    const { registry, save } = memory();
    register(registry, "jina", managed);
    register(registry, "duckduckgo", { mode: "unlimited" });

    registry.consume("jina", { capability: "fetch" });
    registry.consume("duckduckgo", { capability: "search", maxResults: 10 });

    expect(save).not.toHaveBeenCalled();
    expect(registry.getBudgetStatus("jina")).toEqual({ mode: "managed" });
    expect(registry.getBudgetStatus("duckduckgo")).toEqual({ mode: "unlimited" });
  });

  it("rejects usage when no provider policy is registered", () => {
    const { registry, save } = memory();

    expect(() => registry.consume("missing", { capability: "fetch" })).toThrow(
      "missing is not registered",
    );
    expect(save).not.toHaveBeenCalled();
  });

  it("rounds accumulated usage to six decimals", () => {
    const { registry } = memory();
    register(registry, "brave", hard(1, "month", "usd"), undefined, () => 0.0000006);
    registry.consume("brave", { capability: "search", maxResults: 1 });
    registry.consume("brave", { capability: "search", maxResults: 1 });
    expect(registry.getBudgetStatus("brave")).toMatchObject({ used: 0.000002 });
  });

  it("rejects invalid operation costs", () => {
    const { registry } = memory();
    register(registry, "broken", hard(10), undefined, () => Number.NaN);
    expect(() => registry.consume("broken", { capability: "fetch" })).toThrow("finite positive");
  });

  it.each([
    ["day", "2026-07-15"],
    ["month", "2026-07"],
    ["lifetime", "lifetime"],
  ] as const)("uses UTC %s period keys", (period, periodKey) => {
    const { registry } = memory();
    register(registry, period, hard(10, period));
    registry.consume(period, { capability: "fetch" });
    expect(registry.getBudgetStatus(period)).toMatchObject({ periodKey });
  });

  it("resets stale period and incompatible unit counters", () => {
    const initial: UsageFileV2 = {
      version: 2,
      counters: {
        brave: { used: 9, unit: "credit", period: "month", periodKey: "2026-06" },
      },
    };
    const { registry } = memory(initial);
    register(registry, "brave", hard(10, "month", "request"));

    registry.consume("brave", { capability: "fetch" });
    expect(registry.getBudgetStatus("brave")).toMatchObject({ used: 1, periodKey: "2026-07" });
  });

  it("shares counters by pool", () => {
    const { registry } = memory();
    register(registry, "brave", hard(2, "month", "request", "brave"));
    register(registry, "brave-llm", hard(2, "month", "request", "brave"));

    registry.consume("brave", { capability: "search", maxResults: 1 });
    expect(registry.getBudgetStatus("brave-llm")).toMatchObject({ used: 1, pool: "brave" });
  });

  it("keeps pool counters separate from same-named provider counters", () => {
    const { registry } = memory();
    register(registry, "shared", hard(2));
    register(registry, "pooled", hard(2, "month", "request", "shared"));

    registry.consume("shared", { capability: "fetch" });

    expect(registry.getBudgetStatus("shared")).toMatchObject({ used: 1 });
    expect(registry.getBudgetStatus("pooled")).toMatchObject({ used: 0 });
  });

  it("preserves compatible bare V2 provider and pool counters", () => {
    const { registry } = memory({
      version: 2,
      counters: {
        serper: { used: 2, unit: "request", period: "month", periodKey: "2026-07" },
        brave: { used: 1, unit: "request", period: "month", periodKey: "2026-07" },
      },
    });
    register(registry, "serper", hard(10));
    register(registry, "brave", hard(10, "month", "request", "brave"));
    register(registry, "brave-llm", hard(10, "month", "request", "brave"));

    expect(registry.getBudgetStatus("serper")).toMatchObject({ used: 2 });
    expect(registry.getBudgetStatus("brave")).toMatchObject({ used: 1 });
    expect(registry.getBudgetStatus("brave-llm")).toMatchObject({ used: 1 });
  });

  it("rolls back a reservation and blocks delegation when persistence fails", async () => {
    const save = vi.fn(() => {
      throw new Error("disk full");
    });
    const registry = new ProviderRegistry({ load: () => ({ version: 2, counters: {} }), save });
    const provider = search("brave");
    register(registry, "brave", hard(2), { search: provider });

    await expect(registry.selectSearchCandidates()[0].search("query", 10)).rejects.toThrow(
      "disk full",
    );
    expect(provider.search).not.toHaveBeenCalled();
    expect(registry.getBudgetStatus("brave")).toMatchObject({ used: 0 });
  });

  it("migrates only compatible current-month legacy records", () => {
    const { registry } = memory({
      brave: { count: 4, month: "2026-07" },
      exa: { count: 5, month: "2026-06" },
      daily: { count: 6, month: "2026-07" },
      pooled: { count: 7, month: "2026-07" },
    });

    register(registry, "brave", hard(10));
    register(registry, "exa", hard(10));
    register(registry, "daily", hard(10, "day"));
    register(registry, "pooled", hard(10, "month", "request", "shared"));

    expect(registry.getBudgetStatus("brave")).toMatchObject({ used: 4 });
    expect(registry.getBudgetStatus("exa")).toMatchObject({ used: 0 });
    expect(registry.getBudgetStatus("daily")).toMatchObject({ used: 0 });
    expect(registry.getBudgetStatus("pooled")).toMatchObject({ used: 0 });
  });

  it("keeps counters across unregister and re-register", () => {
    const { registry } = memory();
    register(registry, "brave", hard(2));
    registry.consume("brave", { capability: "fetch" });
    registry.unregisterAll("brave");
    register(registry, "brave", hard(2));
    expect(registry.getBudgetStatus("brave")).toMatchObject({ used: 1 });
  });

  it("warns once at 80 percent and once at exhaustion", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { registry } = memory();
    register(registry, "brave", hard(5));

    for (let i = 0; i < 5; i++) registry.consume("brave", { capability: "fetch" });

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain("80%");
    expect(warn.mock.calls[1][0]).toContain("exhausted");
  });
});

describe("ProviderRegistry capability wrappers", () => {
  it("meters search, fetch, code-search, and docs methods", async () => {
    const cases = [
      {
        name: "search",
        instances: { search: search("search") },
        operation: (registry: ProviderRegistry) => {
          const provider = registry.selectSearchCandidates("search")[0];
          return () => provider.search("q", 1);
        },
      },
      {
        name: "fetch",
        instances: { fetch: { name: "fetch", fetch: vi.fn().mockResolvedValue({ text: "ok" }) } },
        operation: (registry: ProviderRegistry) => {
          const provider = registry.selectFetchCandidates()[0];
          return () => provider.fetch("https://x.test");
        },
      },
      {
        name: "code",
        instances: { codeSearch: { name: "code", codeSearch: vi.fn().mockResolvedValue([]) } },
        operation: (registry: ProviderRegistry) => {
          const provider = registry.selectCodeSearch()!;
          return () => provider.codeSearch("q", 1);
        },
      },
      {
        name: "docs",
        instances: {
          docs: {
            name: "docs",
            label: "docs",
            searchLibrary: vi.fn().mockResolvedValue([]),
            getContext: vi.fn().mockResolvedValue("ok"),
          },
        },
        operation: (registry: ProviderRegistry) => {
          const provider = registry.selectDocs()!;
          return () => provider.searchLibrary("lib", "q");
        },
      },
    ] as const;

    for (const item of cases) {
      const { registry } = memory();
      register(registry, item.name, hard(1), item.instances);
      const operation = item.operation(registry);
      await operation();
      await expect(operation()).rejects.toBeInstanceOf(BudgetExceededError);
    }
  });

  it("meters both docs operations", async () => {
    const { registry } = memory();
    const docs: DocsProvider = {
      name: "context7",
      label: "Context7",
      searchLibrary: vi.fn().mockResolvedValue([]),
      getContext: vi.fn().mockResolvedValue("ok"),
    };
    register(registry, "context7", hard(2), { docs });

    await registry.selectDocs()!.searchLibrary("lib", "q");
    await registry.selectDocs()!.getContext("id", "q");

    expect(registry.getBudgetStatus("context7")).toMatchObject({ used: 2 });
  });

  it("recordOutcome changes metrics without usage", () => {
    const { registry } = memory();
    register(registry, "brave", hard(1));
    registry.recordOutcome("brave", { success: true, latencyMs: 10 });

    expect(registry.getMetrics("brave")).toMatchObject({ successes: 1, avgLatency: 10 });
    expect(registry.getBudgetStatus("brave")).toMatchObject({ used: 0 });
  });

  it("preserves registration order and excludes exhausted automatic candidates", () => {
    const { registry } = memory();
    register(registry, "first", hard(1), undefined, undefined, 1);
    register(registry, "second", hard(1), undefined, undefined, 1);
    register(registry, "third", managed, undefined, undefined, 2);
    registry.consume("first", { capability: "fetch" });

    expect(registry.selectSearchCandidates().map((provider) => provider.name)).toEqual([
      "second",
      "third",
    ]);
    expect(registry.selectSearchCandidates("first")).toEqual([]);
  });

  it("preserves search filter support through the budget wrapper", () => {
    const { registry } = memory();
    const support = { domains: "post-filter", dates: "unsupported" } as const;
    register(registry, "duckduckgo", managed, {
      search: {
        name: "duckduckgo",
        label: "DuckDuckGo",
        filterSupport: support,
        search: vi.fn().mockResolvedValue([]),
      },
    });

    expect(registry.selectSearchCandidates("duckduckgo")[0].filterSupport).toEqual(support);
  });

  it("selects by performance without treating budget use as an outcome", () => {
    const { registry } = memory();
    register(registry, "slow", managed);
    register(registry, "fast", managed);
    registry.recordOutcome("slow", { success: false });
    registry.recordOutcome("fast", { success: true, latencyMs: 10 });
    expect(registry.selectSearchByPerformance()!.name).toBe("fast");
  });
});

describe("ProviderRegistry capability-aware selection", () => {
  it("returns auto candidates in tier order for search, fetch, and research", () => {
    const { registry } = memory();
    // Register in non-tier order to prove tier wins over registration order.
    register(
      registry,
      "tier3-search",
      managed,
      { search: search("tier3-search") },
      undefined,
      3,
    );
    register(
      registry,
      "tier1-search",
      managed,
      { search: search("tier1-search") },
      undefined,
      1,
    );
    register(registry, "tier2-search", managed, { search: search("tier2-search") }, undefined, 2);
    register(registry, "tier3-fetch", managed, { fetch: fetch("tier3-fetch") }, undefined, 3);
    register(registry, "tier1-fetch", managed, { fetch: fetch("tier1-fetch") }, undefined, 1);
    register(registry, "tier2-fetch", managed, { fetch: fetch("tier2-fetch") }, undefined, 2);
    register(registry, "tier3-research", managed, { research: research("tier3-research") }, undefined, 3);
    register(
      registry,
      "tier1-research",
      managed,
      { research: research("tier1-research") },
      undefined,
      1,
    );
    register(
      registry,
      "tier2-research",
      managed,
      { research: research("tier2-research") },
      undefined,
      2,
    );

    expect(registry.selectSearchCandidates().map((p) => p.name)).toEqual([
      "tier1-search",
      "tier2-search",
      "tier3-search",
    ]);
    expect(
      registry.selectFetchCandidates().map((p) => p.name),
    ).toEqual(["tier1-fetch", "tier2-fetch", "tier3-fetch"]);
    expect(
      registry.selectResearchCandidates().map((p) => p.name),
    ).toEqual(["tier1-research", "tier2-research", "tier3-research"]);
  });

  it("returns best-performing eligible candidates for fetch and research", () => {
    const { registry } = memory();
    register(registry, "fast-fetch", managed, { fetch: fetch("fast-fetch") }, undefined, 1);
    register(registry, "slow-fetch", managed, { fetch: fetch("slow-fetch") }, undefined, 2);
    register(
      registry,
      "fast-research",
      managed,
      { research: research("fast-research") },
      undefined,
      1,
    );
    register(
      registry,
      "slow-research",
      managed,
      { research: research("slow-research") },
      undefined,
      2,
    );
    registry.recordOutcome("slow-fetch", { success: true, latencyMs: 500 });
    registry.recordOutcome("fast-fetch", { success: true, latencyMs: 10 });
    registry.recordOutcome("slow-research", { success: true, latencyMs: 800 });
    registry.recordOutcome("fast-research", { success: true, latencyMs: 20 });

    expect(
      registry
        .selectFetchCandidates("best-performing")
        .map((p) => p.name),
    ).toEqual(["fast-fetch", "slow-fetch"]);
    expect(
      registry
        .selectResearchCandidates("best-performing")
        .map((p) => p.name),
    ).toEqual(["fast-research", "slow-research"]);
  });

  it("returns the highest-scored eligible provider for code-search and docs", () => {
    const { registry } = memory();
    register(registry, "low-code", managed, { codeSearch: codeSearch("low-code") }, undefined, 1);
    register(registry, "high-code", managed, { codeSearch: codeSearch("high-code") }, undefined, 2);
    register(registry, "low-docs", managed, { docs: docs("low-docs") }, undefined, 1);
    register(registry, "high-docs", managed, { docs: docs("high-docs") }, undefined, 2);
    registry.recordOutcome("low-code", { success: true, latencyMs: 500 });
    registry.recordOutcome("high-code", { success: true, latencyMs: 20 });
    registry.recordOutcome("low-docs", { success: true, latencyMs: 600 });
    registry.recordOutcome("high-docs", { success: true, latencyMs: 30 });

    expect(registry.selectCodeSearch("best-performing")?.name).toBe("high-code");
    expect(registry.selectDocsByStrategy("best-performing")?.name).toBe("high-docs");
  });

  it("filters exhausted providers from every capability selector", () => {
    // Pre-load counters at the limit so providers are immediately exhausted.
    const save = vi.fn();
    const registry = new ProviderRegistry({
      load: () => ({ version: 2, counters: {} }),
      save,
    });
    register(registry, "exhausted-search", hard(1), { search: search("exhausted-search") });
    register(registry, "exhausted-fetch", hard(1), { fetch: fetch("exhausted-fetch") });
    register(registry, "exhausted-code", hard(1), { codeSearch: codeSearch("exhausted-code") });
    register(registry, "exhausted-docs", hard(1), { docs: docs("exhausted-docs") });
    register(registry, "exhausted-research", hard(1), { research: research("exhausted-research") });
    registry.consume("exhausted-search", { capability: "search", maxResults: 10 });
    registry.consume("exhausted-fetch", { capability: "fetch" });
    registry.consume("exhausted-code", { capability: "code-search", maxResults: 10 });
    registry.consume("exhausted-docs", { capability: "docs-search" });
    registry.consume("exhausted-research", {
      capability: "research",
      type: "deep-lite",
      maxResults: 10,
      contentTypes: 2,
    });

    expect(registry.selectSearchCandidates("exhausted-search")).toEqual([]);
    expect(registry.selectFetchCandidates()).toEqual([]);
    expect(registry.selectCodeSearch()).toBeUndefined();
    expect(registry.selectDocs("exhausted-docs")).toBeUndefined();
    expect(registry.selectResearchCandidates()).toEqual([]);
  });

  it("returns the eligible named docs provider from the existing compat wrapper", () => {
    const { registry } = memory();
    register(registry, "named-docs", managed, { docs: docs("named-docs") });
    register(registry, "other-docs", managed, { docs: docs("other-docs") });

    expect(registry.selectDocs("named-docs")?.name).toBe("named-docs");
    expect(registry.selectDocs()?.name).toBe("named-docs");
  });

  it("calls usageCost with the exact research operation before delegation", async () => {
    const { registry } = memory();
    const client = research("exa");
    let capturedOp: unknown = undefined;
    register(
      registry,
      "exa",
      hard(10),
      { research: client },
      function (op) {
        capturedOp = op;
        return 1;
      },
      1,
    );
    vi.mocked(client.deepResearch).mockResolvedValue({
      results: [],
      raw: {},
      metadata: {},
    });

    await registry
      .selectResearchCandidates()[0]
      .deepResearch(
        {
          query: "test",
          type: "deep",
          numResults: 12,
          summaryQuery: "summarize",
        },
      );

    expect(capturedOp).toEqual({
      capability: "research",
      type: "deep",
      maxResults: 12,
      contentTypes: 3,
    });
  });

  it("exposes fresh execution hook closures recording through registry", () => {
    const { registry } = memory();
    const hooksA = registry.getExecutionHooks();
    const hooksB = registry.getExecutionHooks();
    expect(hooksA).not.toBe(hooksB);
    hooksA.onSuccess?.("exa", 100);
    hooksA.onFailure?.("exa");
    hooksB.onSuccess?.("exa", 50);
    const metrics = registry.getMetrics("exa")!;
    expect(metrics.successes).toBe(2);
    expect(metrics.failures).toBe(1);
    expect(metrics.avgLatency).toBeCloseTo((100 + 50) / 2);
  });

  it("does not include research methods when no research capability is registered", () => {
    const { registry } = memory();
    register(registry, "fetch-only", managed, { fetch: fetch("fetch-only") });
    expect(registry.selectResearchCandidates()).toEqual([]);
  });

  it("uses registered policy keys when filtering automatic candidates", () => {
    const { registry } = memory();
    register(registry, "search-policy", hard(1), { search: search("search-provider") });
    register(registry, "fetch-policy", hard(1), { fetch: fetch("fetch-provider") });
    register(registry, "code-policy", hard(1), { codeSearch: codeSearch("code-provider") });
    register(registry, "docs-policy", hard(1), { docs: docs("docs-provider") });
    register(registry, "research-policy", hard(1), {
      research: research("research-provider"),
    });

    registry.consume("search-policy", { capability: "search", maxResults: 1 });
    registry.consume("fetch-policy", { capability: "fetch" });
    registry.consume("code-policy", { capability: "code-search", maxResults: 1 });
    registry.consume("docs-policy", { capability: "docs-search" });
    registry.consume("research-policy", {
      capability: "research",
      type: "deep-lite",
      maxResults: 1,
      contentTypes: 2,
    });

    expect(registry.selectSearchCandidates()).toEqual([]);
    expect(registry.selectFetchCandidates()).toEqual([]);
    expect(registry.selectCodeSearch()).toBeUndefined();
    expect(registry.selectDocs()).toBeUndefined();
    expect(registry.selectResearchCandidates()).toEqual([]);
  });

  it("keeps the registered policy key on wrapped provider identities", () => {
    const { registry } = memory();
    register(registry, "search-policy", managed, { search: search("search-provider") });

    const provider = registry.selectSearchCandidates()[0];
    expect(provider.name).toBe("search-policy");

    registry.getExecutionHooks().onSuccess?.(provider.name, 10);
    expect(registry.getMetrics("search-policy")).toMatchObject({ successes: 1 });
    expect(registry.getMetrics("search-provider")).toBeUndefined();
  });
});
