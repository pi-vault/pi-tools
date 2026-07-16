import { AggregateProviderError } from "../utils/errors.ts";
import { activityMonitor } from "../monitor/activity-monitor.ts";

interface FallbackCandidate<T> {
  name: string;
  execute: () => Promise<T>;
}

export interface ExecuteOptions<T> {
  candidates: FallbackCandidate<T>[];
  operation: string;
  onSuccess?: (providerName: string, latencyMs: number) => void;
  onFailure?: (providerName: string) => void;
}

export async function executeWithFallback<T>(
  options: ExecuteOptions<T>,
): Promise<{ result: T; providerName: string }> {
  const { candidates, operation, onSuccess, onFailure } = options;

  if (candidates.length === 0) {
    throw new AggregateProviderError(operation, [
      { provider: "none", error: `No ${operation} providers available` },
    ]);
  }

  const errors: Array<{ provider: string; error: string }> = [];

  for (const candidate of candidates) {
    const entryId = activityMonitor.logStart({ type: "api", query: operation });
    const startMs = Date.now();
    try {
      const result = await candidate.execute();
      onSuccess?.(candidate.name, Date.now() - startMs);
      activityMonitor.logComplete(entryId, 200);
      return { result, providerName: candidate.name };
    } catch (error) {
      onFailure?.(candidate.name);
      activityMonitor.logError(entryId, error instanceof Error ? error.message : String(error));
      errors.push({
        provider: candidate.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw new AggregateProviderError(operation, errors);
}
