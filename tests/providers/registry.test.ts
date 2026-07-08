import { describe, expect, it, vi } from "vitest";
import { ProviderRegistry } from "../../src/providers/registry.ts";
import type { DocsProvider, FetchProvider, SearchProvider } from "../../src/providers/types.ts";

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
    const selected = registry.selectSearchCandidates()[0];
    expect(selected).toBeDefined();
    expect(selected?.name).toBe("serper");
  });

  it("falls back to tier 2 when tier 1 exhausted", () => {
    const registry = mem();
    const perplexity = mockProvider("perplexity", "Perplexity");

    registry.registerSearch(perplexity, { tier: 2, monthlyQuota: null });

    const selected = registry.selectSearchCandidates()[0];
    expect(selected).toBeDefined();
    expect(selected?.name).toBe("perplexity");
  });

  it("falls back to tier 3 when all others unavailable", () => {
    const registry = mem();
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    const selected = registry.selectSearchCandidates()[0];
    expect(selected?.name).toBe("duckduckgo");
  });

  it("selects by name when explicitly requested", () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    const selected = registry.selectSearchCandidates("duckduckgo")[0];
    expect(selected?.name).toBe("duckduckgo");
  });

  it("returns undefined when no providers registered", () => {
    const registry = mem();
    expect(registry.selectSearchCandidates()[0]).toBeUndefined();
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
    const selected = registry.selectSearchCandidates()[0];
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
    const selected = registry.selectSearchCandidates()[0];
    expect(selected?.name).toBe("brave"); // still has quota

    registry.recordOutcome("brave", { success: true }); // 1999 used, 1 remaining
    registry.recordOutcome("brave", { success: true }); // 2000 used, 0 remaining
    const afterExhaust = registry.selectSearchCandidates()[0];
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
    it("selectSearchCandidates uses tier-based selection when strategy is auto", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      // brave is tier 1, should be preferred even if ddg has better metrics
      registry.recordOutcome("duckduckgo", { success: true, latencyMs: 100 });
      registry.recordOutcome("brave", { success: false });

      const selected = registry.selectSearchCandidates()[0];
      expect(selected?.name).toBe("brave");
    });

    it("selectSearchByPerformance scores providers by success rate, speed, and quality", () => {
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

      // ddg: 100% success, very slow
      registry.recordOutcome("duckduckgo", { success: true, latencyMs: 1000 });

      const selected = registry.selectSearchByPerformance();
      // brave should win: perfect success rate, fast, default quality
      expect(selected?.name).toBe("brave");
    });

    it("selectSearchByPerformance assigns neutral score when no metrics exist", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      // No metrics — all providers get score 0.5 (neutral)
      const selected = registry.selectSearchByPerformance();
      expect(selected).toBeDefined();
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

    it("selectSearchByPerformance prefers provider with better result quality", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      const exa = mockProvider("exa", "Exa");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(exa, { tier: 1, monthlyQuota: 1000 });

      // Both: 100% success, same latency
      registry.recordOutcome("brave", { success: true, latencyMs: 300 });
      registry.recordOutcome("exa", { success: true, latencyMs: 300 });

      // brave: poor result quality (1/5 = 0.2)
      registry.recordResultQuality("brave", 1, 5);
      // exa: excellent result quality (5/5 = 1.0)
      registry.recordResultQuality("exa", 5, 5);

      const selected = registry.selectSearchByPerformance();
      expect(selected?.name).toBe("exa");
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
      expect(metrics?.avgLatency).toBe(300);
      expect(metrics?.latencySamples).toBe(1);
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
      expect(metrics!.avgLatency).toBe(420);
      expect(metrics!.latencySamples).toBe(2);
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
      expect(metrics!.avgLatency).toBe(0);
      expect(metrics!.latencySamples).toBe(0);
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
      expect(exaMetrics.avgLatency).toBe(600);
      expect(exaMetrics.latencySamples).toBe(1);
    });

    it("resets metrics after the rolling window expires", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

      registry.recordOutcome("brave", { success: true, latencyMs: 200 });
      registry.recordOutcome("brave", { success: false });

      const before = registry.getMetrics("brave");
      expect(before!.successes).toBe(1);
      expect(before!.failures).toBe(1);

      // Simulate window expiry
      registry.expireMetricsWindow("brave");
      registry.recordOutcome("brave", { success: true, latencyMs: 100 });

      const after = registry.getMetrics("brave");
      expect(after!.successes).toBe(1); // Reset: only the new call
      expect(after!.failures).toBe(0); // Reset: old failure gone
      expect(after!.avgLatency).toBe(100); // Reset: only the new latency
      expect(after!.latencySamples).toBe(1);
    });

    it("computes running average for latency", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

      registry.recordOutcome("brave", { success: true, latencyMs: 200 });
      registry.recordOutcome("brave", { success: true, latencyMs: 400 });

      const metrics = registry.getMetrics("brave");
      expect(metrics!.avgLatency).toBe(300);
      expect(metrics!.latencySamples).toBe(2);
    });

    it("does not update latency when latencyMs is omitted", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

      registry.recordOutcome("brave", { success: true });

      const metrics = registry.getMetrics("brave");
      expect(metrics!.successes).toBe(1);
      expect(metrics!.avgLatency).toBe(0);
      expect(metrics!.latencySamples).toBe(0);
    });
  });

  describe("result quality tracking", () => {
    it("recordResultQuality updates avgResultRatio", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

      registry.recordOutcome("brave", { success: true, latencyMs: 200 });
      registry.recordResultQuality("brave", 5, 5);

      const metrics = registry.getMetrics("brave");
      expect(metrics!.avgResultRatio).toBe(1.0);
      expect(metrics!.resultSamples).toBe(1);
    });

    it("avgResultRatio converges to running average", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

      registry.recordOutcome("brave", { success: true, latencyMs: 200 });
      registry.recordResultQuality("brave", 5, 5);
      registry.recordResultQuality("brave", 2, 5);

      const metrics = registry.getMetrics("brave");
      expect(metrics!.avgResultRatio).toBeCloseTo(0.7);
      expect(metrics!.resultSamples).toBe(2);
    });

    it("recordResultQuality does nothing when requestedCount is 0", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

      registry.recordOutcome("brave", { success: true, latencyMs: 200 });
      registry.recordResultQuality("brave", 0, 0);

      const metrics = registry.getMetrics("brave");
      expect(metrics!.resultSamples).toBe(0);
      expect(metrics!.avgResultRatio).toBe(0);
    });

    it("does not increment successes or failures", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

      registry.recordOutcome("brave", { success: true, latencyMs: 200 });
      registry.recordResultQuality("brave", 3, 5);

      const metrics = registry.getMetrics("brave");
      expect(metrics!.successes).toBe(1);
      expect(metrics!.failures).toBe(0);
    });

    it("clamps ratio to 1.0 when resultCount exceeds requestedCount", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

      registry.recordOutcome("brave", { success: true, latencyMs: 200 });
      registry.recordResultQuality("brave", 10, 5);

      const metrics = registry.getMetrics("brave");
      expect(metrics!.avgResultRatio).toBe(1.0);
    });

    it("ignores negative resultCount", () => {
      const registry = mem();
      const brave = mockProvider("brave", "Brave");
      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

      registry.recordOutcome("brave", { success: true, latencyMs: 200 });
      registry.recordResultQuality("brave", -1, 5);

      const metrics = registry.getMetrics("brave");
      expect(metrics!.resultSamples).toBe(0);
    });
  });
});

describe("docs provider registration", () => {
  it("selectDocs returns undefined when no docs provider registered", () => {
    const registry = mem();
    expect(registry.selectDocs()).toBeUndefined();
  });

  it("registerDocs and selectDocs round-trip", () => {
    const registry = mem();
    const docsProvider: DocsProvider = {
      name: "context7",
      label: "Context7",
      searchLibrary: vi.fn(),
      getContext: vi.fn(),
    };
    registry.registerDocs(docsProvider);
    expect(registry.selectDocs()).toBe(docsProvider);
  });
});
