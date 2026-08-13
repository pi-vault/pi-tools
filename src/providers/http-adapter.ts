import type {
  SearchFilterSupport,
  SearchFilters,
  SearchProvider,
  SearchResult,
} from "./types.ts";
import { UNSUPPORTED_SEARCH_FILTERS } from "./types.ts";

export interface HttpSearchConfig {
  name: string;
  label: string;
  endpoint: string | ((query: string, maxResults: number, filters?: SearchFilters) => string);
  method: "GET" | "POST";

  // Auth: provide buildHeaders for full control, or authHeader/authPrefix (defaults to "Authorization")
  authHeader?: string;
  authPrefix?: string;
  buildHeaders?: (apiKey: string) => Record<string, string>;

  buildBody?: (query: string, maxResults: number, filters?: SearchFilters) => unknown;
  extractResults: (data: unknown) => Array<{ title: string; url: string; snippet: string }>;

  filterSupport?: SearchFilterSupport;
}

export function createHttpSearchProvider(apiKey: string, config: HttpSearchConfig): SearchProvider {
  return {
    name: config.name,
    label: config.label,
    filterSupport: config.filterSupport ?? UNSUPPORTED_SEARCH_FILTERS,
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
        : { [config.authHeader ?? "Authorization"]: (config.authPrefix ?? "") + apiKey };

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
        throw new Error(`${config.label} API error: ${response.status} ${response.statusText}`);
      }

      const data: unknown = await response.json();
      return config.extractResults(data).slice(0, maxResults);
    },
  };
}
