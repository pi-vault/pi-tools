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
