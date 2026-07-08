// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ContentCache } from "./cache.ts";
import { createToolsCommand } from "./commands/tools.ts";
import { ConfigManager } from "./config-manager.ts";
import { allProviders } from "./providers/all.ts";
import { createFilePersistence, ProviderRegistry } from "./providers/registry.ts";
import type { ProviderTier } from "./providers/types.ts";
import { ContentStore, type StoredContent } from "./storage.ts";
import { createCodeSearchTool } from "./tools/code-search.ts";
import { createWebDocsFetchTool } from "./tools/web-docs-fetch.ts";
import { createWebDocsSearchTool } from "./tools/web-docs-search.ts";
import { createWebFetchTool } from "./tools/web-fetch.ts";
import { createWebReadTool } from "./tools/web-read.ts";
import { createWebSearchTool } from "./tools/web-search.ts";

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
  const store = new ContentStore((customType, data) => pi.appendEntry(customType, data));
  const registry = new ProviderRegistry(createFilePersistence());
  const configManager = new ConfigManager(process.cwd(), registry, allProviders);

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

  const resolveCandidates = (name?: string) => {
    configManager.refresh();
    const resolved = name ?? configManager.current.defaultProvider;
    if (configManager.current.selectionStrategy === "best-performing") {
      const provider = registry.selectSearchByPerformance(resolved);
      return provider ? [provider] : [];
    }
    return registry.selectSearchCandidates(resolved);
  };

  // Guidance values are evaluated once at registration time; changing guidance
  // mid-session requires a restart (dynamic guidance would need 6 factory changes).
  pi.registerTool(
    createWebSearchTool(
      resolveCandidates,
      (providerName, latencyMs) => {
        registry.recordOutcome(providerName, { success: true, latencyMs });
      },
      configManager.current.guidance?.web_search,
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
      () => {
        configManager.refresh();
        return registry.selectFetchCandidates();
      },
      fetchCache,
      configManager.current.guidance?.web_fetch,
      configManager.current.github,
    ),
  );
  pi.registerTool(createWebReadTool(store, configManager.current.guidance?.web_read));
  pi.registerTool(
    createCodeSearchTool(
      () => {
        configManager.refresh();
        return registry.selectCodeSearch();
      },
      // Usage tick only — code-search has no failure callback
      (providerName) => registry.recordOutcome(providerName, { success: true }),
      configManager.current.guidance?.code_search,
    ),
  );

  // Register docs tools when Context7 provider is available
  const docsProvider = registry.selectDocs();
  if (docsProvider) {
    const selectDocs = () => {
      configManager.refresh();
      return registry.selectDocs() ?? docsProvider;
    };
    pi.registerTool(
      createWebDocsSearchTool(selectDocs, configManager.current.guidance?.web_docs_search),
    );
    pi.registerTool(
      createWebDocsFetchTool(selectDocs, store, configManager.current.guidance?.web_docs_fetch),
    );
  }

  // Build tier map for status display
  const tierMap = new Map<string, ProviderTier>();
  for (const meta of allProviders) {
    tierMap.set(meta.name, meta.tier);
  }

  // Register /tools command
  const allProviderNames = allProviders.map((m) => m.name);
  const toolsCommand = createToolsCommand(registry, tierMap, allProviderNames, () =>
    configManager.refresh(true),
  );
  pi.registerCommand(toolsCommand.name, {
    description: toolsCommand.description,
    handler: toolsCommand.handler,
  });
}
