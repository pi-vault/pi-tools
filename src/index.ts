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
import { createWebResearchTool } from "./tools/web-research.ts";
import { createWebSearchTool } from "./tools/web-search.ts";
import { resolveApiKey } from "./config.ts";
import {
  isOpenAiNativeModel,
  rewriteNativeWebSearch,
} from "./providers/openai-native-rewrite.ts";
import { buildAugmentedGuidance, detectCapabilities } from "./utils/capabilities.ts";
import { recordProjectTrust } from "./utils/trust.ts";

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

  // Detect environment capabilities once at startup
  const caps = detectCapabilities();

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

  // Record project trust state for config gating
  pi.on("session_start", (_event, ctx) => {
    recordProjectTrust(ctx);
  });
  pi.on("model_select", (_event, ctx) => {
    recordProjectTrust(ctx);
  });
  pi.on("before_provider_request", (_event, ctx) => {
    recordProjectTrust(ctx);
  });

  // Layer 1: Rewrite web_search tool to native OpenAI format for OpenAI models
  pi.on("before_provider_request", (event, ctx) => {
    const openaiNativeConfig = configManager.current.providers["openai-web-search"];
    if (openaiNativeConfig?.enabled === false) return undefined;
    if (!isOpenAiNativeModel(ctx?.model as { provider?: string } | undefined)) return undefined;
    const result = rewriteNativeWebSearch(event.payload as { tools?: unknown[] });
    return result.rewritten.length > 0 ? result.payload : undefined;
  });

  const resolveCandidates = (name?: string, combine?: boolean) => {
    configManager.refresh();
    const resolved = name ?? configManager.current.defaultProvider;
    const combineActive = combine ?? configManager.current.combine.enabled;

    if (combineActive) {
      return registry.selectSearchForFusion(configManager.current.selectionStrategy, resolved);
    }

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
      configManager.current.combine,
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
      buildAugmentedGuidance(configManager.current.guidance?.web_fetch, caps),
      configManager.current.github,
      configManager.current.ssrf.allowRanges,
      configManager.current.pdf,
      configManager.current.gemini,
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

  // Register web_research when Exa key is available and deep research enabled
  const exaConfig = configManager.current.providers?.exa;
  const resolvedExaKey = resolveApiKey(exaConfig?.apiKey);
  if (resolvedExaKey && configManager.current.deepResearch?.enabled !== false) {
    pi.registerTool(
      createWebResearchTool(
        resolvedExaKey,
        configManager.current.deepResearch,
        (customType, data) => pi.appendEntry(customType, data),
        configManager.current.deepResearch?.guidance,
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
  const toolsCommand = createToolsCommand(registry, tierMap, allProviderNames, () =>
    configManager.refresh(true),
  );
  pi.registerCommand(toolsCommand.name, {
    description: toolsCommand.description,
    handler: toolsCommand.handler,
  });
}
