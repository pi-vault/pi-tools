// src/session.ts
import type {
  BeforeProviderRequestEvent,
  BeforeProviderRequestEventResult,
  ExtensionContext,
  SessionEntry,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import type { PiToolsConfig } from "./config.ts";
import {
  isOpenAiNativeModel,
  rewriteNativeWebSearch,
} from "./providers/openai-native-rewrite.ts";
import type { ContentStore, StoredContent } from "./storage.ts";
import { recordProjectTrust } from "./utils/trust.ts";

/** Type guard for validating stored content entries from session restore. */
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

/**
 * Handle session_start: restore persisted content, record trust, refresh config.
 */
export function handleSessionStart(
  _event: SessionStartEvent,
  ctx: ExtensionContext,
  store: ContentStore,
  refresh: () => void,
): void {
  restoreContent(ctx.sessionManager.getEntries(), store);
  recordProjectTrust(ctx);
  refresh();
}

/**
 * Handle before_provider_request: record trust + OpenAI native web search rewrite.
 * Returns the rewritten payload for OpenAI models, undefined otherwise.
 */
export function handleProviderRequest(
  event: BeforeProviderRequestEvent,
  ctx: ExtensionContext,
  configGetter: () => PiToolsConfig,
): BeforeProviderRequestEventResult | void {
  recordProjectTrust(ctx);

  const config = configGetter();
  const openaiNativeConfig = config.providers["openai-web-search"];
  if (openaiNativeConfig?.enabled === false) return undefined;
  if (!isOpenAiNativeModel(ctx?.model as { provider?: string } | undefined)) return undefined;
  const result = rewriteNativeWebSearch(event.payload as { tools?: unknown[] });
  return result.rewritten.length > 0 ? result.payload : undefined;
}

/** Filter valid stored content from session entries and restore into the store. */
function restoreContent(entries: SessionEntry[], store: ContentStore): void {
  const restored = entries
    .filter((e) => e.type === "custom" && e.customType === "pi-tools-content" && e.data)
    .map((e) => (e as { data: unknown }).data)
    .filter(isStoredContent);
  if (restored.length > 0) {
    store.restore(restored);
  }
}
