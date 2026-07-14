import { resolveProviderKey } from "../config.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether a Perplexity API key is available.
 * Uses resolveProviderKey which checks config + FALLBACK_ENV_MAP ("perplexity" → "PERPLEXITY_API_KEY").
 */
export function isPerplexityAvailable(): boolean {
  return !!getPerplexityKey();
}

/**
 * Query Perplexity chat/completions with a single user message.
 * Returns the assistant's response text.
 *
 * Used as the last-resort YouTube transcript fallback — provides a text summary
 * without visual understanding. Distinct from the search provider in
 * src/providers/perplexity.ts which returns structured SearchResult[].
 */
export async function queryPerplexity(
  query: string,
  signal?: AbortSignal,
): Promise<string> {
  const key = getPerplexityKey();
  if (!key) {
    throw new Error(
      "Perplexity API key not found. Set PERPLEXITY_API_KEY environment variable " +
        "or configure perplexity provider key in tools.json",
    );
  }

  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  const response = await fetch(PERPLEXITY_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [{ role: "user", content: query }],
      max_tokens: 4096,
    }),
    signal: combinedSignal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Perplexity API error ${response.status}: ${errorText || response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Perplexity API returned empty response");
  }

  return content;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPerplexityKey(): string | undefined {
  return resolveProviderKey("perplexity");
}
