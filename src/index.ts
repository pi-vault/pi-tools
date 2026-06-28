import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { ContentStore, type StoredContent } from "./storage.ts";
import { DuckDuckGoProvider } from "./providers/duckduckgo.ts";
import type { SearchProvider } from "./providers/types.ts";
import { createWebSearchTool } from "./tools/web-search.ts";
import { createWebReadTool } from "./tools/web-read.ts";

export default function createExtension(pi: ExtensionAPI): void {
  const _config = loadConfig();
  const store = new ContentStore((customType, data) =>
    pi.appendEntry(customType, data),
  );
  const duckduckgo = new DuckDuckGoProvider();

  function resolveSearchProvider(_name?: string): SearchProvider {
    // Phase 2: only DuckDuckGo. Phase 5 adds the full registry.
    return duckduckgo;
  }

  // Restore stored content from previous session
  pi.on("session_start", (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries();
    const restored = entries
      .filter((e) => e.type === "custom" && e.customType === "pi-tools-content" && e.data)
      .map((e) => (e as { data: StoredContent }).data);
    if (restored.length > 0) {
      store.restore(restored);
    }
  });

  pi.registerTool(createWebSearchTool(resolveSearchProvider));
  pi.registerTool(createWebReadTool(store));
}
