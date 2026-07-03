import { describe, expect, it, vi } from "vitest";
import { ProviderRegistry } from "../../src/providers/registry.ts";
import type { FetchProvider, SearchProvider } from "../../src/providers/types.ts";

function mockProvider(name: string, label: string): SearchProvider {
  return {
    name,
    label,
    search: vi.fn().mockResolvedValue([
      { title: `${name} result`, url: `https://${name}.com`, snippet: "test" },
    ]),
  };
}

const mem = () => new ProviderRegistry({ load: () => ({}), save: () => {} });

describe("ProviderRegistry", () => {
  it("selects tier 1 provider with highest remaining quota", () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    const serper = mockProvider("serper", "Serper");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
    registry.registerSearch(serper, { tier: 1, monthlyQuota: 2500 });

    // Serper has higher remaining (2500 vs 2000)
    const selected = registry.selectSearch();
    expect(selected).toBeDefined();
    expect(selected?.name).toBe("serper");
  });

  it("falls back to tier 2 when tier 1 exhausted", () => {
    const registry = mem();
    const perplexity = mockProvider("perplexity", "Perplexity");

    registry.registerSearch(perplexity, { tier: 2, monthlyQuota: null });

    const selected = registry.selectSearch();
    expect(selected).toBeDefined();
    expect(selected?.name).toBe("perplexity");
  });

  it("falls back to tier 3 when all others unavailable", () => {
    const registry = mem();
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    const selected = registry.selectSearch();
    expect(selected?.name).toBe("duckduckgo");
  });

  it("selects by name when explicitly requested", () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    const selected = registry.selectSearch("duckduckgo");
    expect(selected?.name).toBe("duckduckgo");
  });

  it("returns undefined when no providers registered", () => {
    const registry = mem();
    expect(registry.selectSearch()).toBeUndefined();
  });

  it("records usage via tracker and reflects in remaining quota", () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

    registry.recordOutcome("brave", { success: true });
    expect(registry.getRemaining("brave")).toBe(1999);
  });

  it("skips providers at 100% usage", () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 1 });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    registry.recordOutcome("brave", { success: true }); // Now at 100%
    const selected = registry.selectSearch();
    expect(selected?.name).toBe("duckduckgo");
  });

  describe("selectSearchCandidates", () => {
    it("returns all providers ordered by tier then remaining quota", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      const serper = mockProvider("serper", "Serper");
      const perplexity = mockProvider("perplexity", "Perplexity");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(serper, { tier: 1, monthlyQuota: 2500 });
      registry.registerSearch(perplexity, { tier: 2, monthlyQuota: null });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      const candidates = registry.selectSearchCandidates();
      expect(candidates.map((c) => c.name)).toEqual([
        "serper", // tier 1, highest remaining (2500)
        "brave", // tier 1, lower remaining (2000)
        "perplexity", // tier 2
        "duckduckgo", // tier 3
      ]);
    });

    it("excludes exhausted providers", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 1 });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      registry.recordOutcome("brave", { success: true }); // exhausted
      const candidates = registry.selectSearchCandidates();
      expect(candidates.map((c) => c.name)).toEqual(["duckduckgo"]);
    });

    it("returns single-element array for explicit provider name", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      const candidates = registry.selectSearchCandidates("duckduckgo");
      expect(candidates.map((c) => c.name)).toEqual(["duckduckgo"]);
    });

    it("returns empty array for unknown explicit provider", () => {
      const registry = mem();
      expect(registry.selectSearchCandidates("nonexistent")).toEqual([]);
    });

    it("returns empty array when no providers registered", () => {
      const registry = mem();
      expect(registry.selectSearchCandidates()).toEqual([]);
    });
  });

  it("resets counts when loaded data is from a previous month", () => {
    // Stale month data — should be ignored, counts start at 0
    const adapter = {
      load: () => ({ brave: { count: 1500, month: "2025-01" } }),
      save: () => {},
    };
    const registry = new ProviderRegistry(adapter);
    const brave = mockProvider("brave", "Brave");
    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

    // Full quota available despite persisted count
    expect(registry.getRemaining("brave")).toBe(2000);
  });

  it("persists usage across registry instances sharing the same adapter state", () => {
    const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const adapter = {
      load: () => ({ brave: { count: 1998, month } }),
      save: vi.fn(),
    };
    const registry = new ProviderRegistry(adapter);
    const brave = mockProvider("brave", "Brave");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    // Only 2 remaining for brave
    expect(registry.getRemaining("brave")).toBe(2);
    const selected = registry.selectSearch();
    expect(selected?.name).toBe("brave"); // still has quota

    registry.recordOutcome("brave", { success: true }); // 1999 used, 1 remaining
    registry.recordOutcome("brave", { success: true }); // 2000 used, 0 remaining
    const afterExhaust = registry.selectSearch();
    expect(afterExhaust?.name).toBe("duckduckgo");
  });

  describe("selectFetchCandidates", () => {
    it("returns all registered fetch providers", () => {
      const registry = mem();
      const jina: FetchProvider = {
        name: "jina",
        fetch: vi.fn().mockResolvedValue({ text: "content", title: "Title" }),
      };
      const exa: FetchProvider = {
        name: "exa",
        fetch: vi.fn().mockResolvedValue({ text: "content", title: "Title" }),
      };

      registry.registerFetch(jina);
      registry.registerFetch(exa);

      const candidates = registry.selectFetchCandidates();
      expect(candidates.map((c) => c.name)).toEqual(["jina", "exa"]);
    });

    it("returns empty array when no fetch providers registered", () => {
      const registry = mem();
      expect(registry.selectFetchCandidates()).toEqual([]);
    });
  });

  describe("best-performing selection strategy", () => {
    it("selectSearch uses tier-based selection when strategy is auto", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      // brave is tier 1, should be preferred even if ddg has better metrics
      registry.recordOutcome("duckduckgo", { success: true, latencyMs: 100 });
      registry.recordOutcome("brave", { success: false });

      const selected = registry.selectSearch();
      expect(selected?.name).toBe("brave");
    });

    it("selectSearchByPerformance scores providers by success rate, speed, and tier", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      const exa = mockProvider("exa", "Exa");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(exa, { tier: 1, monthlyQuota: 1000 });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      // brave: 100% success, fast
      registry.recordOutcome("brave", { success: true, latencyMs: 200 });
      registry.recordOutcome("brave", { success: true, latencyMs: 200 });

      // exa: 50% success, slower
      registry.recordOutcome("exa", { success: true, latencyMs: 600 });
      registry.recordOutcome("exa", { success: false });

      // ddg: 100% success, very slow, low tier
      registry.recordOutcome("duckduckgo", { success: true, latencyMs: 1000 });

      const selected = registry.selectSearchByPerformance();
      // brave should win: perfect success rate, fast, tier 1
      expect(selected?.name).toBe("brave");
    });

    it("selectSearchByPerformance falls back to tier-based when no metrics exist", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      // No metrics recorded — should fall back to tier-based (like selectSearch)
      const selected = registry.selectSearchByPerformance();
      expect(selected?.name).toBe("brave");
    });

    it("selectSearchByPerformance excludes exhausted providers", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 1 });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      registry.recordOutcome("brave", { success: true }); // exhausted
      registry.recordOutcome("brave", { success: true, latencyMs: 200 }); // still exhausted (quota=1)

      const selected = registry.selectSearchByPerformance();
      expect(selected?.name).toBe("duckduckgo");
    });

    it("selectSearchByPerformance prefers fast provider with good success rate over slow tier-1", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      const perplexity = mockProvider("perplexity", "Perplexity");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(perplexity, { tier: 2, monthlyQuota: null });

      // brave: 50% success, slow
      registry.recordOutcome("brave", { success: true, latencyMs: 2000 });
      registry.recordOutcome("brave", { success: false });

      // perplexity: 100% success, fast (tier 2 but much better performance)
      registry.recordOutcome("perplexity", { success: true, latencyMs: 100 });
      registry.recordOutcome("perplexity", { success: true, latencyMs: 100 });
      registry.recordOutcome("perplexity", { success: true, latencyMs: 100 });

      const selected = registry.selectSearchByPerformance();
      // perplexity should win due to much better success rate and speed
      expect(selected?.name).toBe("perplexity");
    });

    it("selectSearchByPerformance returns undefined when no providers registered", () => {
      const registry = mem();
      expect(registry.selectSearchByPerformance()).toBeUndefined();
    });

    it("selectSearchByPerformance selects explicit provider by name", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      const selected = registry.selectSearchByPerformance("duckduckgo");
      expect(selected?.name).toBe("duckduckgo");
    });
  });

  describe("recordOutcome", () => {
    it("increments usage count on success", () => {
      const registry = new ProviderRegistry({ load: () => ({}), save: () => {} });
      const provider = mockProvider("brave", "Brave");
      registry.registerSearch(provider, { tier: 1, monthlyQuota: 2000 });

      registry.recordOutcome("brave", { success: true, latencyMs: 200 });

      // Should track 1 usage
      expect(registry.getRemaining("brave")).toBe(1999);
    });

    it("increments usage count on failure", () => {
      const registry = new ProviderRegistry({ load: () => ({}), save: () => {} });
      const provider = mockProvider("brave", "Brave");
      registry.registerSearch(provider, { tier: 1, monthlyQuota: 2000 });

      registry.recordOutcome("brave", { success: false });

      expect(registry.getRemaining("brave")).toBe(1999);
    });

    it("records latency for performance scoring on success", () => {
      const registry = new ProviderRegistry({ load: () => ({}), save: () => {} });
      const provider = mockProvider("brave", "Brave");
      registry.registerSearch(provider, { tier: 1, monthlyQuota: 2000 });

      registry.recordOutcome("brave", { success: true, latencyMs: 300 });

      const metrics = registry.getMetrics("brave");
      expect(metrics?.successes).toBe(1);
      expect(metrics?.totalLatencyMs).toBe(300);
    });

    it("records failure for performance scoring", () => {
      const registry = new ProviderRegistry({ load: () => ({}), save: () => {} });
      const provider = mockProvider("brave", "Brave");
      registry.registerSearch(provider, { tier: 1, monthlyQuota: 2000 });

      registry.recordOutcome("brave", { success: false });

      const metrics = registry.getMetrics("brave");
      expect(metrics?.failures).toBe(1);
    });
  });

  describe("session metrics", () => {
    it("records success with latency", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

      registry.recordOutcome("brave", { success: true, latencyMs: 340 });
      registry.recordOutcome("brave", { success: true, latencyMs: 500 });

      const metrics = registry.getMetrics("brave");
      expect(metrics).toBeDefined();
      expect(metrics!.successes).toBe(2);
      expect(metrics!.failures).toBe(0);
      expect(metrics!.totalLatencyMs).toBe(840);
    });

    it("records failure", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

      registry.recordOutcome("brave", { success: false });
      registry.recordOutcome("brave", { success: false });

      const metrics = registry.getMetrics("brave");
      expect(metrics).toBeDefined();
      expect(metrics!.successes).toBe(0);
      expect(metrics!.failures).toBe(2);
      expect(metrics!.totalLatencyMs).toBe(0);
    });

    it("returns undefined metrics for unknown provider", () => {
      const registry = mem();
      expect(registry.getMetrics("unknown")).toBeUndefined();
    });

    it("tracks metrics independently per provider", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      const exa = mockProvider("exa", "Exa");
      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(exa, { tier: 1, monthlyQuota: 1000 });

      registry.recordOutcome("brave", { success: true, latencyMs: 300 });
      registry.recordOutcome("exa", { success: false });
      registry.recordOutcome("exa", { success: true, latencyMs: 600 });

      const braveMetrics = registry.getMetrics("brave")!;
      expect(braveMetrics.successes).toBe(1);
      expect(braveMetrics.failures).toBe(0);

      const exaMetrics = registry.getMetrics("exa")!;
      expect(exaMetrics.successes).toBe(1);
      expect(exaMetrics.failures).toBe(1);
      expect(exaMetrics.totalLatencyMs).toBe(600);
    });
  });
});
