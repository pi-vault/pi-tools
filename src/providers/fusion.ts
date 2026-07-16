import type { SearchResult } from "./types.ts";
import { AggregateProviderError } from "../utils/errors.ts";
import { activityMonitor } from "../monitor/activity-monitor.ts";

export interface ProviderResults {
  providerName: string;
  results: SearchResult[];
}

export interface FusedResult {
  result: SearchResult;
  rrfScore: number;
  providers: string[];
}

const DEFAULT_K = 60;

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString().toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function reciprocalRankFusion(
  providerResults: ProviderResults[],
  maxResults: number,
  k: number = DEFAULT_K,
): FusedResult[] {
  const urlMap = new Map<string, { rrfScore: number; result: SearchResult; providers: string[] }>();

  for (const { providerName, results } of providerResults) {
    for (let rank = 0; rank < results.length; rank++) {
      const r = results[rank];
      const key = normalizeUrl(r.url);
      const rrfContribution = 1 / (k + rank + 1);

      const existing = urlMap.get(key);
      if (existing) {
        existing.rrfScore += rrfContribution;
        existing.providers.push(providerName);
        // Keep result with longer snippet
        const existingLen = existing.result.snippet.length;
        const newLen = r.snippet.length;
        if (newLen > existingLen) {
          existing.result = r;
        }
      } else {
        urlMap.set(key, {
          rrfScore: rrfContribution,
          result: r,
          providers: [providerName],
        });
      }
    }
  }

  return Array.from(urlMap.values())
    .sort((a, b) => {
      if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
      return b.providers.length - a.providers.length;
    })
    .slice(0, maxResults);
}

export interface FusionCandidate {
  name: string;
  execute: (numResults: number) => Promise<SearchResult[]>;
}

export interface FusionOptions {
  candidates: FusionCandidate[];
  maxResults: number;
  mode: "targeted" | "all";
  targetBackends: number;
  k: number;
  onSuccess?: (providerName: string, latencyMs: number) => void;
  onFailure?: (providerName: string) => void;
}

export interface FusionResult {
  results: FusedResult[];
  providersUsed: string[];
  providersFailed: string[];
  degraded: boolean;
}

export async function executeWithFusion(options: FusionOptions): Promise<FusionResult> {
  const { candidates, maxResults, mode, targetBackends, k, onSuccess, onFailure } = options;

  if (candidates.length === 0) {
    throw new AggregateProviderError("search", [
      { provider: "none", error: "No search providers available" },
    ]);
  }

  const effectiveTarget = mode === "all" ? candidates.length : targetBackends;
  return executeTargeted(candidates, maxResults, effectiveTarget, k, onSuccess, onFailure);
}

async function executeTargeted(
  candidates: FusionCandidate[],
  maxResults: number,
  targetBackends: number,
  k: number,
  onSuccess?: (name: string, latencyMs: number) => void,
  onFailure?: (name: string) => void,
): Promise<FusionResult> {
  const perProvider = Math.ceil(maxResults / targetBackends);
  const providersUsed: string[] = [];
  const providersFailed: string[] = [];
  const usableResults: ProviderResults[] = [];
  const errors: Array<{ provider: string; error: string }> = [];
  let cursor = 0;

  while (usableResults.length < targetBackends && cursor < candidates.length) {
    const needed = targetBackends - usableResults.length;
    const remaining = candidates.length - cursor;
    const batchSize = Math.min(needed, remaining);
    const batch = candidates.slice(cursor, cursor + batchSize);
    cursor += batchSize;

    const batchSettled = await Promise.all(
      batch.map(async (candidate) => {
        const entryId = activityMonitor.logStart({ type: "api", query: `fusion:${candidate.name}` });
        const startMs = Date.now();
        try {
          const results = await candidate.execute(perProvider);
          const latencyMs = Date.now() - startMs;
          onSuccess?.(candidate.name, latencyMs);
          activityMonitor.logComplete(entryId, 200);
          return { name: candidate.name, results, success: true as const };
        } catch (err) {
          onFailure?.(candidate.name);
          activityMonitor.logError(entryId, err instanceof Error ? err.message : String(err));
          return {
            name: candidate.name,
            error: err instanceof Error ? err.message : String(err),
            success: false as const,
          };
        }
      }),
    );

    for (const entry of batchSettled) {
      if (entry.success) {
        if (entry.results.length > 0) {
          providersUsed.push(entry.name);
          usableResults.push({ providerName: entry.name, results: entry.results });
        }
        // empty results → not usable, not a failure, not counted as "used"
      } else {
        providersFailed.push(entry.name);
        errors.push({ provider: entry.name, error: entry.error });
      }
    }
  }

  if (usableResults.length === 0) {
    if (errors.length === 0) {
      errors.push({ provider: "all", error: "All providers returned empty results" });
    }
    throw new AggregateProviderError("search", errors);
  }

  const fused =
    usableResults.length === 1
      ? usableResults[0].results.slice(0, maxResults).map((r) => ({
          result: r,
          rrfScore: 0,
          providers: [usableResults[0].providerName],
        }))
      : reciprocalRankFusion(usableResults, maxResults, k);

  return {
    results: fused,
    providersUsed,
    providersFailed,
    degraded: usableResults.length < Math.min(targetBackends, candidates.length),
  };
}
