// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadMergedConfig, resolveApiKey, type ProviderConfigEntry } from "./config.ts";
import { ContentStore, type StoredContent } from "./storage.ts";
import { UsageTracker } from "./providers/usage.ts";
import { ProviderRegistry } from "./providers/registry.ts";
import { DuckDuckGoProvider } from "./providers/duckduckgo.ts";
import { JinaProvider } from "./providers/jina.ts";
import { BraveProvider } from "./providers/brave.ts";
import { SerperProvider } from "./providers/serper.ts";
import { TavilyProvider } from "./providers/tavily.ts";
import { ExaProvider } from "./providers/exa.ts";
import { PerplexityProvider } from "./providers/perplexity.ts";
import { FirecrawlProvider } from "./providers/firecrawl.ts";
import { ExaMcpProvider } from "./providers/exa-mcp.ts";
import { OpenAINativeProvider } from "./providers/openai-native.ts";
import { ParallelProvider } from "./providers/parallel.ts";
import { SearXNGProvider } from "./providers/searxng.ts";
import { WebSearchApiProvider } from "./providers/websearchapi.ts";
import type { FetchProvider, SearchProvider, CodeSearchProvider, ProviderTier } from "./providers/types.ts";
import { createWebSearchTool } from "./tools/web-search.ts";
import { createWebFetchTool } from "./tools/web-fetch.ts";
import { createWebReadTool } from "./tools/web-read.ts";
import { createCodeSearchTool } from "./tools/code-search.ts";
import { createToolsCommand } from "./commands/tools.ts";
import { ContentCache } from "./cache.ts";

interface ProviderFactory {
  create: (key?: string, providerConfig?: ProviderConfigEntry) => {
    search?: SearchProvider;
    fetch?: FetchProvider;
    codeSearch?: CodeSearchProvider;
  };
  tier: 1 | 2 | 3;
  monthlyQuota: number | null;
  requiresKey: boolean;
}

const providerFactories: Record<string, ProviderFactory> = {
  duckduckgo: {
    create: () => ({ search: new DuckDuckGoProvider() }),
    tier: 3, monthlyQuota: null, requiresKey: false,
  },
  jina: {
    create: (key) => {
      const p = new JinaProvider(key);
      return { search: p, fetch: p };
    },
    tier: 3, monthlyQuota: null, requiresKey: false,
  },
  brave: {
    create: (key) => ({ search: new BraveProvider(key!) }),
    tier: 1, monthlyQuota: 2000, requiresKey: true,
  },
  serper: {
    create: (key) => ({ search: new SerperProvider(key!) }),
    tier: 1, monthlyQuota: 2500, requiresKey: true,
  },
  tavily: {
    create: (key) => {
      const p = new TavilyProvider(key!);
      return { search: p, fetch: p };
    },
    tier: 1, monthlyQuota: 1000, requiresKey: true,
  },
  exa: {
    create: (key) => {
      const p = new ExaProvider(key!);
      return { search: p, fetch: p, codeSearch: p };
    },
    tier: 1, monthlyQuota: 1000, requiresKey: true,
  },
  perplexity: {
    create: (key) => ({ search: new PerplexityProvider(key!) }),
    tier: 2, monthlyQuota: null, requiresKey: true,
  },
  firecrawl: {
    create: (key) => {
      const p = new FirecrawlProvider(key!);
      return { search: p, fetch: p };
    },
    tier: 1, monthlyQuota: 1000, requiresKey: true,
  },
  "exa-mcp": {
    create: () => ({ search: new ExaMcpProvider() }),
    tier: 3, monthlyQuota: null, requiresKey: false,
  },
  "openai-native": {
    create: (key) => ({ search: new OpenAINativeProvider(key!) }),
    tier: 1, monthlyQuota: null, requiresKey: true,
  },
  parallel: {
    create: (key) => {
      const p = new ParallelProvider(key!);
      return { search: p, fetch: p };
    },
    tier: 1, monthlyQuota: null, requiresKey: true,
  },
  searxng: {
    create: (_key, providerConfig) => ({
      search: new SearXNGProvider({
        instanceUrl: providerConfig?.instanceUrl,
        apiKey: providerConfig?.apiKey ? resolveApiKey(providerConfig.apiKey) : undefined,
      }),
    }),
    tier: 2, monthlyQuota: null, requiresKey: false,
  },
  websearchapi: {
    create: (key) => ({ search: new WebSearchApiProvider(key!) }),
    tier: 1, monthlyQuota: null, requiresKey: true,
  },
};

function isStoredContent(data: unknown): data is StoredContent {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.id === "string" &&
    typeof d.url === "string" &&
    typeof d.text === "string" &&
    typeof d.chars === "number" &&
    typeof d.storedAt === "string" &&
    (d.source === "web_fetch" || d.source === "web_search")
  );
}

export default function createExtension(pi: ExtensionAPI): void {
  const config = loadMergedConfig(process.cwd());
  const store = new ContentStore((customType, data) =>
    pi.appendEntry(customType, data),
  );
  const tracker = new UsageTracker();
  const registry = new ProviderRegistry(tracker);

  // Register providers based on config
  for (const [name, factory] of Object.entries(providerFactories)) {
    const providerConfig = config.providers[name];
    if (providerConfig?.enabled === false) continue;

    // Resolve API key from config (which may be an env var name, shell cmd, or literal)
    const resolvedKey = resolveApiKey(providerConfig?.apiKey);
    if (factory.requiresKey && !resolvedKey) continue;

    const instances = factory.create(resolvedKey, providerConfig);
    const quota = providerConfig?.monthlyQuota ?? factory.monthlyQuota;

    if (instances.search) {
      registry.registerSearch(instances.search, { tier: factory.tier, monthlyQuota: quota });
    }
    if (instances.fetch) {
      registry.registerFetch(instances.fetch);
    }
    if (instances.codeSearch) {
      registry.registerCodeSearch(instances.codeSearch);
    }
  }

  // Restore stored content from previous session
  pi.on("session_start", (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries();
    const restored = entries
      .filter((e) => e.type === "custom" && e.customType === "pi-tools-content" && e.data)
      .map((e) => (e as { data: unknown }).data)
      .filter(isStoredContent);
    if (restored.length > 0) {
      store.restore(restored);
    }
  });

  const resolveCandidates = config.selectionStrategy === "best-performing"
    ? (name?: string) => {
        const provider = registry.selectSearchByPerformance(name);
        return provider ? [provider] : [];
      }
    : (name?: string) => registry.selectSearchCandidates(name);

  pi.registerTool(
    createWebSearchTool(
      resolveCandidates,
      (providerName, latencyMs) => {
        registry.recordUsage(providerName);
        registry.recordSuccess(providerName, latencyMs);
      },
      config.guidance?.web_search,
      (providerName) => registry.recordFailure(providerName),
    ),
  );
  const fetchCache = new ContentCache(200, 5 * 60_000);
  pi.registerTool(
    createWebFetchTool(
      store,
      () => registry.selectFetchCandidates(),
      fetchCache,
      config.guidance?.web_fetch,
      config.github,
    ),
  );
  pi.registerTool(createWebReadTool(store, config.guidance?.web_read));
  pi.registerTool(
    createCodeSearchTool(
      () => registry.selectCodeSearch(),
      (providerName) => registry.recordUsage(providerName),
      config.guidance?.code_search,
    ),
  );

  // Build tier map for status display
  const tierMap = new Map<string, ProviderTier>();
  for (const [name, factory] of Object.entries(providerFactories)) {
    tierMap.set(name, factory.tier);
  }

  // Register /tools command
  const allProviderNames = Object.keys(providerFactories);
  const toolsCommand = createToolsCommand(registry, tierMap, allProviderNames);
  pi.registerCommand(toolsCommand.name, {
    description: toolsCommand.description,
    handler: toolsCommand.handler,
  });
}
