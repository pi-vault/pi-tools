import { getAgentDir } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  BudgetPeriod,
  BudgetUnit,
  ProviderBudget,
  ProviderConfigEntry,
  SelectionStrategy,
} from "../config.ts";
import type {
  CodeSearchProvider,
  DocsProvider,
  FetchProvider,
  ProviderCapability,
  ProviderOperation,
  ProviderTier,
  ResearchProvider,
  SearchProvider,
  UsageCost,
} from "./types.ts";

export interface UsageCounter {
  used: number;
  unit: BudgetUnit;
  period: BudgetPeriod;
  periodKey: string;
}

export interface UsageFileV2 {
  version: 2;
  counters: Record<string, UsageCounter>;
}

interface LegacyUsageRecord {
  count: number;
  month: string;
}

type LegacyUsage = Record<string, LegacyUsageRecord>;

export interface PersistenceAdapter {
  load(): UsageFileV2 | LegacyUsage;
  save(data: UsageFileV2): void;
}

export type BudgetStatus =
  | { mode: "managed" }
  | { mode: "unlimited" }
  | {
      mode: "hard";
      used: number;
      limit: number;
      unit: BudgetUnit;
      period: BudgetPeriod;
      periodKey: string;
      pool?: string;
    };

interface RegisteredPolicy {
  name: string;
  tier: ProviderTier;
  budget: ProviderBudget;
  config: ProviderConfigEntry;
  usageCost?: UsageCost;
}

interface RegisteredProvider<T> {
  provider: T;
  tier: ProviderTier;
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

export interface ExecutionHooks {
  onSuccess?: (providerName: string, latencyMs: number) => void;
  onFailure?: (providerName: string) => void;
}

const METRICS_WINDOW_MS = 60_000;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCounter(value: unknown): value is UsageCounter {
  if (!isRecord(value)) return false;
  return (
    typeof value.used === "number" &&
    Number.isFinite(value.used) &&
    value.used >= 0 &&
    (value.unit === "request" || value.unit === "credit" || value.unit === "usd") &&
    (value.period === "day" || value.period === "month" || value.period === "lifetime") &&
    typeof value.periodKey === "string"
  );
}

function isUsageFileV2(value: unknown): value is UsageFileV2 {
  return (
    isRecord(value) &&
    value.version === 2 &&
    isRecord(value.counters) &&
    Object.values(value.counters).every(isCounter)
  );
}

function isLegacyUsage(value: unknown): value is LegacyUsage {
  return (
    isRecord(value) &&
    !("version" in value) &&
    Object.values(value).every(
      (record) =>
        isRecord(record) &&
        typeof record.count === "number" &&
        Number.isFinite(record.count) &&
        record.count >= 0 &&
        typeof record.month === "string",
    )
  );
}

function periodKey(period: BudgetPeriod, now = new Date()): string {
  if (period === "lifetime") return "lifetime";
  const iso = now.toISOString();
  return period === "day" ? iso.slice(0, 10) : iso.slice(0, 7);
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function counterKey(name: string, budget: Extract<ProviderBudget, { mode: "hard" }>): string {
  return budget.pool ? `pool:${budget.pool}` : name;
}

export class BudgetExceededError extends Error {
  constructor(providerName: string, cost: number, status: Extract<BudgetStatus, { mode: "hard" }>) {
    super(
      `${providerName} budget exceeded: ${status.used}/${status.limit} ${status.unit} used; operation costs ${cost}`,
    );
    this.name = "BudgetExceededError";
  }
}

type AnyRegistered =
  | RegisteredProvider<SearchProvider>
  | RegisteredProvider<FetchProvider>
  | RegisteredProvider<CodeSearchProvider>
  | RegisteredProvider<DocsProvider>
  | RegisteredProvider<ResearchProvider>;

export class ProviderRegistry {
  private searchProviders = new Map<string, RegisteredProvider<SearchProvider>>();
  private fetchProviders = new Map<string, RegisteredProvider<FetchProvider>>();
  private codeSearchProviders = new Map<string, RegisteredProvider<CodeSearchProvider>>();
  private docsProviders = new Map<string, RegisteredProvider<DocsProvider>>();
  private researchProviders = new Map<string, RegisteredProvider<ResearchProvider>>();
  private policies = new Map<string, RegisteredPolicy>();
  private metrics = new Map<string, ProviderMetrics>();
  private counters: Record<string, UsageCounter> = {};
  private bareV2Keys = new Set<string>();
  private legacy: LegacyUsage = {};
  private warned = new Set<string>();

  constructor(private readonly persistence: PersistenceAdapter) {
    const loaded = persistence.load();
    if (isUsageFileV2(loaded)) {
      this.counters = { ...loaded.counters };
      this.bareV2Keys = new Set(Object.keys(loaded.counters).filter((key) => !key.includes(":")));
    } else if (isLegacyUsage(loaded)) this.legacy = loaded;
  }

  registerProvider(
    instances: {
      search?: SearchProvider;
      fetch?: FetchProvider;
      codeSearch?: CodeSearchProvider;
      docs?: DocsProvider;
      research?: ResearchProvider;
    },
    options: {
      name: string;
      tier: ProviderTier;
      budget: ProviderBudget;
      config: ProviderConfigEntry;
      usageCost?: UsageCost;
    },
  ): void {
    const policy: RegisteredPolicy = { ...options };
    this.policies.set(options.name, policy);
    this.migrateLegacy(policy);

    if (instances.search) {
      const provider = instances.search;
      this.searchProviders.set(options.name, {
        tier: options.tier,
        provider: {
          name: provider.name,
          label: provider.label,
          filterSupport: provider.filterSupport,
          search: async (query, maxResults, signal, filters) => {
            this.consume(options.name, { capability: "search", maxResults });
            return provider.search(query, maxResults, signal, filters);
          },
        },
      });
    }
    if (instances.fetch) {
      const provider = instances.fetch;
      this.fetchProviders.set(options.name, {
        tier: options.tier,
        provider: {
          name: provider.name,
          fetch: async (url, signal) => {
            this.consume(options.name, { capability: "fetch" });
            return provider.fetch(url, signal);
          },
        },
      });
    }
    if (instances.codeSearch) {
      const provider = instances.codeSearch;
      this.codeSearchProviders.set(options.name, {
        tier: options.tier,
        provider: {
          name: provider.name,
          codeSearch: async (query, maxResults, signal) => {
            this.consume(options.name, { capability: "code-search", maxResults });
            return provider.codeSearch(query, maxResults, signal);
          },
        },
      });
    }
    if (instances.docs) {
      const provider = instances.docs;
      this.docsProviders.set(options.name, {
        tier: options.tier,
        provider: {
          name: provider.name,
          label: provider.label,
          searchLibrary: async (libraryName, query, signal) => {
            this.consume(options.name, { capability: "docs-search" });
            return provider.searchLibrary(libraryName, query, signal);
          },
          getContext: async (libraryId, query, signal) => {
            this.consume(options.name, { capability: "docs-fetch" });
            return provider.getContext(libraryId, query, signal);
          },
        },
      });
    }
    if (instances.research) {
      const provider = instances.research;
      this.researchProviders.set(options.name, {
        tier: options.tier,
        provider: {
          name: provider.name,
          label: provider.label,
          deepResearch: async (params, signal) => {
            this.consume(options.name, {
              capability: "research",
              type: params.type,
              maxResults: params.numResults ?? 10,
              contentTypes: 2 + (params.summaryQuery ? 1 : 0),
            });
            return provider.deepResearch(params, signal);
          },
        },
      });
    }
  }

  private migrateLegacy(policy: RegisteredPolicy): void {
    const record = this.legacy[policy.name];
    const budget = policy.budget;
    if (
      !record ||
      budget.mode !== "hard" ||
      budget.pool ||
      budget.period !== "month" ||
      budget.unit !== "request" ||
      record.month !== periodKey("month")
    )
      return;

    const key = counterKey(policy.name, budget);
    if (!this.counters[key]) {
      this.counters[key] = {
        used: record.count,
        unit: budget.unit,
        period: budget.period,
        periodKey: record.month,
      };
    }
    delete this.legacy[policy.name];
  }

  private counterFor(
    name: string,
    budget: Extract<ProviderBudget, { mode: "hard" }>,
  ): UsageCounter {
    const key = counterKey(name, budget);
    const currentKey = periodKey(budget.period);
    let existing = this.counters[key];
    if (!existing && budget.pool && this.bareV2Keys.has(budget.pool)) {
      existing = { ...this.counters[budget.pool] };
      this.counters[key] = existing;
      this.bareV2Keys.delete(budget.pool);
    }
    if (
      existing &&
      existing.unit === budget.unit &&
      existing.period === budget.period &&
      existing.periodKey === currentKey
    )
      return existing;

    const fresh = { used: 0, unit: budget.unit, period: budget.period, periodKey: currentKey };
    this.counters[key] = fresh;
    return fresh;
  }

  consume(providerName: string, operation: ProviderOperation): void {
    const policy = this.policies.get(providerName);
    if (!policy) throw new Error(`${providerName} is not registered`);
    if (policy.budget.mode !== "hard") return;

    const cost = policy.usageCost?.(operation, policy.config) ?? 1;
    if (!Number.isFinite(cost) || cost <= 0) {
      throw new Error(`${providerName} usage cost must be finite positive`);
    }

    const counter = this.counterFor(providerName, policy.budget);
    const next = round6(counter.used + cost);
    const status = this.getBudgetStatus(providerName) as Extract<BudgetStatus, { mode: "hard" }>;
    if (next > policy.budget.limit) throw new BudgetExceededError(providerName, cost, status);

    const previous = counter.used;
    counter.used = next;
    try {
      this.persistence.save({ version: 2, counters: this.counters });
    } catch (error) {
      counter.used = previous;
      throw error;
    }
    this.warnIfNeeded(providerName, policy.budget, previous, next);
  }

  private warnIfNeeded(
    providerName: string,
    budget: Extract<ProviderBudget, { mode: "hard" }>,
    previous: number,
    used: number,
  ): void {
    const key = `${budget.pool ?? providerName}:${periodKey(budget.period)}`;
    if (
      previous < budget.limit * 0.8 &&
      used >= budget.limit * 0.8 &&
      !this.warned.has(`${key}:80`)
    ) {
      this.warned.add(`${key}:80`);
      console.warn(
        `[pi-tools] ${budget.pool ?? providerName} budget reached 80% (${used}/${budget.limit} ${budget.unit}).`,
      );
    }
    if (previous < budget.limit && used >= budget.limit && !this.warned.has(`${key}:100`)) {
      this.warned.add(`${key}:100`);
      console.warn(
        `[pi-tools] ${budget.pool ?? providerName} budget exhausted (${used}/${budget.limit} ${budget.unit}).`,
      );
    }
  }

  getBudgetStatus(name: string): BudgetStatus | undefined {
    const budget = this.policies.get(name)?.budget;
    if (!budget || budget.mode !== "hard") return budget;
    const counter = this.counterFor(name, budget);
    return {
      mode: "hard",
      used: counter.used,
      limit: budget.limit,
      unit: budget.unit,
      period: budget.period,
      periodKey: counter.periodKey,
      ...(budget.pool ? { pool: budget.pool } : {}),
    };
  }

  private isEligible(name: string): boolean {
    const status = this.getBudgetStatus(name);
    return status?.mode !== "hard" || status.used < status.limit;
  }

  unregisterAll(name: string): void {
    this.searchProviders.delete(name);
    this.fetchProviders.delete(name);
    this.codeSearchProviders.delete(name);
    this.docsProviders.delete(name);
    this.researchProviders.delete(name);
    this.policies.delete(name);
  }

  recordOutcome(providerName: string, result: { success: boolean; latencyMs?: number }): void {
    const metrics = this.getOrCreateMetrics(providerName);
    if (result.success) {
      metrics.successes += 1;
      if (result.latencyMs !== undefined) {
        metrics.latencySamples += 1;
        metrics.avgLatency += (result.latencyMs - metrics.avgLatency) / metrics.latencySamples;
      }
    } else {
      metrics.failures += 1;
    }
  }

  recordResultQuality(providerName: string, resultCount: number, requestedCount: number): void {
    if (requestedCount <= 0 || resultCount < 0) return;
    const metrics = this.getOrCreateMetrics(providerName);
    metrics.resultSamples += 1;
    const ratio = Math.min(1, resultCount / requestedCount);
    metrics.avgResultRatio += (ratio - metrics.avgResultRatio) / metrics.resultSamples;
  }

  /** Returns fresh closures so each shared attempt sees its own callback wiring. */
  getExecutionHooks(): ExecutionHooks {
    return {
      onSuccess: (providerName, latencyMs) =>
        this.recordOutcome(providerName, { success: true, latencyMs }),
      onFailure: (providerName) => this.recordOutcome(providerName, { success: false }),
    };
  }

  private getOrCreateMetrics(providerName: string): ProviderMetrics {
    const existing = this.getActiveMetrics(providerName);
    if (existing) return existing;
    const fresh: ProviderMetrics = {
      successes: 0,
      failures: 0,
      avgLatency: 0,
      latencySamples: 0,
      avgResultRatio: 0,
      resultSamples: 0,
      windowStart: Date.now(),
    };
    this.metrics.set(providerName, fresh);
    return fresh;
  }

  private getActiveMetrics(providerName: string): ProviderMetrics | undefined {
    const metrics = this.metrics.get(providerName);
    return metrics && Date.now() - metrics.windowStart <= METRICS_WINDOW_MS ? metrics : undefined;
  }

  private capabilityMap<T>(capability: ProviderCapability): Map<string, RegisteredProvider<T>> {
    switch (capability) {
      case "search":
        return this.searchProviders as unknown as Map<string, RegisteredProvider<T>>;
      case "fetch":
        return this.fetchProviders as unknown as Map<string, RegisteredProvider<T>>;
      case "code-search":
        return this.codeSearchProviders as unknown as Map<string, RegisteredProvider<T>>;
      case "docs-search":
      case "docs-fetch":
        return this.docsProviders as unknown as Map<string, RegisteredProvider<T>>;
      case "research":
        return this.researchProviders as unknown as Map<string, RegisteredProvider<T>>;
    }
  }

  private genericByTier<T>(capability: ProviderCapability): RegisteredProvider<T>[] {
    const map = this.capabilityMap<T>(capability);
    const order: AnyRegistered[] = [];
    for (const tier of [1, 2, 3] as const) {
      for (const registration of map.values()) {
        if (registration.tier === tier) order.push(registration as AnyRegistered);
      }
    }
    return order as RegisteredProvider<T>[];
  }

  private genericEligible<T>(capability: ProviderCapability): Array<[string, RegisteredProvider<T>]> {
    const map = this.capabilityMap<T>(capability);
    return [...map.entries()].filter(([name]) => this.isEligible(name)) as Array<
      [string, RegisteredProvider<T>]
    >;
  }

  private scoreRegistered<T>(
    entries: Array<[string, RegisteredProvider<T>]>,
  ): Array<{ name: string; provider: T; score: number }> {
    const measured = entries
      .map(([name, registration]) => {
        const metrics = this.getActiveMetrics(name);
        if (!metrics || metrics.successes + metrics.failures === 0) return undefined;
        return {
          name,
          registration,
          successRate: metrics.successes / (metrics.successes + metrics.failures),
          latency: metrics.latencySamples ? metrics.avgLatency : Infinity,
          quality: metrics.resultSamples ? metrics.avgResultRatio : 0.5,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
    const finite = measured.map((entry) => entry.latency).filter(Number.isFinite);
    const maxLatency = finite.length ? Math.max(...finite) : 1;

    return entries
      .map(([name, registration]) => {
        const entry = measured.find((candidate) => candidate.name === name);
        if (!entry) return { name, provider: registration.provider, score: 0.5 };
        const speed =
          entry.latency === Infinity ? 0 : Math.max(0, 1 - entry.latency / maxLatency);
        return {
          name,
          provider: registration.provider,
          score: entry.successRate * 0.5 + speed * 0.3 + entry.quality * 0.2,
        };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        // Stable: map insertion order tie-break happens via registration index
        return 0;
      });
  }

  // ---- Search (legacy compatibility) ----

  selectSearchCandidates(name?: string): SearchProvider[] {
    if (name && name !== "auto") {
      const registration = this.searchProviders.get(name);
      if (!registration) return [];
      if (!this.isEligible(name)) return [];
      return [registration.provider];
    }
    return this.genericByTier<SearchProvider>("search")
      .filter((registration) => this.isEligible(registration.provider.name))
      .map((registration) => registration.provider);
  }

  selectSearchByPerformance(name?: string): SearchProvider | undefined {
    if (name && name !== "auto") {
      const registration = this.searchProviders.get(name);
      if (!registration || !this.isEligible(name)) return undefined;
      return registration.provider;
    }
    return this.scoreRegistered(this.genericEligible<SearchProvider>("search"))[0]?.provider;
  }

  selectSearchByPerformanceAll(): SearchProvider[] {
    return this.scoreRegistered(this.genericEligible<SearchProvider>("search")).map(
      ({ provider }) => provider,
    );
  }

  selectSearchForFusion(strategy: SelectionStrategy, name?: string): SearchProvider[] {
    if (name && name !== "auto") return this.selectSearchCandidates(name);
    return strategy === "best-performing"
      ? this.selectSearchByPerformanceAll()
      : this.selectSearchCandidates();
  }

  // ---- Fetch ----

  selectFetchCandidates(strategy: SelectionStrategy = "auto"): FetchProvider[] {
    const eligible = this.genericEligible<FetchProvider>("fetch");
    const ordered =
      strategy === "best-performing"
        ? this.scoreRegistered(eligible).map(({ provider }) => provider)
        : this.genericByTier<FetchProvider>("fetch")
            .filter((registration) => this.isEligible(registration.provider.name))
            .map((registration) => registration.provider);
    return ordered;
  }

  // ---- Code search ----

  selectCodeSearch(strategy: SelectionStrategy = "auto"): CodeSearchProvider | undefined {
    const eligible = this.genericEligible<CodeSearchProvider>("code-search");
    if (eligible.length === 0) return undefined;
    if (strategy === "best-performing") {
      return this.scoreRegistered(eligible)[0]?.provider;
    }
    return this.genericByTier<CodeSearchProvider>("code-search").find((registration) =>
      this.isEligible(registration.provider.name),
    )?.provider;
  }

  // ---- Docs ----

  selectDocs(name?: string): DocsProvider | undefined {
    if (name) {
      const registration = this.docsProviders.get(name);
      if (!registration || !this.isEligible(name)) return undefined;
      return registration.provider;
    }
    return this.genericByTier<DocsProvider>("docs-search").find((registration) =>
      this.isEligible(registration.provider.name),
    )?.provider;
  }

  selectDocsByStrategy(
    strategy: SelectionStrategy = "auto",
    name?: string,
  ): DocsProvider | undefined {
    if (name) {
      const registration = this.docsProviders.get(name);
      if (!registration || !this.isEligible(name)) return undefined;
      return registration.provider;
    }
    const eligible = this.genericEligible<DocsProvider>("docs-search");
    if (eligible.length === 0) return undefined;
    if (strategy === "best-performing") {
      return this.scoreRegistered(eligible)[0]?.provider;
    }
    return this.genericByTier<DocsProvider>("docs-search").find((registration) =>
      this.isEligible(registration.provider.name),
    )?.provider;
  }

  // ---- Research ----

  selectResearchCandidates(
    strategy: SelectionStrategy = "auto",
    name?: string,
  ): ResearchProvider[] {
    if (name) {
      const registration = this.researchProviders.get(name);
      if (!registration || !this.isEligible(name)) return [];
      return [registration.provider];
    }
    const eligible = this.genericEligible<ResearchProvider>("research");
    if (strategy === "best-performing") {
      return this.scoreRegistered(eligible).map(({ provider }) => provider);
    }
    return this.genericByTier<ResearchProvider>("research")
      .filter((registration) => this.isEligible(registration.provider.name))
      .map((registration) => registration.provider);
  }

  getSearchProviderNames(): string[] {
    return [...this.searchProviders.keys()];
  }

  getProviderNames(): string[] {
    return [...this.policies.keys()];
  }

  getMetrics(providerName: string): ProviderMetrics | undefined {
    return this.metrics.get(providerName);
  }

  expireMetricsWindow(providerName: string): void {
    const metrics = this.metrics.get(providerName);
    if (metrics) metrics.windowStart = 0;
  }
}

export function createFilePersistence(filePath?: string): PersistenceAdapter {
  const usagePath = filePath ?? path.join(getAgentDir(), "cache", "pi-tools", "usage.json");
  return {
    load(): UsageFileV2 | LegacyUsage {
      let raw: string;
      try {
        raw = fs.readFileSync(usagePath, "utf-8");
      } catch (error) {
        const missing =
          (error as NodeJS.ErrnoException).code === "ENOENT" ||
          (error instanceof Error && error.message.includes("ENOENT"));
        if (!missing) throw error;
        return { version: 2, counters: {} };
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isUsageFileV2(parsed) || isLegacyUsage(parsed)) return parsed;
      } catch {}
      return { version: 2, counters: {} };
    },
    save(data: UsageFileV2): void {
      fs.mkdirSync(path.dirname(usagePath), { recursive: true });
      fs.writeFileSync(usagePath, JSON.stringify(data, null, 2));
    },
  };
}
