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
  SearchProvider,
  UsageCost,
} from "../../src/providers/types.ts";

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

function register(
  registry: ProviderRegistry,
  name: string,
  budget: ProviderBudget,
  instances: {
    search?: SearchProvider;
    fetch?: FetchProvider;
    codeSearch?: CodeSearchProvider;
    docs?: DocsProvider;
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
    expect(registry.selectSearchCandidates("first")[0].name).toBe("first");
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
