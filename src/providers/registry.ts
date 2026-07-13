import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SelectionStrategy } from "../config.ts";
import type {
  CodeSearchProvider,
  DocsProvider,
  FetchProvider,
  ProviderTier,
  SearchProvider,
} from "./types.ts";

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
  avgLatency: number;
  latencySamples: number;
  avgResultRatio: number;
  resultSamples: number;
  windowStart: number;
}

const METRICS_WINDOW_MS = 60_000;

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

  private getOrCreateMetrics(providerName: string): ProviderMetrics {
    const now = Date.now();
    const existing = this.metrics.get(providerName);
    if (existing && now - existing.windowStart <= METRICS_WINDOW_MS) {
      return existing;
    }
    const fresh: ProviderMetrics = {
      successes: 0,
      failures: 0,
      avgLatency: 0,
      latencySamples: 0,
      avgResultRatio: 0,
      resultSamples: 0,
      windowStart: now,
    };
    this.metrics.set(providerName, fresh);
    return fresh;
  }

  /** Returns metrics only if within the active window, undefined otherwise. */
  private getActiveMetrics(providerName: string): ProviderMetrics | undefined {
    const m = this.metrics.get(providerName);
    if (!m) return undefined;
    if (Date.now() - m.windowStart > METRICS_WINDOW_MS) return undefined;
    return m;
  }

  /**
   * Score all eligible (non-exhausted) providers by composite metric.
   *
   * Score = (success_rate * 0.5) + (speed_score * 0.3) + (quality_score * 0.2)
   *
   * Providers with no active metrics get a neutral score of 0.5.
   * Returns the full sorted array (descending by score).
   */
  private scoreEligibleProviders(): Array<{ provider: SearchProvider; score: number }> {
    const eligible = [...this.searchProviders.values()].filter((r) => {
      if (r.monthlyQuota === null) return true;
      return (this.counts[r.provider.name] ?? 0) < r.monthlyQuota;
    });

    if (eligible.length === 0) return [];

    const metricsEntries: Array<{
      provider: SearchProvider;
      successRate: number;
      avgLatency: number;
      qualityScore: number;
    }> = [];
    const neutralEntries: Array<{ provider: SearchProvider; score: number }> = [];

    for (const r of eligible) {
      const m = this.getActiveMetrics(r.provider.name);
      if (!m || m.successes + m.failures === 0) {
        neutralEntries.push({ provider: r.provider, score: 0.5 });
      } else {
        const total = m.successes + m.failures;
        metricsEntries.push({
          provider: r.provider,
          successRate: m.successes / total,
          avgLatency: m.latencySamples > 0 ? m.avgLatency : Infinity,
          qualityScore: m.resultSamples > 0 ? m.avgResultRatio : 0.5,
        });
      }
    }

    const finiteLatencies = metricsEntries.map((e) => e.avgLatency).filter((l) => l !== Infinity);
    const maxLatency = finiteLatencies.length > 0 ? Math.max(...finiteLatencies) : 1;

    const scoredEntries = metricsEntries.map((e) => {
      const speedScore =
        e.avgLatency === Infinity ? 0 : Math.max(0, 1 - e.avgLatency / (maxLatency || 1));
      return {
        provider: e.provider,
        score: e.successRate * 0.5 + speedScore * 0.3 + e.qualityScore * 0.2,
      };
    });

    return [...scoredEntries, ...neutralEntries].sort((a, b) => b.score - a.score);
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

  unregisterAll(name: string): void {
    this.searchProviders.delete(name);
    this.fetchProviders.delete(name);
    this.codeSearchProviders.delete(name);
    if (this.docsProvider?.name === name) {
      this.docsProvider = undefined;
    }
  }

  recordOutcome(providerName: string, result: { success: boolean; latencyMs?: number }): void {
    // Increment usage count (both success and failure count as a "use")
    const prevCount = this.counts[providerName] ?? 0;
    this.counts[providerName] = prevCount + 1;
    this.saveUsage();

    // Emit quota warning when crossing the threshold
    const reg = this.searchProviders.get(providerName);
    if (reg?.monthlyQuota !== null && reg?.monthlyQuota !== undefined) {
      const threshold = Math.floor(reg.monthlyQuota * ProviderRegistry.QUOTA_WARN_RATIO);
      if (prevCount < threshold && this.counts[providerName] >= threshold) {
        const warning = this.getQuotaWarning(providerName);
        if (warning) console.warn(warning);
      }
    }

    // Update performance metrics (with rolling window)
    const m = this.getOrCreateMetrics(providerName);
    if (result.success) {
      m.successes += 1;
      if (result.latencyMs !== undefined) {
        m.latencySamples += 1;
        m.avgLatency += (result.latencyMs - m.avgLatency) / m.latencySamples;
      }
    } else {
      m.failures += 1;
    }
  }

  recordResultQuality(providerName: string, resultCount: number, requestedCount: number): void {
    if (requestedCount <= 0 || resultCount < 0) return;
    const m = this.getOrCreateMetrics(providerName);
    m.resultSamples += 1;
    const ratio = Math.min(1.0, resultCount / requestedCount);
    m.avgResultRatio += (ratio - m.avgResultRatio) / m.resultSamples;
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
   * Score = (success_rate * 0.5) + (speed_score * 0.3) + (quality_score * 0.2)
   *
   * Where:
   *   success_rate  = successes / (successes + failures)  (within rolling window)
   *   speed_score   = max(0, 1 - avg_latency / max_avg_latency)
   *   quality_score = avg_result_ratio  (results received / results requested)
   *
   * Providers with no active metrics get a neutral score of 0.5.
   */
  selectSearchByPerformance(name?: string): SearchProvider | undefined {
    if (name && name !== "auto") {
      return this.searchProviders.get(name)?.provider;
    }
    return this.scoreEligibleProviders()[0]?.provider;
  }

  selectSearchByPerformanceAll(): SearchProvider[] {
    return this.scoreEligibleProviders().map((s) => s.provider);
  }

  selectSearchForFusion(strategy: SelectionStrategy, name?: string): SearchProvider[] {
    if (name && name !== "auto") {
      const provider = this.searchProviders.get(name)?.provider;
      return provider ? [provider] : [];
    }
    if (strategy === "best-performing") {
      return this.selectSearchByPerformanceAll();
    }
    return this.selectSearchCandidates();
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

  private static readonly QUOTA_WARN_RATIO = 0.8;

  /**
   * Returns a warning string if a provider's usage is approaching its monthly quota.
   * Returns null if no warning is needed (no quota, below threshold, or unknown provider).
   */
  getQuotaWarning(providerName: string): string | null {
    const reg = this.searchProviders.get(providerName);
    if (!reg || reg.monthlyQuota === null) return null;

    const used = this.counts[providerName] ?? 0;
    const threshold = Math.floor(reg.monthlyQuota * ProviderRegistry.QUOTA_WARN_RATIO);

    if (used < threshold) return null;

    const remaining = reg.monthlyQuota - used;
    if (remaining <= 0) {
      return `[pi-tools] ${providerName}: monthly quota exhausted (${used}/${reg.monthlyQuota}).`;
    }
    return `[pi-tools] ${providerName}: monthly usage at ${used}/${reg.monthlyQuota} (${remaining} remaining).`;
  }

  getMetrics(providerName: string): ProviderMetrics | undefined {
    return this.metrics.get(providerName);
  }

  /** @internal Exposed for tests to simulate window expiry without time mocking. */
  expireMetricsWindow(providerName: string): void {
    const m = this.metrics.get(providerName);
    if (m) {
      m.windowStart = 0;
    }
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
