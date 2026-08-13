import type { ProviderConfigEntry } from "../config.ts";
import { providerMeta as context7 } from "./context7.ts";
import { providerMeta as duckduckgo } from "./duckduckgo.ts";
import { providerMeta as exa } from "./exa.ts";
import { providerMeta as firecrawl } from "./firecrawl.ts";
import { httpProviders } from "./http-providers.ts";
import { providerMeta as jina } from "./jina.ts";
import { providerMeta as ollama } from "./ollama.ts";
import { providerMeta as openaiCodex } from "./openai-codex.ts";
import { providerMeta as openaiWebSearch } from "./openai-web-search.ts";
import { providerMeta as parallel } from "./parallel.ts";
import { providerMeta as searxng } from "./searxng.ts";
import { providerMeta as serper } from "./serper.ts";
import { providerMeta as sofya } from "./sofya.ts";
import { providerMeta as tavily } from "./tavily.ts";
import { providerMeta as tinyfish } from "./tinyfish.ts";
import type { ProviderMeta } from "./types.ts";

export interface ProviderCatalogEntry {
  readonly meta: ProviderMeta;
  readonly defaultConfig: ProviderConfigEntry;
  readonly fallbackEnv?: string;
}

interface ServiceEnvironmentEntry {
  readonly name: string;
  readonly fallbackEnv: string;
}

const providerMetas: readonly ProviderMeta[] = [
  ...httpProviders,
  context7,
  duckduckgo,
  exa,
  firecrawl,
  jina,
  ollama,
  openaiCodex,
  openaiWebSearch,
  parallel,
  searxng,
  serper,
  sofya,
  tavily,
  tinyfish,
];

const providerMetaByName = new Map(
  providerMetas.map((meta) => [meta.name, meta] as const),
);

function catalogEntry(
  name: string,
  defaultConfig: ProviderConfigEntry,
  fallbackEnv?: string,
): ProviderCatalogEntry {
  const meta = providerMetaByName.get(name);
  if (!meta) throw new Error(`Missing provider metadata for ${name}`);
  return Object.freeze({ meta, defaultConfig, fallbackEnv });
}

const providerCatalog: readonly ProviderCatalogEntry[] = [
  catalogEntry(
    "brave",
    {
      enabled: true,
      budget: {
        mode: "hard",
        limit: 5,
        period: "month",
        unit: "usd",
        pool: "brave",
      },
      apiKey: "BRAVE_API_KEY",
    },
    "BRAVE_API_KEY",
  ),
  catalogEntry(
    "brave-llm",
    {
      enabled: true,
      budget: {
        mode: "hard",
        limit: 5,
        period: "month",
        unit: "usd",
        pool: "brave",
      },
      apiKey: "BRAVE_API_KEY",
    },
    "BRAVE_API_KEY",
  ),
  catalogEntry(
    "context7",
    {
      enabled: true,
      budget: { mode: "hard", limit: 1000, period: "month", unit: "request" },
      apiKey: "CONTEXT7_API_KEY",
    },
    "CONTEXT7_API_KEY",
  ),
  catalogEntry("duckduckgo", { enabled: true, budget: { mode: "unlimited" } }),
  catalogEntry(
    "exa",
    {
      enabled: true,
      budget: {
        mode: "hard",
        limit: 10,
        period: "month",
        unit: "usd",
        pool: "exa",
      },
      apiKey: "EXA_API_KEY",
    },
    "EXA_API_KEY",
  ),
  catalogEntry(
    "fastcrw",
    {
      enabled: false,
      budget: { mode: "hard", limit: 500, period: "lifetime", unit: "credit" },
      apiKey: "FASTCRW_API_KEY",
    },
    "FASTCRW_API_KEY",
  ),
  catalogEntry(
    "firecrawl",
    {
      enabled: true,
      budget: { mode: "hard", limit: 1000, period: "month", unit: "credit" },
      apiKey: "FIRECRAWL_API_KEY",
    },
    "FIRECRAWL_API_KEY",
  ),
  catalogEntry(
    "jina",
    { enabled: true, budget: { mode: "managed" } },
    "JINA_API_KEY",
  ),
  catalogEntry(
    "langsearch",
    {
      enabled: false,
      budget: { mode: "hard", limit: 1000, period: "day", unit: "request" },
      apiKey: "LANGSEARCH_API_KEY",
    },
    "LANGSEARCH_API_KEY",
  ),
  catalogEntry(
    "linkup",
    {
      enabled: false,
      budget: { mode: "hard", limit: 20, period: "month", unit: "usd" },
      apiKey: "LINKUP_API_KEY",
    },
    "LINKUP_API_KEY",
  ),
  catalogEntry(
    "marginalia",
    { enabled: false, budget: { mode: "managed" } },
    "MARGINALIA_API_KEY",
  ),
  catalogEntry(
    "ollama",
    {
      enabled: false,
      budget: { mode: "unlimited" },
      apiKey: "OLLAMA_API_KEY",
    },
    "OLLAMA_API_KEY",
  ),
  catalogEntry("openai-codex", { enabled: true, budget: { mode: "managed" } }),
  catalogEntry(
    "openai-web-search",
    {
      enabled: true,
      budget: { mode: "managed" },
      apiKey: "OPENAI_API_KEY",
    },
    "OPENAI_API_KEY",
  ),
  catalogEntry(
    "parallel",
    {
      enabled: false,
      budget: { mode: "managed" },
      apiKey: "PARALLEL_API_KEY",
    },
    "PARALLEL_API_KEY",
  ),
  catalogEntry(
    "perplexity",
    {
      enabled: true,
      budget: { mode: "managed" },
      apiKey: "PERPLEXITY_API_KEY",
    },
    "PERPLEXITY_API_KEY",
  ),
  catalogEntry("searxng", {
    enabled: false,
    budget: { mode: "unlimited" },
    instanceUrl: "http://localhost:8080",
  }),
  catalogEntry(
    "serper",
    {
      enabled: false,
      budget: {
        mode: "hard",
        limit: 2500,
        period: "lifetime",
        unit: "request",
      },
      apiKey: "SERPER_API_KEY",
    },
    "SERPER_API_KEY",
  ),
  catalogEntry(
    "sofya",
    {
      enabled: false,
      budget: { mode: "managed" },
      apiKey: "SOFYA_API_KEY",
    },
    "SOFYA_API_KEY",
  ),
  catalogEntry(
    "tavily",
    {
      enabled: false,
      budget: { mode: "hard", limit: 1000, period: "month", unit: "credit" },
      apiKey: "TAVILY_API_KEY",
    },
    "TAVILY_API_KEY",
  ),
  catalogEntry(
    "tinyfish",
    {
      enabled: true,
      budget: { mode: "unlimited" },
      apiKey: "TINYFISH_API_KEY",
    },
    "TINYFISH_API_KEY",
  ),
  catalogEntry(
    "websearchapi",
    {
      enabled: false,
      budget: { mode: "hard", limit: 2000, period: "month", unit: "credit" },
      apiKey: "WEBSEARCHAPI_API_KEY",
    },
    "WEBSEARCHAPI_API_KEY",
  ),
  catalogEntry(
    "youcom",
    {
      enabled: false,
      budget: { mode: "hard", limit: 100, period: "lifetime", unit: "usd" },
      apiKey: "YOUCOM_API_KEY",
    },
    "YOUCOM_API_KEY",
  ),
];

const serviceEnvironmentEntries: readonly ServiceEnvironmentEntry[] = [
  { name: "gemini", fallbackEnv: "GEMINI_API_KEY" },
];

const catalogNames = new Set(providerCatalog.map(({ meta }) => meta.name));
if (catalogNames.size !== providerCatalog.length)
  throw new Error("Duplicate provider catalog name");
if (catalogNames.size !== providerMetas.length)
  throw new Error("Provider metadata and catalog entry counts differ");
for (const meta of providerMetas) {
  if (!catalogNames.has(meta.name))
    throw new Error(`Provider ${meta.name} is missing from catalog`);
}

const catalogMetaByName = new Map(
  providerCatalog.map(({ meta }) => [meta.name, meta] as const),
);

export { providerCatalog };

export const allProviders: ProviderMeta[] = providerMetas.map(({ name }) => {
  const meta = catalogMetaByName.get(name);
  if (!meta) throw new Error(`Provider ${name} is missing from catalog`);
  return meta;
});

export const defaultProviderConfigs: Record<string, ProviderConfigEntry> = Object.fromEntries(
  providerCatalog.map(({ meta, defaultConfig }) => [meta.name, defaultConfig]),
);

export const fallbackEnvMap: Record<string, string> = Object.fromEntries([
  ...providerCatalog.flatMap(({ meta, fallbackEnv }) =>
    fallbackEnv ? [[meta.name, fallbackEnv] as const] : [],
  ),
  ...serviceEnvironmentEntries.map(
    ({ name, fallbackEnv }) => [name, fallbackEnv] as const,
  ),
]);