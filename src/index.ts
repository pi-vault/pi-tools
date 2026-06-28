import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { DuckDuckGoProvider } from "./providers/duckduckgo.ts";
import type { SearchProvider } from "./providers/types.ts";
import { createWebSearchTool } from "./tools/web-search.ts";

export default function createExtension(pi: ExtensionAPI): void {
  const _config = loadConfig();
  const duckduckgo = new DuckDuckGoProvider();

  function resolveSearchProvider(_name?: string): SearchProvider {
    // Phase 2: only DuckDuckGo. Phase 5 adds the full registry.
    return duckduckgo;
  }

  pi.registerTool(createWebSearchTool(resolveSearchProvider));
}
