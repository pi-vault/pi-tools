import { createHttpSearchProvider } from "./http-adapter.ts";
import { applyDomainFilters } from "../utils/filters.ts";
import {
  parseBraveLlmResults,
  parseBraveResults,
  parseFastcrwResults,
  parseLangSearchResults,
  parseLinkupResults,
  parseMarginaliaResults,
  parsePerplexityResults,
  parseWebSearchApiResults,
  parseYouComResults,
} from "./parsers.ts";
import type { ProviderMeta, SearchFilters } from "./types.ts";

function buildFreshness(filters?: SearchFilters): string | null {
  if (!filters) return null;
  if (!filters.startDate && !filters.endDate) return null;
  return `${filters.startDate ?? ""}to${filters.endDate ?? ""}`;
}

export const httpProviders: ProviderMeta[] = [
  {
    name: "brave",
    tier: 1,
    monthlyQuota: 2000,
    requiresKey: true,
    create: (key) => ({
      search: createHttpSearchProvider(key!, {
        name: "brave",
        label: "Brave Search",
        endpoint: (query, maxResults, filters) => {
          const params = new URLSearchParams({
            q: applyDomainFilters(query, filters),
            count: String(maxResults),
          });
          const freshness = buildFreshness(filters);
          if (freshness) params.set("freshness", freshness);
          return `https://api.search.brave.com/res/v1/web/search?${params.toString()}`;
        },
        method: "GET",
        buildHeaders: (apiKey) => ({
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
        }),
        extractResults: parseBraveResults,
      }),
    }),
  },
  {
    name: "brave-llm",
    tier: 1,
    monthlyQuota: 2000,
    requiresKey: true,
    create: (key, providerConfig) => ({
      search: createHttpSearchProvider(key!, {
        name: "brave-llm",
        label: "Brave LLM Context",
        endpoint: "https://api.search.brave.com/res/v1/llm/context",
        method: "POST",
        buildHeaders: (apiKey) => ({
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
        }),
        buildBody: (query) => {
          const body: Record<string, unknown> = { q: query };
          if (providerConfig?.tokenBudget !== undefined)
            body.maximum_number_of_tokens = providerConfig.tokenBudget;
          return body;
        },
        extractResults: parseBraveLlmResults,
      }),
    }),
  },
  {
    name: "fastcrw",
    tier: 2,
    monthlyQuota: 500,
    requiresKey: true,
    create: (key, providerConfig) => ({
      search: createHttpSearchProvider(key!, {
        name: "fastcrw",
        label: "fastCRW",
        endpoint: `${providerConfig?.baseUrl ?? "https://api.fastcrw.com"}/v1/search`,
        method: "POST",
        authPrefix: "Bearer ",
        buildBody: (query, maxResults) => ({
          query,
          limit: Math.min(maxResults, 20),
        }),
        extractResults: parseFastcrwResults,
      }),
    }),
  },
  {
    name: "langsearch",
    tier: 2,
    monthlyQuota: null,
    requiresKey: true,
    create: (key) => ({
      search: createHttpSearchProvider(key!, {
        name: "langsearch",
        label: "LangSearch",
        endpoint: "https://api.langsearch.com/v1/web-search",
        method: "POST",
        authPrefix: "Bearer ",
        buildBody: (query, maxResults) => ({
          query,
          max_results: Math.min(maxResults, 20),
        }),
        extractResults: parseLangSearchResults,
      }),
    }),
  },
  {
    name: "linkup",
    tier: 2,
    monthlyQuota: null,
    requiresKey: true,
    create: (key, providerConfig) => ({
      search: createHttpSearchProvider(key!, {
        name: "linkup",
        label: "Linkup",
        endpoint: "https://api.linkup.so/v1/search",
        method: "POST",
        authPrefix: "Bearer ",
        buildBody: (query) => ({
          query,
          outputType: "searchResults",
          depth: providerConfig?.depth ?? "standard",
        }),
        extractResults: parseLinkupResults,
      }),
    }),
  },
  {
    name: "marginalia",
    tier: 3,
    monthlyQuota: null,
    requiresKey: false,
    create: (key) => ({
      search: createHttpSearchProvider(key ?? "public", {
        name: "marginalia",
        label: "Marginalia Search",
        endpoint: (query, maxResults) => {
          const params = new URLSearchParams({
            query,
            count: String(Math.min(maxResults, 100)),
          });
          return `https://api2.marginalia-search.com/search?${params}`;
        },
        method: "GET",
        buildHeaders: (apiKey) => ({
          Accept: "application/json",
          "API-Key": apiKey,
        }),
        extractResults: parseMarginaliaResults,
      }),
    }),
  },
  {
    name: "perplexity",
    tier: 2,
    monthlyQuota: null,
    requiresKey: true,
    create: (key, providerConfig) => ({
      search: createHttpSearchProvider(key!, {
        name: "perplexity",
        label: "Perplexity Sonar",
        endpoint: "https://api.perplexity.ai/chat/completions",
        method: "POST",
        authPrefix: "Bearer ",
        buildBody: (query) => ({
          model: providerConfig?.model ?? "sonar",
          messages: [{ role: "user", content: query }],
        }),
        extractResults: parsePerplexityResults,
      }),
    }),
  },
  {
    name: "websearchapi",
    tier: 1,
    monthlyQuota: null,
    requiresKey: true,
    create: (key) => ({
      search: createHttpSearchProvider(key!, {
        name: "websearchapi",
        label: "WebSearchAPI",
        endpoint: "https://api.websearchapi.ai/ai-search",
        method: "POST",
        authPrefix: "Bearer ",
        buildBody: (query, maxResults) => ({ query, maxResults }),
        extractResults: parseWebSearchApiResults,
      }),
    }),
  },
  {
    name: "youcom",
    tier: 2,
    monthlyQuota: null,
    requiresKey: true,
    create: (key) => ({
      search: createHttpSearchProvider(key!, {
        name: "youcom",
        label: "You.com",
        endpoint: (query, maxResults) => {
          const params = new URLSearchParams({
            query,
            num_web_results: String(Math.min(maxResults, 100)),
          });
          return `https://api.you.com/v1/search?${params}`;
        },
        method: "GET",
        buildHeaders: (apiKey) => ({ "X-API-Key": apiKey }),
        extractResults: parseYouComResults,
      }),
    }),
  },
];
