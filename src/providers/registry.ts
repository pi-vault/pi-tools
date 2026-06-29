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

export class ProviderRegistry {
  private searchProviders = new Map<string, RegisteredSearch>();
  private fetchProviders = new Map<string, RegisteredFetch>();
  private codeSearchProviders = new Map<string, RegisteredCodeSearch>();
  private tracker: UsageTracker;

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
    if (name && name !== "auto") {
      return this.searchProviders.get(name)?.provider;
    }

    // Auto selection: tier 1 by highest remaining, then tier 2, then tier 3
    for (const tier of [1, 2, 3] as ProviderTier[]) {
      const candidates = [...this.searchProviders.values()]
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

      if (candidates.length > 0) {
        return candidates[0].provider;
      }
    }

    return undefined;
  }

  selectFetch(name?: string): FetchProvider | undefined {
    if (name) return this.fetchProviders.get(name)?.provider;
    const first = this.fetchProviders.values().next();
    return first.done ? undefined : first.value.provider;
  }

  selectCodeSearch(): CodeSearchProvider | undefined {
    const first = this.codeSearchProviders.values().next();
    return first.done ? undefined : first.value.provider;
  }

  getSearchProviderNames(): string[] {
    return [...this.searchProviders.keys()];
  }
}
