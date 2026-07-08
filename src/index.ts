// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadMergedConfig, resolveApiKey } from "./config.ts";
import { ContentStore, type StoredContent } from "./storage.ts";
import { ProviderRegistry, createFilePersistence } from "./providers/registry.ts";
import { allProviders } from "./providers/all.ts";
import type { ProviderTier } from "./providers/types.ts";
import { createWebSearchTool } from "./tools/web-search.ts";
import { createWebFetchTool } from "./tools/web-fetch.ts";
import { createWebReadTool } from "./tools/web-read.ts";
import { createCodeSearchTool } from "./tools/code-search.ts";
import { createWebDocsSearchTool } from "./tools/web-docs-search.ts";
import { createWebDocsFetchTool } from "./tools/web-docs-fetch.ts";
import { createToolsCommand } from "./commands/tools.ts";
import { ContentCache } from "./cache.ts";

function isStoredContent(data: unknown): data is StoredContent {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.id === "string" &&
    typeof d.url === "string" &&
    typeof d.text === "string" &&
    typeof d.chars === "number" &&
    typeof d.storedAt === "string" &&
    (d.source === "web_fetch" || d.source === "web_docs_fetch")
  );
}

export default function createExtension(pi: ExtensionAPI): void {
  const config = loadMergedConfig(process.cwd());
  const store = new ContentStore((customType, data) =>
    pi.appendEntry(customType, data),
  );
  const registry = new ProviderRegistry(createFilePersistence());

  // Register providers from the barrel
  for (const meta of allProviders) {
    const providerConfig = config.providers[meta.name];
    if (providerConfig?.enabled === false) continue;

    const resolvedKey = resolveApiKey(providerConfig?.apiKey);
    if (meta.requiresKey && !resolvedKey) continue;

    const instances = meta.create(resolvedKey, providerConfig);
    const quota = providerConfig?.monthlyQuota ?? meta.monthlyQuota;

    if (instances.search) {
      registry.registerSearch(instances.search, { tier: meta.tier, monthlyQuota: quota });
    }
    if (instances.fetch) {
      registry.registerFetch(instances.fetch);
    }
    if (instances.codeSearch) {
      registry.registerCodeSearch(instances.codeSearch);
    }
    if (instances.docs) {
      registry.registerDocs(instances.docs);
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

  const resolveProviderName = (name?: string) => name ?? config.defaultProvider;

  const resolveCandidates = config.selectionStrategy === "best-performing"
    ? (name?: string) => {
        const provider = registry.selectSearchByPerformance(resolveProviderName(name));
        return provider ? [provider] : [];
      }
    : (name?: string) => registry.selectSearchCandidates(resolveProviderName(name));

  pi.registerTool(
    createWebSearchTool(
      resolveCandidates,
      (providerName, latencyMs) => {
        registry.recordOutcome(providerName, { success: true, latencyMs });
      },
      config.guidance?.web_search,
      (providerName) => registry.recordOutcome(providerName, { success: false }),
      (providerName, resultCount, requestedCount) => {
        registry.recordResultQuality(providerName, resultCount, requestedCount);
      },
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
      // Usage tick only — code-search has no failure callback
      (providerName) => registry.recordOutcome(providerName, { success: true }),
      config.guidance?.code_search,
    ),
  );

  // Register docs tools when Context7 provider is available
  const docsProvider = registry.selectDocs();
  if (docsProvider) {
    pi.registerTool(
      createWebDocsSearchTool(
        () => docsProvider,
        config.guidance?.web_docs_search,
      ),
    );
    pi.registerTool(
      createWebDocsFetchTool(
        () => docsProvider,
        store,
        config.guidance?.web_docs_fetch,
      ),
    );
  }

  // Build tier map for status display
  const tierMap = new Map<string, ProviderTier>();
  for (const meta of allProviders) {
    tierMap.set(meta.name, meta.tier);
  }

  // Register /tools command
  const allProviderNames = allProviders.map((m) => m.name);
  const toolsCommand = createToolsCommand(registry, tierMap, allProviderNames);
  pi.registerCommand(toolsCommand.name, {
    description: toolsCommand.description,
    handler: toolsCommand.handler,
  });
}
