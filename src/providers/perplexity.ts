// src/providers/perplexity.ts
import type { SearchProvider, SearchResult } from "./types.ts";

interface PerplexityResponse {
  choices: Array<{ message: { content: string } }>;
  citations?: string[];
}

export class PerplexityProvider implements SearchProvider {
  readonly name = "perplexity";
  readonly label = "Perplexity Sonar";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: query }],
      }),
      signal,
    });
    if (!response.ok) throw new Error(`Perplexity API error: ${response.status} ${response.statusText}`);
    const data = (await response.json()) as PerplexityResponse;

    const answer = data.choices?.[0]?.message?.content ?? "";
    const citations = data.citations ?? [];
    const results: SearchResult[] = [];

    // Main answer as first result
    if (answer) {
      results.push({ title: "Perplexity Answer", url: "", snippet: answer });
    }

    // Citations as additional results
    for (const url of citations.slice(0, maxResults - 1)) {
      results.push({ title: url, url, snippet: "" });
    }

    return results.slice(0, maxResults);
  }
}
