import type { ProviderConfigEntry } from "../config.ts";
import type { DocsProvider, DocsSearchResult, ProviderMeta } from "./types.ts";

const BASE_URL = "https://context7.com/api";
const MAX_REDIRECTS = 3;

export class Context7Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Context7Error";
  }
}

interface ApiSearchResult {
  id: string;
  title: string;
  description: string;
  totalSnippets: number;
  trustScore: number;
  benchmarkScore: number;
  versions?: string[];
}

interface ApiSearchResponse {
  results: ApiSearchResult[];
  searchFilterApplied: boolean;
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as { message?: string };
    if (json.message) return json.message;
  } catch {
    // Fall through to status-based message
  }

  switch (response.status) {
    case 401:
      return "Invalid API key. API keys should start with 'ctx7sk' prefix.";
    case 402:
      return "Monthly spending limit exceeded. Raise the limit at context7.com/dashboard/billing.";
    case 404:
      return "Library not found. Check the library ID or search again.";
    case 429:
      return "Rate limited. Try again later.";
    default:
      return `Context7 API error (${response.status}).`;
  }
}

export class Context7DocsProvider implements DocsProvider {
  readonly name = "context7";
  readonly label = "Context7";
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async searchLibrary(
    libraryName: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<DocsSearchResult[]> {
    const url = new URL(`${BASE_URL}/v2/libs/search`);
    url.searchParams.set("libraryName", libraryName);
    url.searchParams.set("query", query);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal,
    });

    if (!response.ok) {
      throw new Context7Error(await parseErrorMessage(response));
    }

    const data = (await response.json()) as ApiSearchResponse;
    return (data.results ?? []).map((r) => ({
      id: r.id,
      name: r.title,
      description: r.description,
      totalSnippets: r.totalSnippets,
      trustScore: r.trustScore,
      benchmarkScore: r.benchmarkScore,
      versions: r.versions,
    }));
  }

  async getContext(
    libraryId: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.fetchContext(libraryId, query, signal, 0);
  }

  private async fetchContext(
    libraryId: string,
    query: string,
    signal: AbortSignal | undefined,
    depth: number,
  ): Promise<string> {
    const url = new URL(`${BASE_URL}/v2/context`);
    url.searchParams.set("libraryId", libraryId);
    url.searchParams.set("query", query);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal,
    });

    // 202: library not yet finalized — return friendly message
    if (response.status === 202) {
      return "Library is being processed. Try again in a few minutes.";
    }

    // 301: library redirected — application-level redirect (JSON body, no Location header)
    if (response.status === 301) {
      if (depth >= MAX_REDIRECTS) {
        throw new Context7Error("Too many redirects.");
      }
      try {
        const body = (await response.json()) as { redirectUrl?: string };
        if (body.redirectUrl) {
          return this.fetchContext(body.redirectUrl, query, signal, depth + 1);
        }
      } catch {
        // Fall through to error
      }
      throw new Context7Error(
        "Library has moved but no redirect URL provided.",
      );
    }

    if (!response.ok) {
      throw new Context7Error(await parseErrorMessage(response));
    }

    return response.text();
  }
}

export const providerMeta: ProviderMeta = {
  name: "context7",
  tier: 1,
  monthlyQuota: null,
  requiresKey: true,
  create: (key?: string, _providerConfig?: ProviderConfigEntry) => ({
    docs: key ? new Context7DocsProvider(key) : undefined,
  }),
};
