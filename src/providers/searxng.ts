// src/providers/searxng.ts
import { resolveApiKey } from "../config.ts";
import { validateUrl } from "../utils/ssrf.ts";
import type { ProviderMeta, SearchFilters, SearchProvider, SearchResult } from "./types.ts";

const DEFAULT_INSTANCE_URL = "http://localhost:8080";

interface SearXNGOptions {
  instanceUrl?: string;
  apiKey?: string;
}

interface SearXNGSearchResponse {
  results: Array<{
    title: string;
    url: string;
    content: string;
  }>;
}

export class SearXNGProvider implements SearchProvider {
  readonly name = "searxng";
  readonly label = "SearXNG";
  readonly instanceUrl: string;
  private apiKey?: string;

  constructor(options?: SearXNGOptions) {
    this.instanceUrl =
      options?.instanceUrl ??
      process.env.SEARXNG_URL ??
      DEFAULT_INSTANCE_URL;
    this.apiKey = options?.apiKey;
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    _filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const url = `${this.instanceUrl}/search?q=${encodeURIComponent(query)}&format=json`;

    // Allow localhost/private IPs for self-hosted instances
    validateUrl(url, { allowedBaseUrls: [this.instanceUrl] });

    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, { headers, signal });

    if (!response.ok) {
      throw new Error(
        `SearXNG error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as SearXNGSearchResponse;
    return (data.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    }));
  }
}

export const providerMeta: ProviderMeta = {
  name: "searxng",
  tier: 2,
  monthlyQuota: null,
  requiresKey: false,
  create: (_key, providerConfig) => ({
    search: new SearXNGProvider({
      instanceUrl: providerConfig?.instanceUrl,
      apiKey: providerConfig?.apiKey ? resolveApiKey(providerConfig.apiKey) : undefined,
    }),
  }),
};
