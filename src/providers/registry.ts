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

export interface ProviderMetrics {
  successes: number;
  failures: number;
  totalLatencyMs: number;
}

export class ProviderRegistry {
  private searchProviders = new Map<string, RegisteredSearch>();
  private fetchProviders = new Map<string, RegisteredFetch>();
  private codeSearchProviders = new Map<string, RegisteredCodeSearch>();
  private tracker: UsageTracker;
  private metrics = new Map<string, ProviderMetrics>();

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
    return this.selectSearchCandidates(name)[0];
  }

  selectSearchCandidates(name?: string): SearchProvider[] {
    if (name && name !== "auto") {
      const provider = this.searchProviders.get(name)?.provider;
      return provider ? [provider] : [];
    }

    const candidates: SearchProvider[] = [];
    for (const tier of [1, 2, 3] as ProviderTier[]) {
      const tierCandidates = [...this.searchProviders.values()]
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
      candidates.push(...tierCandidates.map((c) => c.provider));
    }
    return candidates;
  }

  // Scoring weights for best-performing strategy
  static readonly WEIGHT_SUCCESS = 0.5;
  static readonly WEIGHT_SPEED = 0.3;
  static readonly WEIGHT_TIER = 0.2;

  /**
   * Select the best search provider based on session performance metrics.
   *
   * Score formula:
   *   score = (success_rate * WEIGHT_SUCCESS) + (speed_score * WEIGHT_SPEED) + (tier_score * WEIGHT_TIER)
   *
   * Where:
   *   success_rate = successes / (successes + failures)
   *   speed_score  = 1 - (avg_latency / max_avg_latency)
   *   tier_score   = { 1: 1.0, 2: 0.6, 3: 0.3 }
   *
   * Providers with no metrics are scored using tier_score only (conservative default).
   */
  selectSearchByPerformance(name?: string): SearchProvider | undefined {
    if (name && name !== "auto") {
      return this.searchProviders.get(name)?.provider;
    }

    // Build list of eligible (non-exhausted) providers
    const eligible = [...this.searchProviders.values()].filter((r) => {
      if (r.monthlyQuota === null) return true;
      return this.tracker.getCount(r.provider.name) < r.monthlyQuota;
    });

    if (eligible.length === 0) return undefined;

    const TIER_SCORES: Record<number, number> = { 1: 1.0, 2: 0.6, 3: 0.3 };

    const scored = eligible.map((r) => {
      const m = this.metrics.get(r.provider.name);
      const tierScore = TIER_SCORES[r.tier] ?? 0.3;

      if (!m || (m.successes + m.failures) === 0) {
        // No data — score is tier_score * WEIGHT_TIER only (conservative default)
        return { provider: r.provider, score: tierScore * ProviderRegistry.WEIGHT_TIER };
      }

      const total = m.successes + m.failures;
      const successRate = m.successes / total;
      const avgLatency = m.successes > 0 ? m.totalLatencyMs / m.successes : Infinity;

      return { provider: r.provider, score: 0, avgLatency, successRate, tierScore };
    });

    // Find max average latency among providers that have data
    const latencies = scored
      .filter((s) => "avgLatency" in s && s.avgLatency !== Infinity)
      .map((s) => (s as { avgLatency: number }).avgLatency);
    const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 1;

    // Compute final scores
    for (const s of scored) {
      if ("successRate" in s && s.successRate !== undefined) {
        const speedScore = s.avgLatency === Infinity ? 0 : 1 - (s.avgLatency / (maxLatency || 1));
        s.score = (s.successRate * ProviderRegistry.WEIGHT_SUCCESS)
          + (speedScore * ProviderRegistry.WEIGHT_SPEED)
          + (s.tierScore! * ProviderRegistry.WEIGHT_TIER);
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return scored[0]?.provider;
  }

  selectFetchCandidates(): FetchProvider[] {
    return [...this.fetchProviders.values()].map((r) => r.provider);
  }

  selectCodeSearch(): CodeSearchProvider | undefined {
    const first = this.codeSearchProviders.values().next();
    return first.done ? undefined : first.value.provider;
  }

  getSearchProviderNames(): string[] {
    return [...this.searchProviders.keys()];
  }

  recordSuccess(providerName: string, latencyMs: number): void {
    const m = this.metrics.get(providerName) ?? { successes: 0, failures: 0, totalLatencyMs: 0 };
    m.successes += 1;
    m.totalLatencyMs += latencyMs;
    this.metrics.set(providerName, m);
  }

  recordFailure(providerName: string): void {
    const m = this.metrics.get(providerName) ?? { successes: 0, failures: 0, totalLatencyMs: 0 };
    m.failures += 1;
    this.metrics.set(providerName, m);
  }

  getMetrics(providerName: string): ProviderMetrics | undefined {
    return this.metrics.get(providerName);
  }

  getAllMetrics(): ReadonlyMap<string, ProviderMetrics> {
    return this.metrics;
  }
}
