import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderRegistry } from "../../src/providers/registry.ts";
import { UsageTracker } from "../../src/providers/usage.ts";
import type { FetchProvider, SearchProvider } from "../../src/providers/types.ts";
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
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
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
    expect(selected?.name).toBe("serper");
  });

  it("falls back to tier 2 when tier 1 exhausted", () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const perplexity = mockProvider("perplexity", "Perplexity");

    registry.registerSearch(perplexity, { tier: 2, monthlyQuota: null });

    const selected = registry.selectSearch();
    expect(selected).toBeDefined();
    expect(selected?.name).toBe("perplexity");
  });

  it("falls back to tier 3 when all others unavailable", () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    const selected = registry.selectSearch();
    expect(selected?.name).toBe("duckduckgo");
  });

  it("selects by name when explicitly requested", () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const brave = mockProvider("brave", "Brave");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    const selected = registry.selectSearch("duckduckgo");
    expect(selected?.name).toBe("duckduckgo");
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
    expect(selected?.name).toBe("duckduckgo");
  });

  describe("selectSearchCandidates", () => {
    it("returns all providers ordered by tier then remaining quota", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
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
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 1 });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      registry.recordUsage("brave"); // exhausted
      const candidates = registry.selectSearchCandidates();
      expect(candidates.map((c) => c.name)).toEqual(["duckduckgo"]);
    });

    it("returns single-element array for explicit provider name", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      const candidates = registry.selectSearchCandidates("duckduckgo");
      expect(candidates.map((c) => c.name)).toEqual(["duckduckgo"]);
    });

    it("returns empty array for unknown explicit provider", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      expect(registry.selectSearchCandidates("nonexistent")).toEqual([]);
    });

    it("returns empty array when no providers registered", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      expect(registry.selectSearchCandidates()).toEqual([]);
    });
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
    expect(selected?.name).toBe("brave"); // still has quota

    registry.recordUsage("brave"); // 1999 used, 1 remaining
    registry.recordUsage("brave"); // 2000 used, 0 remaining
    const afterExhaust = registry.selectSearch();
    expect(afterExhaust?.name).toBe("duckduckgo");
  });

  describe("selectFetchCandidates", () => {
    it("returns all registered fetch providers", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
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
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      expect(registry.selectFetchCandidates()).toEqual([]);
    });
  });

  describe("best-performing selection strategy", () => {
    it("selectSearch uses tier-based selection when strategy is auto", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      // brave is tier 1, should be preferred even if ddg has better metrics
      registry.recordSuccess("duckduckgo", 100);
      registry.recordFailure("brave");

      const selected = registry.selectSearch();
      expect(selected?.name).toBe("brave");
    });

    it("selectSearchByPerformance scores providers by success rate, speed, and tier", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      const exa = mockProvider("exa", "Exa");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(exa, { tier: 1, monthlyQuota: 1000 });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      // brave: 100% success, fast
      registry.recordSuccess("brave", 200);
      registry.recordSuccess("brave", 200);

      // exa: 50% success, slower
      registry.recordSuccess("exa", 600);
      registry.recordFailure("exa");

      // ddg: 100% success, very slow, low tier
      registry.recordSuccess("duckduckgo", 1000);

      const selected = registry.selectSearchByPerformance();
      // brave should win: perfect success rate, fast, tier 1
      expect(selected?.name).toBe("brave");
    });

    it("selectSearchByPerformance falls back to tier-based when no metrics exist", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      // No metrics recorded — should fall back to tier-based (like selectSearch)
      const selected = registry.selectSearchByPerformance();
      expect(selected?.name).toBe("brave");
    });

    it("selectSearchByPerformance excludes exhausted providers", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 1 });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      registry.recordUsage("brave"); // exhausted
      registry.recordSuccess("brave", 200);

      const selected = registry.selectSearchByPerformance();
      expect(selected?.name).toBe("duckduckgo");
    });

    it("selectSearchByPerformance prefers fast provider with good success rate over slow tier-1", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      const perplexity = mockProvider("perplexity", "Perplexity");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(perplexity, { tier: 2, monthlyQuota: null });

      // brave: 50% success, slow
      registry.recordSuccess("brave", 2000);
      registry.recordFailure("brave");

      // perplexity: 100% success, fast (tier 2 but much better performance)
      registry.recordSuccess("perplexity", 100);
      registry.recordSuccess("perplexity", 100);
      registry.recordSuccess("perplexity", 100);

      const selected = registry.selectSearchByPerformance();
      // perplexity should win due to much better success rate and speed
      expect(selected?.name).toBe("perplexity");
    });

    it("selectSearchByPerformance returns undefined when no providers registered", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      expect(registry.selectSearchByPerformance()).toBeUndefined();
    });

    it("selectSearchByPerformance selects explicit provider by name", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      const selected = registry.selectSearchByPerformance("duckduckgo");
      expect(selected?.name).toBe("duckduckgo");
    });
  });

  describe("session metrics", () => {
    it("records success with latency", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

      registry.recordSuccess("brave", 340);
      registry.recordSuccess("brave", 500);

      const metrics = registry.getMetrics("brave");
      expect(metrics).toBeDefined();
      expect(metrics!.successes).toBe(2);
      expect(metrics!.failures).toBe(0);
      expect(metrics!.totalLatencyMs).toBe(840);
    });

    it("records failure", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

      registry.recordFailure("brave");
      registry.recordFailure("brave");

      const metrics = registry.getMetrics("brave");
      expect(metrics).toBeDefined();
      expect(metrics!.successes).toBe(0);
      expect(metrics!.failures).toBe(2);
      expect(metrics!.totalLatencyMs).toBe(0);
    });

    it("returns undefined metrics for unknown provider", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      expect(registry.getMetrics("unknown")).toBeUndefined();
    });

    it("tracks metrics independently per provider", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      const exa = mockProvider("exa", "Exa");
      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(exa, { tier: 1, monthlyQuota: 1000 });

      registry.recordSuccess("brave", 300);
      registry.recordFailure("exa");
      registry.recordSuccess("exa", 600);

      const braveMetrics = registry.getMetrics("brave")!;
      expect(braveMetrics.successes).toBe(1);
      expect(braveMetrics.failures).toBe(0);

      const exaMetrics = registry.getMetrics("exa")!;
      expect(exaMetrics.successes).toBe(1);
      expect(exaMetrics.failures).toBe(1);
      expect(exaMetrics.totalLatencyMs).toBe(600);
    });

    it("getAllMetrics returns all tracked providers", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      const exa = mockProvider("exa", "Exa");
      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(exa, { tier: 1, monthlyQuota: 1000 });

      registry.recordSuccess("brave", 300);
      registry.recordSuccess("exa", 600);

      const all = registry.getAllMetrics();
      expect(all.size).toBe(2);
      expect(all.get("brave")?.successes).toBe(1);
      expect(all.get("exa")?.successes).toBe(1);
    });
  });
});
