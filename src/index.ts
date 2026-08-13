// src/index.ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ContentCache } from "./cache.ts";
import { createToolsCommand } from "./commands/tools.ts";
import { ConfigManager } from "./config-manager.ts";
import { allProviders } from "./providers/all.ts";
import { createFilePersistence, ProviderRegistry } from "./providers/registry.ts";
import type { ProviderTier } from "./providers/types.ts";
import { ContentStore } from "./storage.ts";
import { createCodeSearchTool } from "./tools/code-search.ts";
import { createWebDocsFetchTool } from "./tools/web-docs-fetch.ts";
import { createWebDocsSearchTool } from "./tools/web-docs-search.ts";
import { createWebFetchTool } from "./tools/web-fetch.ts";
import { createWebReadTool } from "./tools/web-read.ts";
import { createWebResearchTool } from "./tools/web-research.ts";
import { createWebSearchTool } from "./tools/web-search.ts";
import { loadMergedConfig } from "./config.ts";
import { buildAugmentedGuidance, detectCapabilities } from "./utils/capabilities.ts";
import { recordProjectTrust } from "./utils/trust.ts";
import { handleProviderRequest, handleSessionStart } from "./session.ts";

export default function createExtension(pi: ExtensionAPI): void {
  const store = new ContentStore((customType, data) => pi.appendEntry(customType, data));
  const registry = new ProviderRegistry(createFilePersistence());
  const caps = detectCapabilities();
  const fetchCache = new ContentCache(200, 5 * 60_000);
  let configManager: ConfigManager;

  const initializeSession = (ctx: ExtensionContext): void => {
    configManager = new ConfigManager(ctx.cwd, registry, allProviders, ctx.modelRegistry);

    const executionHooks = registry.getExecutionHooks();

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
        executionHooks.onSuccess,
        configManager.current.guidance?.web_search,
        executionHooks.onFailure,
        (providerName, resultCount, requestedCount) => {
          registry.recordResultQuality(providerName, resultCount, requestedCount);
        },
        configManager.current.combine,
      ),
    );
    pi.registerTool(
      createWebFetchTool(
        store,
        () => {
          configManager.refresh();
          return registry.selectFetchCandidates(configManager.current.selectionStrategy);
        },
        fetchCache,
        buildAugmentedGuidance(configManager.current.guidance?.web_fetch, caps),
        executionHooks,
      ),
    );
    pi.registerTool(createWebReadTool(store, configManager.current.guidance?.web_read));
    pi.registerTool(
      createCodeSearchTool(
        () => {
          configManager.refresh();
          return registry.selectCodeSearch(configManager.current.selectionStrategy);
        },
        undefined,
        configManager.current.guidance?.code_search,
        executionHooks,
      ),
    );

    // Register docs tools when Context7 provider is available
    if (registry.selectDocs()) {
      const selectDocs = () => {
        configManager.refresh();
        return registry.selectDocsByStrategy(configManager.current.selectionStrategy);
      };
      pi.registerTool(
        createWebDocsSearchTool(
          selectDocs,
          configManager.current.guidance?.web_docs_search,
          executionHooks,
        ),
      );
      pi.registerTool(
        createWebDocsFetchTool(
          selectDocs,
          store,
          configManager.current.guidance?.web_docs_fetch,
          executionHooks,
        ),
      );
    }

    // Register web_research when any research provider is registered
    const researchEnabled = configManager.current.deepResearch?.enabled !== false;
    const researchProviders = researchEnabled
      ? registry.selectResearchCandidates(configManager.current.selectionStrategy)
      : [];
    if (researchProviders.length > 0) {
      const resolveResearch = () => {
        configManager.refresh();
        if (configManager.current.deepResearch.enabled === false) return [];
        return registry.selectResearchCandidates(configManager.current.selectionStrategy);
      };
      pi.registerTool(
        createWebResearchTool(
          resolveResearch,
          configManager.current.deepResearch,
          (customType, data) => pi.appendEntry(customType, data),
          configManager.current.deepResearch?.guidance,
          executionHooks,
        ),
      );
    }
  };

  // Session lifecycle — delegated to session.ts
  pi.on("session_start", (event, ctx) => handleSessionStart(event, ctx, store, initializeSession));
  pi.on("model_select", (_event, ctx) => {
    recordProjectTrust(ctx);
  });
  pi.on("before_provider_request", (event, ctx) =>
    handleProviderRequest(event, ctx, () => configManager.current),
  );

  // Build tier map for status display
  const tierMap = new Map<string, ProviderTier>(allProviders.map((meta) => [meta.name, meta.tier]));

  // Register /tools command
  const allProviderNames = allProviders.map((m) => m.name);
  const toolsCommand = createToolsCommand(registry, tierMap, allProviderNames, {
    getConfig: (scope) => {
      const config = scope === "global" ? loadMergedConfig() : configManager.current;
      return {
        providers: config.providers,
        defaultProvider: config.defaultProvider,
      };
    },
    reload: () => configManager.refresh(true),
  });
  pi.registerCommand(toolsCommand.name, {
    description: toolsCommand.description,
    handler: toolsCommand.handler,
  });

  // Session lifecycle: reset activity monitor on session boundaries
  pi.on("session_shutdown", () => {
    toolsCommand.resetMonitor();
  });
}
