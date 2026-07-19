import { AggregateProviderError } from "../utils/errors.ts";
import { activityMonitor } from "../monitor/activity-monitor.ts";
import { BudgetExceededError } from "./registry.ts";

interface FallbackCandidate<T> {
  name: string;
  execute: () => Promise<T>;
}

export interface ExecuteOptions<T> {
  candidates: FallbackCandidate<T>[];
  operation: string;
  signal?: AbortSignal;
  onSuccess?: (providerName: string, latencyMs: number) => void;
  onFailure?: (providerName: string) => void;
}

export async function executeWithFallback<T>(
  options: ExecuteOptions<T>,
): Promise<{ result: T; providerName: string }> {
  const { candidates, operation, signal, onSuccess, onFailure } = options;

  signal?.throwIfAborted();

  if (candidates.length === 0) {
    throw new AggregateProviderError(operation, [
      { provider: "none", error: `No ${operation} providers available` },
    ]);
  }

  const errors: Array<{ provider: string; error: string }> = [];

  for (const candidate of candidates) {
    signal?.throwIfAborted();
    const entryId = activityMonitor.logStart({ type: "api", query: operation });
    const startMs = Date.now();
    try {
      const result = await candidate.execute();
      signal?.throwIfAborted();
      onSuccess?.(candidate.name, Date.now() - startMs);
      activityMonitor.logComplete(entryId, 200);
      return { result, providerName: candidate.name };
    } catch (error) {
      activityMonitor.logError(entryId, error instanceof Error ? error.message : String(error));
      signal?.throwIfAborted();
      if (!(error instanceof BudgetExceededError)) onFailure?.(candidate.name);
      errors.push({
        provider: candidate.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw new AggregateProviderError(operation, errors);
}
