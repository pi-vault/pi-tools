import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { SearchProvider, FetchProvider, CodeSearchProvider, DocsProvider, ProviderTier } from "./types.ts";

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

interface UsageRecord {
  count: number;
  month: string;
}

export interface PersistenceAdapter {
  load(): Record<string, UsageRecord>;
  save(data: Record<string, UsageRecord>): void;
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export class ProviderRegistry {
  private searchProviders = new Map<string, RegisteredSearch>();
  private fetchProviders = new Map<string, RegisteredFetch>();
  private codeSearchProviders = new Map<string, RegisteredCodeSearch>();
  private docsProvider: DocsProvider | undefined;
  private metrics = new Map<string, ProviderMetrics>();
  private counts: Record<string, number> = {};
  private currentMonth: string;
  private persistence: PersistenceAdapter;

  constructor(persistence: PersistenceAdapter) {
    this.persistence = persistence;
    this.currentMonth = getCurrentMonth();
    this.loadUsage();
  }

  private loadUsage(): void {
    const data = this.persistence.load();
    for (const [name, record] of Object.entries(data)) {
      if (record.month === this.currentMonth) {
        this.counts[name] = record.count;
      }
      // Different month — counts reset to 0 (already initialized)
    }
  }

  private saveUsage(): void {
    const data: Record<string, UsageRecord> = {};
    for (const [name, count] of Object.entries(this.counts)) {
      data[name] = { count, month: this.currentMonth };
    }
    this.persistence.save(data);
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

  recordOutcome(providerName: string, result: { success: boolean; latencyMs?: number }): void {
    // Increment usage count (both success and failure count as a "use")
    this.counts[providerName] = (this.counts[providerName] ?? 0) + 1;
    this.saveUsage();

    // Update performance metrics
    const m = this.metrics.get(providerName) ?? { successes: 0, failures: 0, totalLatencyMs: 0 };
    if (result.success) {
      m.successes += 1;
      m.totalLatencyMs += result.latencyMs ?? 0;
    } else {
      m.failures += 1;
    }
    this.metrics.set(providerName, m);
  }

  getRemaining(providerName: string): number {
    const reg = this.searchProviders.get(providerName);
    if (!reg) return 0;
    if (reg.monthlyQuota === null) return Infinity;
    return Math.max(0, reg.monthlyQuota - (this.counts[providerName] ?? 0));
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
          return (this.counts[r.provider.name] ?? 0) < r.monthlyQuota;
        })
        .sort((a, b) => this.getRemaining(b.provider.name) - this.getRemaining(a.provider.name));
      candidates.push(...tierCandidates.map((c) => c.provider));
    }
    return candidates;
  }

  /**
   * Select the best search provider based on session performance metrics.
   *
   * Score = (success_rate * 0.5) + (speed_score * 0.3) + (tier_score * 0.2)
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
      return (this.counts[r.provider.name] ?? 0) < r.monthlyQuota;
    });

    if (eligible.length === 0) return undefined;

    const TIER_SCORES: Record<number, number> = { 1: 1.0, 2: 0.6, 3: 0.3 };

    const scored = eligible.map((r) => {
      const m = this.metrics.get(r.provider.name);
      const tierScore = TIER_SCORES[r.tier] ?? 0.3;

      if (!m || (m.successes + m.failures) === 0) {
        return { provider: r.provider, score: tierScore * 0.2 };
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
        s.score = (s.successRate * 0.5) + (speedScore * 0.3) + (s.tierScore! * 0.2);
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

  registerDocs(provider: DocsProvider): void {
    this.docsProvider = provider;
  }

  selectDocs(): DocsProvider | undefined {
    return this.docsProvider;
  }

  getSearchProviderNames(): string[] {
    return [...this.searchProviders.keys()];
  }

  getMetrics(providerName: string): ProviderMetrics | undefined {
    return this.metrics.get(providerName);
  }
}

export function createFilePersistence(filePath?: string): PersistenceAdapter {
  const usagePath = filePath ?? path.join(os.homedir(), ".pi", "agent", "tools-usage.json");

  return {
    load(): Record<string, UsageRecord> {
      try {
        return JSON.parse(fs.readFileSync(usagePath, "utf-8")) as Record<string, UsageRecord>;
      } catch {}
      return {};
    },
    save(data: Record<string, UsageRecord>): void {
      try {
        fs.mkdirSync(path.dirname(usagePath), { recursive: true });
        fs.writeFileSync(usagePath, JSON.stringify(data, null, 2));
      } catch {
        // Non-fatal: usage tracking is best-effort
      }
    },
  };
}
