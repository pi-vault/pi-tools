// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, resolveApiKey } from "./config.ts";
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
import type { FetchProvider, SearchProvider, CodeSearchProvider } from "./providers/types.ts";
import { createWebSearchTool } from "./tools/web-search.ts";
import { createWebFetchTool } from "./tools/web-fetch.ts";
import { createWebReadTool } from "./tools/web-read.ts";
import { createCodeSearchTool } from "./tools/code-search.ts";

interface ProviderFactory {
  create: (key?: string) => {
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
  const config = loadConfig();
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

    const instances = factory.create(resolvedKey);
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

  pi.registerTool(
    createWebSearchTool(
      (name) => registry.selectSearchCandidates(name),
      (providerName) => registry.recordUsage(providerName),
    ),
  );
  pi.registerTool(createWebFetchTool(store, () => registry.selectFetchCandidates()));
  pi.registerTool(createWebReadTool(store));
  pi.registerTool(
    createCodeSearchTool(
      () => registry.selectCodeSearch(),
      (providerName) => registry.recordUsage(providerName),
    ),
  );
}
