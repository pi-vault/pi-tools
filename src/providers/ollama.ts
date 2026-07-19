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

  constructor(options?: { baseUrl?: string; apiKey?: string }) {
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

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (isConnectionRefused(err)) {
        const host = (() => { try { return new URL(this.baseUrl).host; } catch { return this.baseUrl; } })();
        throw new Error(
          `Could not connect to Ollama at ${host}. Make sure Ollama is running (ollama serve).`,
        );
      }
      throw err;
    }
    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    _filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const data = await this.post(this.searchPath, { query, max_results: maxResults }, signal);
    return parseOllamaSearchResults(data).slice(0, maxResults);
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const data = (await this.post(this.fetchPath, { url }, signal)) as Record<string, unknown>;
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
  requiresKey: false,
  create: (key?: string, providerConfig?: ProviderConfigEntry) => {
    const baseUrl =
      (providerConfig as any)?.baseUrl ??
      process.env.OLLAMA_HOST ??
      DEFAULT_BASE_URL;
    if (providerConfig?.enabled !== true && !process.env.OLLAMA_HOST) return {};
    const provider = new OllamaProvider({ baseUrl, apiKey: key });
    return { search: provider, fetch: provider };
  },
};
