import type { ProviderConfigEntry } from "../config.ts";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface CodeSearchResult {
  title: string;
  url: string;
  snippet: string;
  language?: string;
}

export interface FetchResult {
  text: string;
  title?: string;
  contentType?: string;
}

export interface SearchFilters {
  includeDomains?: string[];
  excludeDomains?: string[];
  startDate?: string; // ISO 8601 date
  endDate?: string; // ISO 8601 date
}

export interface SearchProvider {
  readonly name: string;
  readonly label: string;
  search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    filters?: SearchFilters,
  ): Promise<SearchResult[]>;
}

export interface FetchProvider {
  readonly name: string;
  fetch(url: string, signal?: AbortSignal): Promise<FetchResult>;
}

export interface CodeSearchProvider {
  readonly name: string;
  codeSearch(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<CodeSearchResult[]>;
}

export type ProviderTier = 1 | 2 | 3;

export interface ProviderMeta {
  name: string;
  tier: ProviderTier;
  monthlyQuota: number | null;
  requiresKey: boolean;
  create: (key?: string, providerConfig?: ProviderConfigEntry) => {
    search?: SearchProvider;
    fetch?: FetchProvider;
    codeSearch?: CodeSearchProvider;
  };
}
