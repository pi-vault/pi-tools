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

export function parseLinkupResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const rawResults = (d.searchResults ?? d.results ?? d.data) as unknown[];
  if (!Array.isArray(rawResults)) return [];
  return rawResults.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: (
        (item.content as string) ||
        (item.snippet as string) ||
        ""
      ).slice(0, 500),
    };
  });
}

export function parseFastcrwResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const rawData = d.data as unknown[];
  if (!Array.isArray(rawData)) return [];
  return rawData.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: (
        (item.description as string) ||
        (item.snippet as string) ||
        ""
      ).slice(0, 500),
    };
  });
}

export function parseYouComResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const rawHits = (d.hits ?? d.results) as unknown[];
  if (!Array.isArray(rawHits)) return [];
  return rawHits.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    const snippets = Array.isArray(item.snippets)
      ? (item.snippets as string[]).join(" ")
      : "";
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: ((item.description as string) || snippets || "").slice(0, 500),
    };
  });
}

export function parseSofyaResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as { results?: unknown[] };
  const results = Array.isArray(d.results) ? d.results : [];
  return results.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: ((item.description as string) || (item.content as string) || "").slice(0, 500),
    };
  });
}

export function parseOpenAINativeResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const output = d.output;
  if (!Array.isArray(output)) return [];

  const messageOutput = output.find(
    (item: unknown) =>
      item && typeof item === "object" && (item as Record<string, unknown>).type === "message",
  ) as Record<string, unknown> | undefined;
  if (!messageOutput) return [];

  const content = messageOutput.content;
  if (!Array.isArray(content)) return [];

  const textContent = content.find(
    (c: unknown) =>
      c && typeof c === "object" && (c as Record<string, unknown>).type === "output_text",
  ) as Record<string, unknown> | undefined;
  if (!textContent) return [];

  const annotations = textContent.annotations;
  if (!Array.isArray(annotations) || annotations.length === 0) return [];

  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const ann of annotations) {
    if (!ann || typeof ann !== "object") continue;
    const a = ann as Record<string, unknown>;
    if (a.type !== "url_citation") continue;
    const url = (a.url as string) || "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    results.push({ title: (a.title as string) || "", url, snippet: "" });
  }
  return results;
}

export function parsePerplexityResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const choices = d.choices as Array<Record<string, unknown>> | undefined;
  const message = choices?.[0]?.message as Record<string, unknown> | undefined;
  const answer = (message?.content as string) || "";
  const citations = Array.isArray(d.citations) ? (d.citations as string[]) : [];
  if (!answer) return [];
  return [
    { title: "Perplexity Answer", url: "", snippet: answer.slice(0, 500) },
    ...citations.map((url) => ({
      title: (url as string) || "",
      url: (url as string) || "",
      snippet: "",
    })),
  ];
}

export function parseWebSearchApiResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const rawResults = d.organic;
  if (!Array.isArray(rawResults)) return [];
  return rawResults.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: ((item.description as string) || "").slice(0, 500),
    };
  });
}

export function parseSerperResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const rawResults = d.organic;
  if (!Array.isArray(rawResults)) return [];
  return rawResults.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.link as string) || "",
      snippet: ((item.snippet as string) || "").slice(0, 500),
    };
  });
}

export function parseDuckDuckGoResults(data: unknown): SearchResult[] {
  if (!Array.isArray(data)) return [];
  return data.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.href as string) || "",
      snippet: ((item.body as string) || "").slice(0, 500),
    };
  });
}

export function parseBraveResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const web = d.web;
  if (!web || typeof web !== "object") return [];
  const rawResults = (web as Record<string, unknown>).results;
  if (!Array.isArray(rawResults)) return [];
  return rawResults.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: ((item.description as string) || "").slice(0, 500),
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

export function parseExaResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const rawResults = d.results;
  if (!Array.isArray(rawResults)) return [];
  return rawResults.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: ((item.text as string) || "").slice(0, 500),
    };
  });
}

export function parseFirecrawlResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const rawData = d.data;
  if (!Array.isArray(rawData)) return [];
  return rawData.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    const description = (item.description as string) || "";
    const markdown = (item.markdown as string) || "";
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: (description || markdown.slice(0, 200)).slice(0, 500),
    };
  });
}

export function parseJinaResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const rawData = d.data;
  if (!Array.isArray(rawData)) return [];
  return rawData.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: ((item.description as string) || "").slice(0, 500),
    };
  });
}

export function parseTavilyResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const rawResults = d.results;
  if (!Array.isArray(rawResults)) return [];
  return rawResults.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: ((item.content as string) || "").slice(0, 500),
    };
  });
}

// SearXNG response shape is identical to Tavily (results[].title/url/content)
export const parseSearxngResults = parseTavilyResults;
