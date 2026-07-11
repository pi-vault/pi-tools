import type {
  DeepResearchParams,
  DeepResearchResponse,
  DeepResearchResult,
} from "../research/types.ts";

function normalizeResults(raw: any): DeepResearchResult[] {
  const results: any[] = Array.isArray(raw?.results)
    ? raw.results
    : Array.isArray(raw?.sources)
      ? raw.sources
      : [];
  return results.map((r) => ({
    title: typeof r.title === "string" ? r.title : undefined,
    url: typeof r.url === "string" ? r.url : undefined,
    text: typeof r.text === "string" ? r.text : undefined,
    summary: typeof r.summary === "string" ? r.summary : undefined,
    highlights: Array.isArray(r.highlights)
      ? r.highlights.filter((h: unknown) => typeof h === "string")
      : undefined,
    publishedDate: typeof r.publishedDate === "string" ? r.publishedDate : undefined,
  }));
}

function synthesizeAnswer(raw: any): string | undefined {
  const outputContent = raw?.output?.content;
  if (typeof outputContent === "string" && outputContent.trim()) return outputContent;
  if (outputContent && typeof outputContent === "object" && !Array.isArray(outputContent)) {
    const parts: string[] = [];
    if (typeof outputContent.executiveSummary === "string")
      parts.push(outputContent.executiveSummary);
    if (Array.isArray(outputContent.keyFindings)) {
      parts.push(outputContent.keyFindings.map((f: string) => `- ${f}`).join("\n"));
    }
    if (typeof outputContent.recommendation === "string") parts.push(outputContent.recommendation);
    if (parts.length) return parts.join("\n\n");
  }
  if (typeof raw?.answer === "string" && raw.answer.trim()) return raw.answer;
  return undefined;
}

export class ExaDeepResearchClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://api.exa.ai") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
    };
  }

  private buildBody(params: DeepResearchParams): Record<string, unknown> {
    const highlightsOptions: Record<string, unknown> = {};
    if (params.highlightsMaxCharacters != null)
      highlightsOptions.maxCharacters = params.highlightsMaxCharacters;
    if (params.highlightNumSentences != null)
      highlightsOptions.numSentences = params.highlightNumSentences;
    if (params.highlightsPerUrl != null)
      highlightsOptions.highlightsPerUrl = params.highlightsPerUrl;
    const highlights = Object.keys(highlightsOptions).length ? highlightsOptions : true;

    const contents: Record<string, unknown> = {
      text: { maxCharacters: params.textMaxCharacters ?? 12000 },
      highlights,
    };
    if (params.summaryQuery) contents.summary = { query: params.summaryQuery };

    const body: Record<string, unknown> = {
      query: params.query,
      type: params.type,
      numResults: params.numResults ?? 10,
      contents,
    };

    if (params.category) body.category = params.category;
    if (params.maxAgeHours != null) body.maxAgeHours = params.maxAgeHours;
    if (params.includeDomains?.length) body.includeDomains = params.includeDomains;
    if (params.excludeDomains?.length) body.excludeDomains = params.excludeDomains;
    if (params.startPublishedDate) body.startPublishedDate = params.startPublishedDate;
    if (params.endPublishedDate) body.endPublishedDate = params.endPublishedDate;
    if (params.additionalQueries?.length) body.additionalQueries = params.additionalQueries;
    if (params.systemPrompt) body.systemPrompt = params.systemPrompt;
    if (params.outputSchema) body.outputSchema = params.outputSchema;

    return body;
  }

  async deepResearch(
    params: DeepResearchParams,
    signal?: AbortSignal,
  ): Promise<DeepResearchResponse> {
    const body = this.buildBody(params);
    const response = await fetch(`${this.baseUrl}/search`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Exa deep research failed (${response.status}): ${text || response.statusText}`,
      );
    }
    const raw = await response.json();
    return {
      answer: synthesizeAnswer(raw),
      results: normalizeResults(raw),
      raw,
      metadata: { request: body },
    };
  }
}
