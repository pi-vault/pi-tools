import type { SearchFilters, SearchProvider, SearchResult } from "./types.ts";

export interface HttpSearchConfig {
  name: string;
  label: string;
  endpoint: string | ((query: string, maxResults: number, filters?: SearchFilters) => string);
  method: "GET" | "POST";

  // Auth: use EITHER authHeader/authPrefix OR buildHeaders (not both)
  authHeader?: string;
  authPrefix?: string;
  buildHeaders?: (apiKey: string) => Record<string, string>;

  buildBody?: (query: string, maxResults: number, filters?: SearchFilters) => unknown;
  extractResults: (data: unknown) => Array<{ title: string; url: string; snippet: string }>;
}

export function createHttpSearchProvider(
  apiKey: string,
  config: HttpSearchConfig,
): SearchProvider {
  return {
    name: config.name,
    label: config.label,
    async search(
      query: string,
      maxResults: number,
      signal?: AbortSignal,
      filters?: SearchFilters,
    ): Promise<SearchResult[]> {
      const url =
        typeof config.endpoint === "function"
          ? config.endpoint(query, maxResults, filters)
          : config.endpoint;

      const headers: Record<string, string> = config.buildHeaders
        ? config.buildHeaders(apiKey)
        : { [config.authHeader!]: (config.authPrefix ?? "") + apiKey };

      const init: RequestInit = { signal, headers };

      if (config.method === "POST") {
        headers["Content-Type"] = "application/json";
        init.method = "POST";
        init.body = config.buildBody
          ? JSON.stringify(config.buildBody(query, maxResults, filters))
          : undefined;
      }

      const response = await fetch(url, init);

      if (!response.ok) {
        throw new Error(`${config.name} API error: ${response.status} ${response.statusText}`);
      }

      const data: unknown = await response.json();
      return config.extractResults(data).slice(0, maxResults);
    },
  };
}
