import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { ContentStore, type StoredContent } from "./storage.ts";
import { UsageTracker } from "./providers/usage.ts";
import { ProviderRegistry } from "./providers/registry.ts";
import { DuckDuckGoProvider } from "./providers/duckduckgo.ts";
import type { SearchProvider } from "./providers/types.ts";
import { createWebSearchTool } from "./tools/web-search.ts";
import { createWebFetchTool } from "./tools/web-fetch.ts";
import { createWebReadTool } from "./tools/web-read.ts";

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

  // Register DuckDuckGo (always available, tier 3)
  if (config.providers.duckduckgo?.enabled !== false) {
    registry.registerSearch(new DuckDuckGoProvider(), {
      tier: 3,
      monthlyQuota: null,
    });
  }

  function resolveSearchProvider(name?: string): SearchProvider {
    const provider = registry.selectSearch(name);
    if (!provider) {
      throw new Error("No search providers available");
    }
    return provider;
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
      (name) => resolveSearchProvider(name),
      (providerName) => registry.recordUsage(providerName),
    ),
  );
  pi.registerTool(createWebFetchTool(store));
  pi.registerTool(createWebReadTool(store));
}
