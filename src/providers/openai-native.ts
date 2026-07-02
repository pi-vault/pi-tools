// src/providers/openai-native.ts
import type { SearchFilters, SearchProvider, SearchResult } from "./types.ts";

const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1-nano";

interface UrlCitation {
  type: "url_citation";
  url: string;
  title: string;
  start_index: number;
  end_index: number;
}

interface OutputText {
  type: "output_text";
  text: string;
  annotations?: UrlCitation[];
}

interface MessageOutput {
  type: "message";
  role: string;
  content: OutputText[];
}

interface WebSearchCallOutput {
  type: "web_search_call";
  id: string;
  status: string;
  action?: { type: string; query?: string };
}

type OutputItem = MessageOutput | WebSearchCallOutput | { type: string };

interface OpenAIResponsesResult {
  id: string;
  output: OutputItem[];
}

export class OpenAINativeProvider implements SearchProvider {
  readonly name = "openai-native";
  readonly label = "OpenAI Web Search";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    _filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        tools: [{ type: "web_search" }],
        tool_choice: "required",
        input: `Search the web for: ${query}`,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as OpenAIResponsesResult;

    // Find the message output containing url_citation annotations
    const messageOutput = data.output.find(
      (item): item is MessageOutput => item.type === "message",
    );
    if (!messageOutput) return [];

    const textContent = messageOutput.content?.find(
      (c): c is OutputText => c.type === "output_text",
    );
    if (!textContent?.annotations?.length) return [];

    // Deduplicate by URL, preserving order
    const seen = new Set<string>();
    const results: SearchResult[] = [];
    for (const ann of textContent.annotations) {
      if (ann.type !== "url_citation") continue;
      if (seen.has(ann.url)) continue;
      seen.add(ann.url);
      results.push({
        title: ann.title,
        url: ann.url,
        snippet: "",
      });
      if (results.length >= maxResults) break;
    }

    return results;
  }
}
