// src/providers/ollama.ts
import type { ProviderConfigEntry } from "../config.ts";
import type {
  FetchProvider,
  FetchResult,
  ProviderMeta,
  SearchFilters,
  SearchProvider,
  SearchResult,
} from "./types.ts";

const DEFAULT_BASE_URL = "http://localhost:11434";

interface OllamaProviderOptions {
  baseUrl?: string;
  apiKey?: string;
}

export function isLocalHost(baseUrl: string): boolean {
  const hostname = new URL(baseUrl).hostname;
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]"
  );
}

export function isConnectionRefused(error: unknown): boolean {
  if (error instanceof TypeError) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code === "ECONNREFUSED";
  }
  return false;
}

export class OllamaProvider implements SearchProvider, FetchProvider {
  readonly name = "ollama";
  readonly label = "Ollama";

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly isLocal: boolean;

  constructor(options?: OllamaProviderOptions) {
    this.baseUrl = (
      options?.baseUrl ?? process.env.OLLAMA_HOST ?? DEFAULT_BASE_URL
    ).replace(/\/+$/, "");
    this.apiKey = options?.apiKey;
    this.isLocal = isLocalHost(this.baseUrl);
  }

  private get searchPath(): string {
    return this.isLocal ? "/api/experimental/web_search" : "/api/web_search";
  }

  private get fetchPath(): string {
    return this.isLocal ? "/api/experimental/web_fetch" : "/api/web_fetch";
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private hostLabel(): string {
    try {
      return new URL(this.baseUrl).host;
    } catch {
      return this.baseUrl;
    }
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    _filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const url = `${this.baseUrl}${this.searchPath}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({ query, max_results: maxResults }),
        signal,
      });
    } catch (err) {
      if (isConnectionRefused(err)) {
        throw new Error(
          `Could not connect to Ollama at ${this.hostLabel()}. Make sure Ollama is running (ollama serve).`,
        );
      }
      throw err;
    }

    if (!response.ok) {
      throw new Error(
        `Ollama API error: ${response.status} ${response.statusText}`,
      );
    }

    const data: unknown = await response.json();
    return parseOllamaSearchResults(data).slice(0, maxResults);
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const endpoint = `${this.baseUrl}${this.fetchPath}`;

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({ url }),
        signal,
      });
    } catch (err) {
      if (isConnectionRefused(err)) {
        throw new Error(
          `Could not connect to Ollama at ${this.hostLabel()}. Make sure Ollama is running (ollama serve).`,
        );
      }
      throw err;
    }

    if (!response.ok) {
      throw new Error(
        `Ollama API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    return {
      text: (data.content as string) || "",
      title: (data.title as string) || undefined,
      contentType: "text/html",
    };
  }
}

function parseOllamaSearchResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as { results?: unknown[] };
  const results = Array.isArray(d.results) ? d.results : [];
  return results.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: ((item.content as string) || (item.snippet as string) || "").slice(0, 500),
    };
  });
}

export const providerMeta: ProviderMeta = {
  name: "ollama",
  tier: 3,
  monthlyQuota: null,
  requiresKey: false,
  create: (key?: string, providerConfig?: ProviderConfigEntry) => {
    const baseUrl =
      (providerConfig as any)?.baseUrl ??
      process.env.OLLAMA_HOST ??
      DEFAULT_BASE_URL;
    // Only register when explicitly enabled or OLLAMA_HOST env var is set
    if (providerConfig?.enabled !== true && !process.env.OLLAMA_HOST) return {};
    const provider = new OllamaProvider({ baseUrl, apiKey: key });
    return { search: provider, fetch: provider };
  },
};
