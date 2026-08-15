import { executeWithFallback, type ExecutionHooks } from "../providers/execute.ts";
import type { FetchProvider } from "../providers/types.ts";
import type { ExtractedContent } from "./types.ts";

export interface ExtractionFallback {
  name: string;
  run(): Promise<ExtractedContent | null>;
}

interface CreateFetchProviderFallbackOptions {
  url: string;
  providers: readonly FetchProvider[];
  signal?: AbortSignal;
  hooks?: ExecutionHooks;
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  return name === "AbortError";
}

class InsufficientFetchContentError extends Error {
  constructor(public readonly providerName: string) {
    super(`${providerName} returned empty content`);
    this.name = "InsufficientFetchContentError";
  }
}

export function createFetchProviderFallback(
  options: CreateFetchProviderFallbackOptions,
): ExtractionFallback {
  const { url, providers, signal, hooks } = options;
  const name = "fetch-provider";

  return {
    name,
    async run(): Promise<ExtractedContent> {
      if (providers.length === 0) {
        throw new Error("No fetch providers configured");
      }

      try {
        const { result, providerName } = await executeWithFallback({
          candidates: providers.map((provider) => ({
            name: provider.name,
            execute: async () => {
              const fetched = await provider.fetch(url, signal);
              const text = fetched.text?.trim() ?? "";
              if (!text) throw new InsufficientFetchContentError(provider.name);
              return { ...fetched, text };
            },
          })),
          operation: "fetch",
          signal,
          onSuccess: hooks?.onSuccess,
          onFailure: hooks?.onFailure,
        });

        return {
          text: result.text,
          title: result.title,
          url,
          extractionChain: [`fetch-provider:${providerName}`],
          chars: result.text.length,
          truncated: false,
        };
      } catch (error) {
        if (isAbortError(error)) throw error;
        // Rethrow ordinary errors so runExtractionFallbacks records :error.
        // Surface a sanitized summary, never raw provider messages with credentials.
        const summary = error instanceof Error ? error.message : String(error);
        throw new FetchProvidersFailedError(summary);
      }
    },
  };
}

class FetchProvidersFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchProvidersFailedError";
  }
}

export async function runExtractionFallbacks(
  fallbacks: readonly ExtractionFallback[],
  chain: string[],
  signal?: AbortSignal,
): Promise<ExtractedContent | null> {
  for (const fallback of fallbacks) {
    signal?.throwIfAborted();

    let result: ExtractedContent | null;
    try {
      result = await fallback.run();
    } catch (error) {
      if (isAbortError(error)) throw error;
      chain.push(`${fallback.name}:error`);
      continue;
    }

    if (result == null) {
      chain.push(`${fallback.name}:fail`);
      continue;
    }

    chain.push(result.extractionChain[0]);
    return result;
  }

  return null;
}
