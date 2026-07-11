# Deep Research — Phase 2: Exa Deep Research Client

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `ExaDeepResearchClient` that hits Exa's `/search` endpoint with deep types and normalizes the response.

**Architecture:** A dedicated client class in `src/providers/exa-deep-research.ts` that owns its own API key and headers, independently of the existing `ExaProvider`. It builds rich request bodies (contents config, highlights, system prompts, output schemas) and normalizes Exa's response format into the `DeepResearchResponse` interface from Phase 1.

**Tech Stack:** TypeScript, Vitest, `stubFetch` test helper

**Spec:** `docs/superpowers/specs/2026-07-11-deep-research-design.md`
**Main plan:** `docs/superpowers/plans/2026-07-11-deep-research.md`

**Depends on:** Phase 1 (types from `src/research/types.ts`)
**Produces:** Tested Exa client ready for use by the tool's execute function.

---

## Context for the Engineer

The existing `ExaProvider` in `src/providers/exa.ts` is a simple class (117 lines) that handles regular search, fetch, and code search. It sends minimal request bodies to Exa's API.

Deep research needs a much richer request: contents options (text limits, highlights config, summary query), system prompts, output schemas, additional queries, etc. This client is intentionally separate — it duplicates the 3-line header helper rather than sharing a base class.

Tests use `stubFetch()` from `tests/helpers.ts`:

```typescript
import { stubFetch } from "../helpers.ts";
let fetchStub: ReturnType<typeof stubFetch>;
beforeEach(() => {
  fetchStub = stubFetch();
});
afterEach(() => {
  fetchStub.restore();
});
fetchStub.addResponse("api.exa.ai/search", { body: { results: [] } });
```

The mock intercepts `globalThis.fetch`. You can inspect calls via `(globalThis.fetch as any).mock.calls[0]`.

---

### Task 2: ExaDeepResearchClient

**Files:**

- Create: `src/providers/exa-deep-research.ts`
- Test: `tests/providers/exa-deep-research.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/providers/exa-deep-research.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExaDeepResearchClient } from "../../src/providers/exa-deep-research.ts";
import { stubFetch } from "../helpers.ts";

describe("ExaDeepResearchClient", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });
  afterEach(() => {
    fetchStub.restore();
  });

  it("sends correct headers with API key", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [] },
    });
    const client = new ExaDeepResearchClient("test-key");
    await client.deepResearch({ query: "test", type: "deep-lite" });

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["x-api-key"]).toBe("test-key");
    expect(fetchCall[1].headers["Content-Type"]).toBe("application/json");
  });

  it("sends deep type in request body", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [] },
    });
    const client = new ExaDeepResearchClient("key");
    await client.deepResearch({ query: "test", type: "deep-reasoning" });

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.type).toBe("deep-reasoning");
    expect(body.query).toBe("test");
  });

  it("builds contents config with text and highlights", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [] },
    });
    const client = new ExaDeepResearchClient("key");
    await client.deepResearch({
      query: "test",
      type: "deep-reasoning",
      textMaxCharacters: 16000,
      highlightsMaxCharacters: 900,
      highlightNumSentences: 4,
      highlightsPerUrl: 2,
    });

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.contents.text.maxCharacters).toBe(16000);
    expect(body.contents.highlights.maxCharacters).toBe(900);
    expect(body.contents.highlights.numSentences).toBe(4);
    expect(body.contents.highlights.highlightsPerUrl).toBe(2);
  });

  it("includes summaryQuery in contents when provided", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [] },
    });
    const client = new ExaDeepResearchClient("key");
    await client.deepResearch({
      query: "test",
      type: "deep-reasoning",
      summaryQuery: "Summarize findings",
    });

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.contents.summary.query).toBe("Summarize findings");
  });

  it("includes optional params when provided", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [] },
    });
    const client = new ExaDeepResearchClient("key");
    await client.deepResearch({
      query: "test",
      type: "deep-reasoning",
      numResults: 50,
      category: "research paper",
      maxAgeHours: 720,
      includeDomains: ["arxiv.org"],
      excludeDomains: ["spam.com"],
      startPublishedDate: "2025-01-01",
      endPublishedDate: "2025-12-31",
      additionalQueries: ["related topic"],
      systemPrompt: "You are a researcher.",
      outputSchema: { type: "object", properties: {} },
    });

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.numResults).toBe(50);
    expect(body.category).toBe("research paper");
    expect(body.maxAgeHours).toBe(720);
    expect(body.includeDomains).toEqual(["arxiv.org"]);
    expect(body.excludeDomains).toEqual(["spam.com"]);
    expect(body.startPublishedDate).toBe("2025-01-01");
    expect(body.endPublishedDate).toBe("2025-12-31");
    expect(body.additionalQueries).toEqual(["related topic"]);
    expect(body.systemPrompt).toBe("You are a researcher.");
    expect(body.outputSchema).toEqual({ type: "object", properties: {} });
  });

  it("normalizes response results", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: {
        results: [
          {
            title: "Source 1",
            url: "https://example.com/1",
            text: "Full text",
            summary: "Brief summary",
            highlights: ["highlight 1"],
            publishedDate: "2025-06-01",
          },
        ],
        answer: "Synthesized answer",
      },
    });
    const client = new ExaDeepResearchClient("key");
    const response = await client.deepResearch({
      query: "test",
      type: "deep-lite",
    });

    expect(response.answer).toBe("Synthesized answer");
    expect(response.results).toHaveLength(1);
    expect(response.results[0].title).toBe("Source 1");
    expect(response.results[0].url).toBe("https://example.com/1");
    expect(response.results[0].text).toBe("Full text");
    expect(response.results[0].summary).toBe("Brief summary");
    expect(response.results[0].highlights).toEqual(["highlight 1"]);
    expect(response.results[0].publishedDate).toBe("2025-06-01");
  });

  it("handles structured output in response", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: {
        results: [],
        output: {
          content: {
            executiveSummary: "Summary here",
            keyFindings: ["finding 1"],
          },
        },
      },
    });
    const client = new ExaDeepResearchClient("key");
    const response = await client.deepResearch({
      query: "test",
      type: "deep-reasoning",
    });

    expect(response.answer).toContain("Summary here");
    expect(response.raw).toHaveProperty("output");
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      status: 429,
      body: "Rate limited",
    });
    const client = new ExaDeepResearchClient("key");
    await expect(
      client.deepResearch({ query: "test", type: "deep-lite" }),
    ).rejects.toThrow(/429/);
  });

  it("omits undefined optional params from request body", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [] },
    });
    const client = new ExaDeepResearchClient("key");
    await client.deepResearch({ query: "test", type: "deep-lite" });

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.category).toBeUndefined();
    expect(body.maxAgeHours).toBeUndefined();
    expect(body.includeDomains).toBeUndefined();
    expect(body.excludeDomains).toBeUndefined();
    expect(body.systemPrompt).toBeUndefined();
    expect(body.outputSchema).toBeUndefined();
  });

  it("passes abort signal to fetch", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [] },
    });
    const controller = new AbortController();
    const client = new ExaDeepResearchClient("key");
    await client.deepResearch(
      { query: "test", type: "deep-lite" },
      controller.signal,
    );

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].signal).toBe(controller.signal);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/providers/exa-deep-research.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/providers/exa-deep-research.ts`:

```typescript
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
    text:
      typeof r.text === "string"
        ? r.text
        : typeof r.contents === "string"
          ? r.contents
          : undefined,
    summary: typeof r.summary === "string" ? r.summary : undefined,
    highlights: Array.isArray(r.highlights)
      ? r.highlights.filter((h: unknown) => typeof h === "string")
      : undefined,
    publishedDate:
      typeof r.publishedDate === "string" ? r.publishedDate : undefined,
  }));
}

function synthesizeAnswer(raw: any): string | undefined {
  const outputContent = raw?.output?.content;
  if (typeof outputContent === "string" && outputContent.trim())
    return outputContent;
  if (
    outputContent &&
    typeof outputContent === "object" &&
    !Array.isArray(outputContent)
  ) {
    const parts: string[] = [];
    if (typeof outputContent.executiveSummary === "string")
      parts.push(outputContent.executiveSummary);
    if (Array.isArray(outputContent.keyFindings)) {
      parts.push(
        outputContent.keyFindings.map((f: string) => `- ${f}`).join("\n"),
      );
    }
    if (typeof outputContent.recommendation === "string")
      parts.push(outputContent.recommendation);
    if (parts.length) return parts.join("\n\n");
  }
  for (const key of ["answer", "summary", "output", "research", "text"]) {
    if (typeof raw?.[key] === "string" && raw[key].trim()) return raw[key];
  }
  if (typeof raw?.data?.answer === "string") return raw.data.answer;
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
    const highlights = Object.keys(highlightsOptions).length
      ? highlightsOptions
      : true;

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
    if (params.includeDomains?.length)
      body.includeDomains = params.includeDomains;
    if (params.excludeDomains?.length)
      body.excludeDomains = params.excludeDomains;
    if (params.startPublishedDate)
      body.startPublishedDate = params.startPublishedDate;
    if (params.endPublishedDate)
      body.endPublishedDate = params.endPublishedDate;
    if (params.additionalQueries?.length)
      body.additionalQueries = params.additionalQueries;
    if (params.systemPrompt) body.systemPrompt = params.systemPrompt;
    if (params.outputSchema) body.outputSchema = params.outputSchema;

    return body;
  }

  async deepResearch(
    params: DeepResearchParams,
    signal?: AbortSignal,
  ): Promise<DeepResearchResponse> {
    const response = await fetch(`${this.baseUrl}/search`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(params)),
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
      metadata: { request: this.buildBody(params) },
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/providers/exa-deep-research.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/exa-deep-research.ts tests/providers/exa-deep-research.test.ts
git commit -m "feat(research): add ExaDeepResearchClient"
```
