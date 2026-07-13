// src/providers/openai-codex.ts
import type { ProviderConfigEntry } from "../config.ts";
import type { ProviderMeta, SearchResult } from "./types.ts";

const DEFAULT_SEARCH_CONTEXT_SIZE = "low";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Payload injection callback for streamOpenAICodexResponses.
 * Adds web_search tool with external_web_access and search_context_size.
 */
export function injectCodexSearchPayload(payload: unknown): unknown {
  const body = isRecord(payload) ? payload : {};
  const existingTools = Array.isArray(body.tools) ? body.tools.filter(Boolean) : [];
  const filteredTools = existingTools.filter((tool) => {
    if (!isRecord(tool)) return true;
    return tool.type !== "web_search";
  });

  body.tools = [
    { type: "web_search", external_web_access: true, search_context_size: DEFAULT_SEARCH_CONTEXT_SIZE },
    ...filteredTools,
  ];
  body.tool_choice = "auto";
  body.parallel_tool_calls = false;

  const include = Array.isArray(body.include)
    ? body.include.filter((value): value is string => typeof value === "string")
    : [];
  body.include = Array.from(new Set([...include, "web_search_call.action.sources"]));

  return body;
}

const MAX_TOOL_RESULTS = 20;
const MAX_TITLE_LENGTH = 200;
const MAX_SNIPPET_LENGTH = 1000;

/**
 * Parse the submit_search_results tool call arguments into SearchResult[].
 */
export function normalizeCodexToolCallResults(args: unknown, maxResults: number): SearchResult[] {
  if (!isRecord(args) || !Array.isArray(args.results)) return [];

  const limit = Math.max(1, Math.min(maxResults, MAX_TOOL_RESULTS));
  const seen = new Set<string>();
  const results: SearchResult[] = [];

  for (const raw of args.results) {
    if (!isRecord(raw)) continue;

    const url = normalizeHttpUrl(raw.url);
    if (!url) continue;

    const dedupeKey = url.toLowerCase().replace(/\/+$/, "");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const title = truncateText(cleanString(raw.title) || safeHostname(url), MAX_TITLE_LENGTH);
    const snippet = truncateText(cleanString(raw.snippet), MAX_SNIPPET_LENGTH);

    results.push({ title, url, snippet });
    if (results.length >= limit) break;
  }

  return results;
}

function normalizeHttpUrl(value: unknown): string | undefined {
  const input = cleanString(value);
  if (!input) return undefined;
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function safeHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

export const providerMeta: ProviderMeta = {
  name: "openai-codex",
  tier: 1,
  monthlyQuota: null,
  requiresKey: false,
  create: (_key?: string, _providerConfig?: ProviderConfigEntry) => ({}),
};
