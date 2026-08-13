import { AggregateProviderError, sanitizeError } from "../utils/errors.ts";
import { activityMonitor } from "../monitor/activity-monitor.ts";
import { BudgetExceededError } from "./registry.ts";

export interface FallbackCandidate<T> {
  name: string;
  execute: () => Promise<T>;
}

export interface ExecutionHooks {
  onSuccess?: (providerName: string, latencyMs: number) => void;
  onFailure?: (providerName: string) => void;
}

export interface ExecuteAttemptOptions<T> extends ExecutionHooks {
  candidate: FallbackCandidate<T>;
  operation: string;
  signal?: AbortSignal;
  activityQuery?: string;
}

export async function executeAttempt<T>(options: ExecuteAttemptOptions<T>): Promise<T> {
  const { candidate, operation, signal, onSuccess, onFailure, activityQuery } = options;

  signal?.throwIfAborted();

  const entryId = activityMonitor.logStart({
    type: "api",
    query: activityQuery ?? operation,
  });
  const startMs = Date.now();
  try {
    const result = await candidate.execute();
    signal?.throwIfAborted();
    onSuccess?.(candidate.name, Date.now() - startMs);
    activityMonitor.logComplete(entryId, 200);
    return result;
  } catch (error) {
    activityMonitor.logError(entryId, sanitizeError(error));
    signal?.throwIfAborted();
    if (!(error instanceof BudgetExceededError)) onFailure?.(candidate.name);
    throw error;
  }
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
    try {
      const result = await executeAttempt({
        candidate,
        operation,
        signal,
        onSuccess,
        onFailure,
      });
      return { result, providerName: candidate.name };
    } catch (error) {
      errors.push({
        provider: candidate.name,
        error: error instanceof Error ? error.message : String(error),
      });
      // Preserve existing pre-attempt-and-loop cancellation behavior:
      // surface the cancellation up the stack instead of swallowing it.
      signal?.throwIfAborted();
    }
  }

  throw new AggregateProviderError(operation, errors);
}
