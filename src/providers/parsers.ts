import type { SearchResult } from "./types.ts";

export function parseMarginaliaResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as { results?: unknown[] };
  const results = Array.isArray(d.results) ? d.results : [];
  return results.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: ((item.description as string) || "").slice(0, 500),
    };
  });
}

export function parseBraveLlmResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as { grounding?: unknown };
  if (!d.grounding || typeof d.grounding !== "object") return [];
  const g = d.grounding as { generic?: unknown };
  if (!Array.isArray(g.generic)) return [];
  return g.generic.map((entry: unknown) => {
    if (!entry || typeof entry !== "object")
      return { title: "", url: "", snippet: "" };
    const e = entry as Record<string, unknown>;
    const snippets = Array.isArray(e.snippets) ? (e.snippets as string[]) : [];
    return {
      title: (e.title as string) || "",
      url: (e.url as string) || "",
      snippet: snippets.join("\n\n"),
    };
  });
}

export function parseLangSearchResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const pages = (d.data as Record<string, unknown>)?.webPages as Record<string, unknown> | undefined;
  const items = pages?.value ?? d.results ?? d.data ?? [];
  if (!Array.isArray(items)) return [];
  return items.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.name as string) || (item.title as string) || "",
      url: (item.url as string) || (item.link as string) || "",
      snippet: ((item.snippet as string) || (item.description as string) || "").slice(0, 500),
    };
  });
}
