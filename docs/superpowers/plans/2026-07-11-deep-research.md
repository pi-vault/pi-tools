# Deep Research (`web_research`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `web_research` tool to pi-tools that replicates pi-web-tools' Exa Deep Search capability with lite/standard/full modes, findings reports, and full config integration.

**Architecture:** Separate `ExaDeepResearchClient` hits Exa's `/search` endpoint with deep types. Research logic (mode resolution, context preparation, report rendering) lives in `src/research/`. The tool registers conditionally when the Exa API key is configured. File writes use `withFileMutationQueue` from the peer dep.

**Tech Stack:** TypeScript, Vitest, typebox (schema), `@earendil-works/pi-coding-agent` (withFileMutationQueue, types), `@earendil-works/pi-tui` (Text rendering)

---

## File Map

| File                                        | Responsibility                                          |
| ------------------------------------------- | ------------------------------------------------------- |
| `src/research/types.ts`                     | Interfaces, mode defaults, output schema constant       |
| `src/research/prepare.ts`                   | Query/context file resolution, mode application         |
| `src/research/report.ts`                    | Findings report rendering (markdown/json)               |
| `src/providers/exa-deep-research.ts`        | `ExaDeepResearchClient` — Exa `/search` with deep types |
| `src/tools/web-research.ts`                 | Tool definition, schema, execute, render                |
| `src/config.ts`                             | Add `DeepResearchConfig` interface and defaults         |
| `src/config-manager.ts`                     | Expose deep research config                             |
| `src/index.ts`                              | Conditional tool registration                           |
| `tests/research/types.test.ts`              | Mode defaults tests                                     |
| `tests/research/prepare.test.ts`            | Input preparation tests                                 |
| `tests/research/report.test.ts`             | Report rendering tests                                  |
| `tests/providers/exa-deep-research.test.ts` | Client API tests                                        |
| `tests/tools/web-research.test.ts`          | Tool integration tests                                  |
| `tests/config-deep-research.test.ts`        | Config parsing tests                                    |

---

## Phase 1: Research Types and Interfaces

### Task 1: Research types module

**Files:**

- Create: `src/research/types.ts`
- Test: `tests/research/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/research/types.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  researchModeDefaults,
  defaultResearchOutputSchema,
  type ResearchMode,
  type ExaDeepType,
  type DeepResearchParams,
  type DeepResearchResult,
  type DeepResearchResponse,
  type ResearchModeDefaults,
} from "../../src/research/types.ts";

describe("researchModeDefaults", () => {
  it("has lite, standard, and full modes", () => {
    expect(Object.keys(researchModeDefaults).sort()).toEqual([
      "full",
      "lite",
      "standard",
    ]);
  });

  it("lite uses deep-lite type with 15 results", () => {
    const lite = researchModeDefaults.lite;
    expect(lite.type).toBe("deep-lite");
    expect(lite.numResults).toBe(15);
    expect(lite.textMaxCharacters).toBe(10000);
    expect(lite.highlightsMaxCharacters).toBe(600);
    expect(lite.highlightNumSentences).toBe(3);
    expect(lite.highlightsPerUrl).toBe(1);
    expect(lite.timeoutSeconds).toBe(300);
    expect(lite.outputSchema).toBeUndefined();
  });

  it("standard uses deep-reasoning type with 50 results and output schema", () => {
    const standard = researchModeDefaults.standard;
    expect(standard.type).toBe("deep-reasoning");
    expect(standard.numResults).toBe(50);
    expect(standard.textMaxCharacters).toBe(16000);
    expect(standard.highlightsMaxCharacters).toBe(900);
    expect(standard.highlightNumSentences).toBe(4);
    expect(standard.highlightsPerUrl).toBe(2);
    expect(standard.timeoutSeconds).toBe(600);
    expect(standard.outputSchema).toBeDefined();
  });

  it("full uses deep-reasoning type with 150 results and output schema", () => {
    const full = researchModeDefaults.full;
    expect(full.type).toBe("deep-reasoning");
    expect(full.numResults).toBe(150);
    expect(full.textMaxCharacters).toBe(24000);
    expect(full.highlightsMaxCharacters).toBe(1200);
    expect(full.highlightNumSentences).toBe(5);
    expect(full.highlightsPerUrl).toBe(3);
    expect(full.timeoutSeconds).toBe(1800);
    expect(full.outputSchema).toBeDefined();
  });
});

describe("defaultResearchOutputSchema", () => {
  it("has required fields", () => {
    expect(defaultResearchOutputSchema.required).toContain("executiveSummary");
    expect(defaultResearchOutputSchema.required).toContain("keyFindings");
    expect(defaultResearchOutputSchema.required).toContain("recommendation");
    expect(defaultResearchOutputSchema.required).toContain("risks");
    expect(defaultResearchOutputSchema.required).toContain("revisitConditions");
  });

  it("defines properties for all required fields", () => {
    for (const field of defaultResearchOutputSchema.required) {
      expect(defaultResearchOutputSchema.properties).toHaveProperty(field);
    }
  });

  it("includes optional tradeoffs property", () => {
    expect(defaultResearchOutputSchema.properties).toHaveProperty("tradeoffs");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/research/types.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/research/types.ts`:

```typescript
export type ExaDeepType = "deep-reasoning" | "deep-lite" | "deep";

export type ResearchMode = "lite" | "standard" | "full";

export type ReportFormat = "findings" | "markdown" | "json";

export interface DeepResearchParams {
  query: string;
  type: ExaDeepType;
  numResults?: number;
  textMaxCharacters?: number;
  highlightsMaxCharacters?: number;
  highlightNumSentences?: number;
  highlightsPerUrl?: number;
  summaryQuery?: string;
  maxAgeHours?: number;
  category?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  additionalQueries?: string[];
  systemPrompt?: string;
  outputSchema?: Record<string, unknown>;
}

export interface DeepResearchResult {
  title?: string;
  url?: string;
  text?: string;
  summary?: string;
  highlights?: string[];
  publishedDate?: string;
}

export interface DeepResearchResponse {
  answer?: string;
  results: DeepResearchResult[];
  raw: unknown;
  metadata: Record<string, unknown>;
}

export interface ResearchModeDefaults {
  type: ExaDeepType;
  numResults: number;
  textMaxCharacters: number;
  timeoutSeconds: number;
  highlightsMaxCharacters: number;
  highlightNumSentences: number;
  highlightsPerUrl: number;
  summaryQuery?: string;
  maxAgeHours?: number;
  category?: string;
  outputSchema?: Record<string, unknown>;
}

export const defaultResearchOutputSchema = {
  type: "object" as const,
  required: [
    "executiveSummary",
    "keyFindings",
    "recommendation",
    "risks",
    "revisitConditions",
  ],
  properties: {
    executiveSummary: {
      type: "string",
      description: "Concise source-grounded summary.",
    },
    keyFindings: {
      type: "array",
      items: { type: "string" },
      description: "Important findings with specifics.",
    },
    tradeoffs: {
      type: "array",
      items: { type: "string" },
      description: "Tradeoffs and alternatives.",
    },
    recommendation: {
      type: "string",
      description: "Recommended decision or criteria.",
    },
    risks: {
      type: "array",
      items: { type: "string" },
      description: "Known risks or uncertainties.",
    },
    revisitConditions: {
      type: "array",
      items: { type: "string" },
      description: "Conditions that trigger re-research.",
    },
  },
};

export const researchModeDefaults: Record<ResearchMode, ResearchModeDefaults> =
  {
    lite: {
      type: "deep-lite",
      numResults: 15,
      textMaxCharacters: 10000,
      timeoutSeconds: 300,
      highlightsMaxCharacters: 600,
      highlightNumSentences: 3,
      highlightsPerUrl: 1,
    },
    standard: {
      type: "deep-reasoning",
      numResults: 50,
      textMaxCharacters: 16000,
      timeoutSeconds: 600,
      highlightsMaxCharacters: 900,
      highlightNumSentences: 4,
      highlightsPerUrl: 2,
      summaryQuery:
        "Summarize the source evidence relevant to the research question, preserving concrete facts and tradeoffs.",
      outputSchema: defaultResearchOutputSchema,
    },
    full: {
      type: "deep-reasoning",
      numResults: 150,
      textMaxCharacters: 24000,
      timeoutSeconds: 1800,
      highlightsMaxCharacters: 1200,
      highlightNumSentences: 5,
      highlightsPerUrl: 3,
      summaryQuery:
        "Summarize the source evidence relevant to the research question, emphasizing decision criteria, tradeoffs, risks, and revisit triggers.",
      outputSchema: defaultResearchOutputSchema,
    },
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/research/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/research/types.ts tests/research/types.test.ts
git commit -m "feat(research): add types and mode defaults"
```

---

## Phase 2: Exa Deep Research Client

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

---

## Phase 3: Input Preparation

### Task 3: Prepare research input

**Files:**

- Create: `src/research/prepare.ts`
- Test: `tests/research/prepare.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/research/prepare.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import {
  prepareResearchInput,
  applyResearchMode,
  resolveOutputPath,
  expandSimpleGlob,
  MAX_CONTEXT_FILES,
} from "../../src/research/prepare.ts";
import { researchModeDefaults } from "../../src/research/types.ts";

vi.mock("node:fs/promises");

describe("resolveOutputPath", () => {
  it("resolves relative path against cwd", () => {
    expect(resolveOutputPath("/project", "findings.md")).toMatch(
      /\/project\/findings.md$/,
    );
  });

  it("returns absolute path unchanged", () => {
    expect(resolveOutputPath("/project", "/tmp/out.md")).toBe("/tmp/out.md");
  });

  it("strips leading @ from path", () => {
    expect(resolveOutputPath("/project", "@docs/out.md")).toMatch(
      /\/project\/docs\/out.md$/,
    );
  });
});

describe("applyResearchMode", () => {
  it("returns lite defaults for lite mode", () => {
    const result = applyResearchMode({ researchMode: "lite" });
    expect(result.type).toBe("deep-lite");
    expect(result.numResults).toBe(15);
    expect(result.textMaxCharacters).toBe(10000);
    expect(result.timeoutSeconds).toBe(300);
  });

  it("returns standard defaults for standard mode", () => {
    const result = applyResearchMode({ researchMode: "standard" });
    expect(result.type).toBe("deep-reasoning");
    expect(result.numResults).toBe(50);
    expect(result.outputSchema).toBeDefined();
  });

  it("defaults to standard when researchMode not specified", () => {
    const result = applyResearchMode({});
    expect(result.type).toBe("deep-reasoning");
    expect(result.numResults).toBe(50);
  });

  it("per-call params override mode defaults", () => {
    const result = applyResearchMode({
      researchMode: "standard",
      numResults: 30,
      textMaxCharacters: 8000,
      type: "deep-lite",
    });
    expect(result.type).toBe("deep-lite");
    expect(result.numResults).toBe(30);
    expect(result.textMaxCharacters).toBe(8000);
  });

  it("config modeDefaults override built-in defaults", () => {
    const configDefaults = {
      standard: { numResults: 60, textMaxCharacters: 20000 },
    };
    const result = applyResearchMode(
      { researchMode: "standard" },
      configDefaults,
    );
    expect(result.numResults).toBe(60);
    expect(result.textMaxCharacters).toBe(20000);
  });

  it("per-call params override config modeDefaults", () => {
    const configDefaults = { standard: { numResults: 60 } };
    const result = applyResearchMode(
      { researchMode: "standard", numResults: 25 },
      configDefaults,
    );
    expect(result.numResults).toBe(25);
  });

  it("throws on invalid research mode", () => {
    expect(() => applyResearchMode({ researchMode: "invalid" as any })).toThrow(
      /invalid/i,
    );
  });
});

describe("expandSimpleGlob", () => {
  it("returns single path when no wildcard", async () => {
    const result = await expandSimpleGlob("/project", "docs/file.md");
    expect(result).toEqual(["/project/docs/file.md"]);
  });

  it("expands wildcard in filename", async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: "context-01.md", isFile: () => true },
      { name: "context-02.md", isFile: () => true },
      { name: "other.txt", isFile: () => true },
    ] as any);
    const result = await expandSimpleGlob("/project", "docs/context-*.md");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatch(/context-01\.md$/);
    expect(result[1]).toMatch(/context-02\.md$/);
  });

  it("throws when glob matches exceed limit", async () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      name: `file-${i}.md`,
      isFile: () => true,
    }));
    vi.mocked(fs.readdir).mockResolvedValue(entries as any);
    await expect(
      expandSimpleGlob("/project", "docs/file-*.md"),
    ).rejects.toThrow(/limit/);
  });

  it("throws on multiple wildcards", async () => {
    await expect(expandSimpleGlob("/project", "docs/*/*.md")).rejects.toThrow(
      /one '\*' wildcard/,
    );
  });
});

describe("prepareResearchInput", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses query directly when provided", async () => {
    const result = await prepareResearchInput("/project", {
      query: "What is X?",
    });
    expect(result.query).toBe("What is X?");
  });

  it("reads query from queryFile", async () => {
    vi.mocked(fs.readFile).mockResolvedValue("Question from file");
    const result = await prepareResearchInput("/project", {
      queryFile: "question.txt",
    });
    expect(result.query).toBe("Question from file");
  });

  it("throws when neither query nor queryFile provided", async () => {
    await expect(prepareResearchInput("/project", {})).rejects.toThrow(
      /requires query or queryFile/,
    );
  });

  it("appends context files to system prompt", async () => {
    vi.mocked(fs.readFile).mockImplementation(async (path) => {
      if (String(path).includes("question")) return "My question";
      return "Context content here";
    });
    const result = await prepareResearchInput("/project", {
      query: "test",
      contextFiles: ["context.md"],
    });
    expect(result.systemPrompt).toContain("Context content here");
    expect(result.systemPrompt).toContain("---");
  });

  it("uses default system prompt when no custom one provided", async () => {
    const result = await prepareResearchInput("/project", { query: "test" });
    expect(result.systemPrompt).toContain("evidence-backed");
  });

  it("uses custom system prompt when provided", async () => {
    const result = await prepareResearchInput("/project", {
      query: "test",
      systemPrompt: "Custom instructions",
    });
    expect(result.systemPrompt).toBe("Custom instructions");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/research/prepare.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/research/prepare.ts`:

```typescript
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  researchModeDefaults,
  type ResearchMode,
  type ResearchModeDefaults,
} from "./types.ts";

export const MAX_CONTEXT_FILES = 25;

export interface WebResearchInput {
  query?: string;
  queryFile?: string;
  contextFiles?: string[];
  contextGlob?: string;
  researchMode?: ResearchMode;
  type?: string;
  systemPrompt?: string;
  additionalQueries?: string[];
  numResults?: number;
  textMaxCharacters?: number;
  highlightsMaxCharacters?: number;
  highlightNumSentences?: number;
  highlightsPerUrl?: number;
  summaryQuery?: string;
  maxAgeHours?: number;
  category?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  outputSchema?: Record<string, unknown>;
  outputPath?: string;
  reportTitle?: string;
  reportFormat?: string;
  rawOutputPath?: string;
}

type ModeDefaultOverrides = Partial<
  Record<ResearchMode, Partial<ResearchModeDefaults>>
>;

function cleanPath(p: string): string {
  return p.startsWith("@") ? p.slice(1) : p;
}

export function resolveOutputPath(cwd: string, rawPath: string): string {
  const cleaned = cleanPath(rawPath.trim());
  return isAbsolute(cleaned) ? cleaned : resolve(cwd, cleaned);
}

export async function expandSimpleGlob(
  cwd: string,
  rawGlob: string,
  limit = MAX_CONTEXT_FILES,
): Promise<string[]> {
  const cleaned = cleanPath(rawGlob.trim());
  if (!cleaned.includes("*")) return [resolveOutputPath(cwd, cleaned)];

  const normalized = cleaned.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const dirPart = slash >= 0 ? normalized.slice(0, slash) : ".";
  const basePattern = slash >= 0 ? normalized.slice(slash + 1) : normalized;

  if (basePattern.split("*").length > 2) {
    throw new Error(
      `contextGlob supports one '*' wildcard in the file name: ${rawGlob}`,
    );
  }

  const [prefix, suffix] = basePattern.split("*") as [string, string];
  const dir = resolveOutputPath(cwd, dirPart);
  const entries = await readdir(dir, { withFileTypes: true });
  const matches = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(prefix) &&
        entry.name.endsWith(suffix),
    )
    .map((entry) => join(dir, entry.name))
    .sort();

  if (matches.length > limit) {
    throw new Error(
      `contextGlob matched ${matches.length} files; limit is ${limit}: ${rawGlob}`,
    );
  }
  return matches;
}

export function applyResearchMode(
  input: Pick<
    WebResearchInput,
    | "researchMode"
    | "type"
    | "numResults"
    | "textMaxCharacters"
    | "highlightsMaxCharacters"
    | "highlightNumSentences"
    | "highlightsPerUrl"
    | "summaryQuery"
    | "maxAgeHours"
    | "category"
    | "outputSchema"
  >,
  configDefaults?: ModeDefaultOverrides,
) {
  const researchMode: ResearchMode =
    (input.researchMode as ResearchMode) ?? "standard";
  const defaults = researchModeDefaults[researchMode];
  if (!defaults) {
    throw new Error(
      `Invalid researchMode '${researchMode}'. Expected one of: lite, standard, full.`,
    );
  }
  const profile = configDefaults?.[researchMode] ?? {};

  return {
    researchMode,
    type: input.type ?? profile.type ?? defaults.type,
    numResults: input.numResults ?? profile.numResults ?? defaults.numResults,
    textMaxCharacters:
      input.textMaxCharacters ??
      profile.textMaxCharacters ??
      defaults.textMaxCharacters,
    timeoutSeconds: profile.timeoutSeconds ?? defaults.timeoutSeconds,
    highlightsMaxCharacters:
      input.highlightsMaxCharacters ??
      profile.highlightsMaxCharacters ??
      defaults.highlightsMaxCharacters,
    highlightNumSentences:
      input.highlightNumSentences ??
      profile.highlightNumSentences ??
      defaults.highlightNumSentences,
    highlightsPerUrl:
      input.highlightsPerUrl ??
      profile.highlightsPerUrl ??
      defaults.highlightsPerUrl,
    summaryQuery:
      input.summaryQuery ?? profile.summaryQuery ?? defaults.summaryQuery,
    maxAgeHours:
      input.maxAgeHours ?? profile.maxAgeHours ?? defaults.maxAgeHours,
    category: input.category ?? profile.category ?? defaults.category,
    outputSchema:
      input.outputSchema ?? profile.outputSchema ?? defaults.outputSchema,
  };
}

async function resolveContextPaths(
  cwd: string,
  params: WebResearchInput,
): Promise<string[]> {
  const explicit = (params.contextFiles ?? []).map((p) =>
    resolveOutputPath(cwd, p),
  );
  const globbed = params.contextGlob
    ? await expandSimpleGlob(cwd, params.contextGlob)
    : [];
  return Array.from(new Set([...explicit, ...globbed])).sort();
}

const DEFAULT_SYSTEM_PROMPT =
  "You are producing an evidence-backed research findings report. Prioritize primary sources, current documentation, tradeoffs, risks, and concrete revisit conditions. Include source URLs for material claims when Exa returns citations.";

export async function prepareResearchInput(
  cwd: string,
  params: WebResearchInput,
): Promise<WebResearchInput & { query: string; systemPrompt: string }> {
  let query = params.query?.trim() ?? "";
  if (params.queryFile) {
    query = (
      await readFile(resolveOutputPath(cwd, params.queryFile), "utf8")
    ).trim();
  }
  if (!query) throw new Error("web_research requires query or queryFile.");

  const contextPaths = await resolveContextPaths(cwd, params);
  const contextParts: string[] = [];
  for (const p of contextPaths) {
    contextParts.push(`Context from ${p}:\n${await readFile(p, "utf8")}`);
  }

  const basePrompt = params.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
  const systemPrompt = contextParts.length
    ? [basePrompt, ...contextParts].join("\n\n---\n\n")
    : basePrompt;

  return { ...params, query, systemPrompt };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/research/prepare.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/research/prepare.ts tests/research/prepare.test.ts
git commit -m "feat(research): add input preparation and mode resolution"
```

---

## Phase 4: Report Rendering

### Task 4: Findings report renderer

**Files:**

- Create: `src/research/report.ts`
- Test: `tests/research/report.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/research/report.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  renderFindingsReport,
  defaultRawOutputPath,
  buildRawSidecar,
} from "../../src/research/report.ts";
import type { DeepResearchResponse } from "../../src/research/types.ts";

describe("defaultRawOutputPath", () => {
  it("replaces extension with .raw.json", () => {
    expect(defaultRawOutputPath("/out/findings.md")).toBe(
      "/out/findings.raw.json",
    );
  });

  it("appends .raw.json when no extension", () => {
    expect(defaultRawOutputPath("/out/findings")).toBe(
      "/out/findings.raw.json",
    );
  });
});

describe("buildRawSidecar", () => {
  it("includes metadata and raw response", () => {
    const response: DeepResearchResponse = {
      answer: "test",
      results: [],
      raw: { foo: "bar" },
      metadata: { researchMode: "standard", type: "deep-reasoning" },
    };
    const sidecar = buildRawSidecar(response, "/out/findings.raw.json");
    expect(sidecar.metadata.researchMode).toBe("standard");
    expect(sidecar.metadata.rawOutputPath).toBe("/out/findings.raw.json");
    expect(sidecar.raw).toEqual({ foo: "bar" });
  });
});

describe("renderFindingsReport", () => {
  const baseResponse: DeepResearchResponse = {
    answer: "This is the executive summary.",
    results: [
      {
        title: "Source One",
        url: "https://example.com/1",
        text: "Full text from source one",
        summary: "Source one summary",
        highlights: ["Key highlight"],
        publishedDate: "2025-06-15",
      },
      {
        title: "Source Two",
        url: "https://example.com/2",
        text: "Full text from source two",
      },
    ],
    raw: {},
    metadata: {
      researchMode: "standard",
      type: "deep-reasoning",
      queryCount: 1,
      sourceCount: 2,
      uniqueSourceCount: 2,
    },
  };

  it("includes research question", () => {
    const report = renderFindingsReport({ query: "What is X?" }, baseResponse);
    expect(report).toContain("## Research Question");
    expect(report).toContain("What is X?");
  });

  it("includes executive summary from answer", () => {
    const report = renderFindingsReport({ query: "test" }, baseResponse);
    expect(report).toContain("## Executive Summary");
    expect(report).toContain("This is the executive summary.");
  });

  it("includes evidence and sources section", () => {
    const report = renderFindingsReport({ query: "test" }, baseResponse);
    expect(report).toContain("## Evidence and Sources");
    expect(report).toContain("Source One");
    expect(report).toContain("https://example.com/1");
    expect(report).toContain("2025-06-15");
  });

  it("includes metadata section", () => {
    const report = renderFindingsReport({ query: "test" }, baseResponse);
    expect(report).toContain("## Research Metadata");
    expect(report).toContain("Mode: standard");
    expect(report).toContain("deep-reasoning");
  });

  it("uses reportTitle for heading when provided", () => {
    const report = renderFindingsReport(
      { query: "test", reportTitle: "Custom Title" },
      baseResponse,
    );
    expect(report).toContain("# Findings: Custom Title");
  });

  it("falls back to query for heading", () => {
    const report = renderFindingsReport({ query: "What is X?" }, baseResponse);
    expect(report).toContain("# Findings: What is X?");
  });

  it("renders structured output when present in raw", () => {
    const structured: DeepResearchResponse = {
      ...baseResponse,
      raw: {
        output: {
          content: {
            executiveSummary: "Structured summary",
            keyFindings: ["Finding A", "Finding B"],
            tradeoffs: ["Tradeoff 1"],
            recommendation: "Do X",
            risks: ["Risk 1"],
            revisitConditions: ["Condition 1"],
          },
        },
      },
    };
    const report = renderFindingsReport({ query: "test" }, structured);
    expect(report).toContain("Structured summary");
    expect(report).toContain("Finding A");
    expect(report).toContain("Finding B");
    expect(report).toContain("Do X");
    expect(report).toContain("Risk 1");
    expect(report).toContain("Condition 1");
  });

  it("handles response with no answer gracefully", () => {
    const noAnswer: DeepResearchResponse = {
      ...baseResponse,
      answer: undefined,
    };
    const report = renderFindingsReport({ query: "test" }, noAnswer);
    expect(report).toContain("## Executive Summary");
    expect(report).toContain("Source One"); // falls back to source clusters
  });

  it("includes rawOutputPath in metadata when provided", () => {
    const report = renderFindingsReport({ query: "test" }, baseResponse, {
      rawOutputPath: "./out.raw.json",
    });
    expect(report).toContain("out.raw.json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/research/report.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/research/report.ts`:

````typescript
import { extname } from "node:path";
import type { DeepResearchResponse } from "./types.ts";
import type { WebResearchInput } from "./prepare.ts";

export function defaultRawOutputPath(outputPath: string): string {
  const ext = extname(outputPath);
  return ext
    ? `${outputPath.slice(0, -ext.length)}.raw.json`
    : `${outputPath}.raw.json`;
}

export interface RawResearchSidecar {
  metadata: Record<string, unknown> & { rawOutputPath?: string };
  raw: unknown;
}

export function buildRawSidecar(
  response: DeepResearchResponse,
  rawOutputPath?: string,
): RawResearchSidecar {
  return {
    metadata: { ...response.metadata, rawOutputPath },
    raw: response.raw,
  };
}

function structuredOutputContent(
  response: DeepResearchResponse,
): Record<string, unknown> | undefined {
  const raw: any = response.raw;
  if (
    raw?.output?.content &&
    typeof raw.output.content === "object" &&
    !Array.isArray(raw.output.content)
  ) {
    return raw.output.content;
  }
  return undefined;
}

function sanitizeText(value: string): string {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/g, "")
        .replace(/^\s{0,3}>\s*/g, "")
        .replace(/^\s*```.*$/g, "")
        .trim(),
    )
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function oneLine(value: string, max = 260): string {
  const cleaned = sanitizeText(value);
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function resultSnippet(
  result: DeepResearchResponse["results"][number],
  max = 900,
): string {
  return oneLine(
    [result.summary, ...(result.highlights ?? []), result.text]
      .filter(Boolean)
      .join(" "),
    max,
  );
}

function listMarkdown(value: unknown, fallback: string): string {
  if (Array.isArray(value) && value.length) {
    return value
      .map(
        (item) =>
          `- ${sanitizeText(typeof item === "string" ? item : JSON.stringify(item))}`,
      )
      .join("\n");
  }
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

function isGenericNoAnswer(value: string | undefined): boolean {
  return (
    !value?.trim() ||
    /Exa returned (sources|\d+ sources) but no synthesized answer/i.test(value)
  );
}

function fallbackSummary(response: DeepResearchResponse): string {
  if (!isGenericNoAnswer(response.answer)) return response.answer!.trim();
  if (response.results.length === 0)
    return "No sources were returned. Re-run with broader terms or fewer filters.";
  const themes = response.results
    .slice(0, 5)
    .map((r, i) => `(${i + 1}) ${r.title ?? r.url ?? "Untitled"}`)
    .join("; ");
  return `Exa returned ${response.results.length} sources but no synthesized answer. Source clusters: ${themes}. Validate recommendations against primary sources.`;
}

function keyFindings(response: DeepResearchResponse): string {
  if (!isGenericNoAnswer(response.answer)) return response.answer!.trim();
  if (response.results.length === 0)
    return "- No source-backed findings were returned.";
  return response.results
    .slice(0, 8)
    .map(
      (r, i) =>
        `- [${i + 1}] ${r.title ?? r.url ?? "Untitled"}: ${resultSnippet(r, 260) || "Review source directly."}`,
    )
    .join("\n");
}

function bulletSources(response: DeepResearchResponse): string {
  if (response.results.length === 0) return "- No source URLs returned by Exa.";
  return response.results
    .map(
      (r, i) =>
        `- [${i + 1}] ${r.title ?? r.url ?? "Untitled"}${r.url ? ` — ${r.url}` : ""}${r.publishedDate ? ` (${r.publishedDate})` : ""}`,
    )
    .join("\n");
}

export function renderFindingsReport(
  input: Pick<WebResearchInput, "query" | "reportTitle">,
  response: DeepResearchResponse,
  options: { rawOutputPath?: string } = {},
): string {
  const title = input.reportTitle || input.query;
  const structured = structuredOutputContent(response);

  const answer =
    typeof structured?.executiveSummary === "string"
      ? structured.executiveSummary.trim()
      : fallbackSummary(response);

  const findings = structured
    ? listMarkdown(
        structured.keyFindings ?? structured.findings,
        keyFindings(response),
      )
    : keyFindings(response);

  const tradeoffs = structured
    ? listMarkdown(
        structured.tradeoffs,
        "- Compare benefits against implementation cost and project constraints.",
      )
    : "- Compare benefits against implementation cost and project constraints.";

  const recommendation =
    typeof structured?.recommendation === "string" &&
    structured.recommendation.trim()
      ? structured.recommendation.trim()
      : answer;

  const risks = structured
    ? listMarkdown(
        structured.risks,
        "- Verify source freshness and applicability.\n- Treat uncited claims as hypotheses.",
      )
    : "- Verify source freshness and applicability.\n- Treat uncited claims as hypotheses.";

  const revisit = structured
    ? listMarkdown(
        structured.revisitConditions,
        "- New primary-source documentation contradicts findings.\n- Implementation constraints differ from research context.",
      )
    : "- New primary-source documentation contradicts findings.\n- Implementation constraints differ from research context.";

  const evidence = response.results
    .map((r, i) => {
      const snippet = sanitizeText(resultSnippet(r, 1200))
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      return `### [${i + 1}] ${r.title ?? r.url ?? "Untitled"}\n\n${r.url ?? ""}\n\n${snippet || "> No snippet returned."}`;
    })
    .join("\n\n");

  const metadata = [
    `- Mode: ${response.metadata.researchMode ?? "standard"}`,
    `- Exa type: ${response.metadata.type ?? "deep-reasoning"}`,
    `- Queries: ${response.metadata.queryCount ?? 1}`,
    `- Sources: ${response.metadata.uniqueSourceCount ?? response.results.length} unique${response.metadata.sourceCount && response.metadata.sourceCount !== response.results.length ? ` (${response.metadata.sourceCount} returned before dedupe)` : ""}`,
    options.rawOutputPath
      ? `- Raw metadata sidecar: ${options.rawOutputPath}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");

  return `# Findings: ${title}\n\n## Research Question\n\n${input.query}\n\n## Executive Summary\n\n${answer}\n\n## Key Findings\n\n${findings}\n\n## Evidence and Sources\n\n${bulletSources(response)}\n\n${evidence}\n\n## Tradeoffs / Alternatives\n\n${tradeoffs}\n\n## Recommendation / Decision Criteria\n\n${recommendation}\n\n## Risks / Unknowns\n\n${risks}\n\n## Revisit Conditions\n\n${revisit}\n\n## Research Metadata\n\n${metadata}\n`;
}
````

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/research/report.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/research/report.ts tests/research/report.test.ts
git commit -m "feat(research): add findings report renderer"
```

---

## Phase 5: Config Integration

### Task 5: Add DeepResearchConfig to config system

**Files:**

- Modify: `src/config.ts`
- Test: `tests/config-deep-research.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/config-deep-research.test.ts`:

```typescript
import * as fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.ts";
import type { DeepResearchConfig } from "../src/config.ts";

vi.mock("node:fs");

describe("DeepResearchConfig loading", () => {
  it("returns default deepResearch config when not in file", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));
    const config = loadConfig();
    expect(config.deepResearch).toEqual({ enabled: true });
  });

  it("parses deepResearch.enabled = false", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ deepResearch: { enabled: false } }),
    );
    const config = loadConfig();
    expect(config.deepResearch.enabled).toBe(false);
  });

  it("parses modeDefaults overrides", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        deepResearch: {
          enabled: true,
          modeDefaults: {
            standard: { numResults: 60, textMaxCharacters: 20000 },
          },
        },
      }),
    );
    const config = loadConfig();
    expect(config.deepResearch.modeDefaults?.standard?.numResults).toBe(60);
    expect(config.deepResearch.modeDefaults?.standard?.textMaxCharacters).toBe(
      20000,
    );
  });

  it("parses outputSchema override", () => {
    const schema = {
      type: "object",
      properties: { summary: { type: "string" } },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ deepResearch: { outputSchema: schema } }),
    );
    const config = loadConfig();
    expect(config.deepResearch.outputSchema).toEqual(schema);
  });

  it("parses guidance override", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        deepResearch: { guidance: { promptSnippet: "Custom snippet" } },
      }),
    );
    const config = loadConfig();
    expect(config.deepResearch.guidance?.promptSnippet).toBe("Custom snippet");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/config-deep-research.test.ts`
Expected: FAIL — `DeepResearchConfig` not exported from config

- [ ] **Step 3: Add DeepResearchConfig to config.ts**

Add the following interface after `CombineConfig` (around line 38):

```typescript
export interface DeepResearchConfig {
  enabled: boolean;
  modeDefaults?: Partial<
    Record<
      string,
      Partial<{
        type: string;
        numResults: number;
        textMaxCharacters: number;
        timeoutSeconds: number;
        highlightsMaxCharacters: number;
        highlightNumSentences: number;
        highlightsPerUrl: number;
        summaryQuery: string;
        maxAgeHours: number;
        category: string;
        outputSchema: Record<string, unknown>;
      }>
    >
  >;
  outputSchema?: Record<string, unknown> | null;
  guidance?: GuidanceOverride;
}
```

Add `deepResearch: DeepResearchConfig;` to the `PiToolsConfig` interface.

Add default:

```typescript
export const DEFAULT_DEEP_RESEARCH_CONFIG: DeepResearchConfig = {
  enabled: true,
};
```

Add `deepResearch: DEFAULT_DEEP_RESEARCH_CONFIG` to the `DEFAULT_CONFIG` object.

In `parseConfigFile`, add deep research parsing:

```typescript
deepResearch: validateDeepResearchConfig(parsed.deepResearch),
```

Add the validator:

```typescript
function validateDeepResearchConfig(parsed: unknown): DeepResearchConfig {
  if (!parsed || typeof parsed !== "object")
    return { ...DEFAULT_DEEP_RESEARCH_CONFIG };
  const raw = parsed as Record<string, unknown>;
  return {
    enabled:
      typeof raw.enabled === "boolean"
        ? raw.enabled
        : DEFAULT_DEEP_RESEARCH_CONFIG.enabled,
    modeDefaults:
      raw.modeDefaults && typeof raw.modeDefaults === "object"
        ? (raw.modeDefaults as DeepResearchConfig["modeDefaults"])
        : undefined,
    outputSchema:
      raw.outputSchema && typeof raw.outputSchema === "object"
        ? (raw.outputSchema as Record<string, unknown>)
        : undefined,
    guidance:
      raw.guidance && typeof raw.guidance === "object"
        ? (raw.guidance as GuidanceOverride)
        : undefined,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/config-deep-research.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to ensure no regressions**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/config.ts tests/config-deep-research.test.ts
git commit -m "feat(config): add deepResearch config section"
```

---

## Phase 6: Tool Definition

### Task 6: web_research tool

**Files:**

- Create: `src/tools/web-research.ts`
- Test: `tests/tools/web-research.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tools/web-research.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebResearchTool } from "../../src/tools/web-research.ts";
import { stubFetch } from "../helpers.ts";
import { makeCtx } from "../helpers.ts";
import * as fsPromises from "node:fs/promises";

vi.mock("node:fs/promises");
// Mock withFileMutationQueue to just run the callback
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    withFileMutationQueue: async (_path: string, fn: () => Promise<void>) =>
      fn(),
  };
});

describe("createWebResearchTool", () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  const appendEntry = vi.fn();

  beforeEach(() => {
    fetchStub = stubFetch();
    vi.mocked(fsPromises.readFile).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);
  });
  afterEach(() => {
    fetchStub.restore();
    vi.restoreAllMocks();
  });

  function makeTool() {
    return createWebResearchTool(
      "test-exa-key",
      { enabled: true },
      appendEntry,
    );
  }

  it("has correct name and description", () => {
    const tool = makeTool();
    expect(tool.name).toBe("web_research");
    expect(tool.label).toBe("Web Research");
  });

  it("executes research and returns inline report when no outputPath", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: {
        results: [
          { title: "Source", url: "https://example.com", text: "content" },
        ],
        answer: "The answer is X.",
      },
    });

    const tool = makeTool();
    const result = await tool.execute(
      "call-1",
      { query: "What is X?" },
      undefined,
      vi.fn(),
      makeCtx(),
    );
    const text =
      result.content[0] && "text" in result.content[0]
        ? result.content[0].text
        : "";
    expect(text).toContain("Findings:");
    expect(text).toContain("The answer is X.");
  });

  it("writes report to outputPath when specified", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [], answer: "Answer" },
    });

    const tool = makeTool();
    await tool.execute(
      "call-2",
      { query: "test", outputPath: "findings.md" },
      undefined,
      vi.fn(),
      makeCtx(),
    );

    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalled();
    const writeCall = vi.mocked(fsPromises.writeFile).mock.calls[0];
    expect(String(writeCall[0])).toContain("findings.md");
  });

  it("writes raw sidecar for findings format", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [], answer: "Answer" },
    });

    const tool = makeTool();
    await tool.execute(
      "call-3",
      { query: "test", outputPath: "findings.md", reportFormat: "findings" },
      undefined,
      vi.fn(),
      makeCtx(),
    );

    const writeCalls = vi.mocked(fsPromises.writeFile).mock.calls;
    expect(writeCalls.length).toBe(2); // report + sidecar
    const sidecarPath = String(writeCalls[1][0]);
    expect(sidecarPath).toContain("findings.raw.json");
  });

  it("does not write raw sidecar for json format", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [], answer: "Answer" },
    });

    const tool = makeTool();
    await tool.execute(
      "call-4",
      { query: "test", outputPath: "out.json", reportFormat: "json" },
      undefined,
      vi.fn(),
      makeCtx(),
    );

    const writeCalls = vi.mocked(fsPromises.writeFile).mock.calls;
    expect(writeCalls.length).toBe(1); // report only
  });

  it("calls appendEntry with research metadata", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: {
        results: [{ title: "A", url: "https://a.com", text: "text" }],
        answer: "Answer",
      },
    });

    const tool = makeTool();
    await tool.execute(
      "call-5",
      { query: "test" },
      undefined,
      vi.fn(),
      makeCtx(),
    );

    expect(appendEntry).toHaveBeenCalledWith(
      "pi-tools-research",
      expect.objectContaining({
        query: "test",
        sourceCount: 1,
      }),
    );
  });

  it("throws when deepResearch is disabled", () => {
    const tool = createWebResearchTool("key", { enabled: false }, appendEntry);
    expect(
      tool.execute("call-6", { query: "test" }, undefined, vi.fn(), makeCtx()),
    ).rejects.toThrow(/disabled/);
  });

  it("throws when query is missing", () => {
    const tool = makeTool();
    expect(
      tool.execute("call-7", {}, undefined, vi.fn(), makeCtx()),
    ).rejects.toThrow(/requires query/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/tools/web-research.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/tools/web-research.ts`:

```typescript
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, isAbsolute } from "node:path";
import { Type } from "typebox";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { ExaDeepResearchClient } from "../providers/exa-deep-research.ts";
import type { DeepResearchConfig, GuidanceOverride } from "../config.ts";
import type { AppendEntryFn } from "../storage.ts";
import type {
  ExaDeepType,
  ReportFormat,
  ResearchMode,
} from "../research/types.ts";
import {
  applyResearchMode,
  prepareResearchInput,
  resolveOutputPath,
} from "../research/prepare.ts";
import {
  buildRawSidecar,
  defaultRawOutputPath,
  renderFindingsReport,
} from "../research/report.ts";

const researchModes = ["lite", "standard", "full"] as const;
const reportFormats = ["findings", "markdown", "json"] as const;

const WebResearchParams = Type.Object({
  query: Type.Optional(
    Type.String({
      description: "Research question to investigate with Exa Deep Search.",
    }),
  ),
  queryFile: Type.Optional(
    Type.String({
      description: "Path to a file containing the research question.",
    }),
  ),
  contextFiles: Type.Optional(
    Type.Array(Type.String(), {
      description: "Context files to append to system prompt.",
    }),
  ),
  contextGlob: Type.Optional(
    Type.String({
      description: "Simple glob for context files (one * in filename).",
    }),
  ),
  researchMode: Type.Optional(
    Type.Union(
      researchModes.map((m) => Type.Literal(m)),
      { description: "Research depth: lite, standard (default), or full." },
    ),
  ),
  type: Type.Optional(
    Type.String({
      description:
        "Override Exa deep type: deep-reasoning, deep-lite, or deep.",
    }),
  ),
  systemPrompt: Type.Optional(
    Type.String({
      description: "Override the default research system prompt.",
    }),
  ),
  additionalQueries: Type.Optional(
    Type.Array(Type.String(), { description: "Extra queries for full mode." }),
  ),
  numResults: Type.Optional(
    Type.Number({ description: "Number of source results." }),
  ),
  textMaxCharacters: Type.Optional(
    Type.Number({ description: "Max text characters per source." }),
  ),
  highlightsMaxCharacters: Type.Optional(
    Type.Number({ description: "Max highlight characters." }),
  ),
  highlightNumSentences: Type.Optional(
    Type.Number({ description: "Sentences per highlight." }),
  ),
  highlightsPerUrl: Type.Optional(
    Type.Number({ description: "Highlights per URL." }),
  ),
  summaryQuery: Type.Optional(
    Type.String({ description: "Summary query for Exa." }),
  ),
  maxAgeHours: Type.Optional(
    Type.Number({ description: "Max age of sources in hours." }),
  ),
  category: Type.Optional(
    Type.String({ description: "Exa content category filter." }),
  ),
  includeDomains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Only include results from these domains.",
    }),
  ),
  excludeDomains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Exclude results from these domains.",
    }),
  ),
  startPublishedDate: Type.Optional(
    Type.String({
      description: "Only sources published after this date (ISO 8601).",
    }),
  ),
  endPublishedDate: Type.Optional(
    Type.String({
      description: "Only sources published before this date (ISO 8601).",
    }),
  ),
  outputSchema: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: "Custom structured output schema.",
    }),
  ),
  outputPath: Type.Optional(
    Type.String({ description: "Path to write findings report." }),
  ),
  reportTitle: Type.Optional(
    Type.String({ description: "Custom title for the findings report." }),
  ),
  reportFormat: Type.Optional(
    Type.Union(
      reportFormats.map((f) => Type.Literal(f)),
      { description: "Report format: findings (default), markdown, or json." },
    ),
  ),
  rawOutputPath: Type.Optional(
    Type.String({ description: "Path for raw metadata sidecar." }),
  ),
});

interface WebResearchDetails {
  outputPath?: string;
  rawOutputPath?: string;
  sourceCount: number;
  metadata: Record<string, unknown>;
}

async function writeQueued(path: string, content: string): Promise<void> {
  await withFileMutationQueue(path, async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  });
}

function displayPath(cwd: string | undefined, filePath: string): string {
  if (!cwd) return filePath;
  const rel = relative(cwd, filePath);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : filePath;
}

export function createWebResearchTool(
  exaApiKey: string,
  deepResearchConfig: DeepResearchConfig,
  appendEntry: AppendEntryFn,
  guidance?: GuidanceOverride,
): ToolDefinition<typeof WebResearchParams, WebResearchDetails> {
  return {
    name: "web_research",
    label: "Web Research",
    description:
      "Run Exa Deep Search and optionally write a findings report. Requires EXA_API_KEY.",
    promptSnippet:
      guidance?.promptSnippet ??
      "Run Exa deep research for evidence-backed findings reports. Pass outputPath to save results to disk.",
    promptGuidelines: guidance?.promptGuidelines ?? [
      "Use web_research for multi-source research that needs structured findings reports.",
      "Choose researchMode based on depth: lite (quick, 5min), standard (default, 10min), full (thorough, 30min).",
      "Pass outputPath when the user asks for a saved report or findings file.",
    ],
    parameters: WebResearchParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!deepResearchConfig.enabled) {
        throw new Error(
          "web_research is disabled via deepResearch.enabled config.",
        );
      }

      const cwd = ctx.cwd;
      const prepared = await prepareResearchInput(cwd, params);
      const mode = applyResearchMode(prepared, deepResearchConfig.modeDefaults);

      const client = new ExaDeepResearchClient(exaApiKey);

      // Build query list: full mode runs multiple queries with deduplication
      const queryList =
        mode.researchMode === "full"
          ? [prepared.query, ...(prepared.additionalQueries ?? [])]
              .map((q) => q.trim())
              .filter(Boolean)
          : [prepared.query];
      const uniqueQueries = Array.from(new Set(queryList));

      // Execute research queries
      const responses = [];
      for (const query of uniqueQueries) {
        responses.push(
          await client.deepResearch(
            {
              query,
              type: mode.type as ExaDeepType,
              numResults: mode.numResults,
              textMaxCharacters: mode.textMaxCharacters,
              highlightsMaxCharacters: mode.highlightsMaxCharacters,
              highlightNumSentences: mode.highlightNumSentences,
              highlightsPerUrl: mode.highlightsPerUrl,
              summaryQuery: mode.summaryQuery,
              maxAgeHours: mode.maxAgeHours,
              category: mode.category,
              includeDomains: prepared.includeDomains,
              excludeDomains: prepared.excludeDomains,
              startPublishedDate: prepared.startPublishedDate,
              endPublishedDate: prepared.endPublishedDate,
              additionalQueries:
                mode.researchMode === "full"
                  ? undefined
                  : prepared.additionalQueries,
              systemPrompt: prepared.systemPrompt,
              outputSchema: mode.outputSchema,
            },
            signal ?? undefined,
          ),
        );
      }

      // Deduplicate results across queries
      const seen = new Set<string>();
      const uniqueResults = [];
      let sourceCount = 0;
      for (const resp of responses) {
        sourceCount += resp.results.length;
        for (const r of resp.results) {
          const key = (r.url || r.title || JSON.stringify(r))
            .trim()
            .toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          uniqueResults.push(r);
        }
      }

      // Build merged response
      const mergedAnswer =
        responses
          .map((r) => r.answer?.trim())
          .filter(Boolean)
          .join("\n\n") || undefined;
      const mergedRaw =
        responses.length === 1
          ? responses[0].raw
          : {
              responses: responses.map((r) => r.raw),
              results: uniqueResults,
              answer: mergedAnswer,
            };
      const response = {
        answer: mergedAnswer,
        results: uniqueResults,
        raw: mergedRaw,
        metadata: {
          researchMode: mode.researchMode,
          type: mode.type,
          numResults: mode.numResults,
          textMaxCharacters: mode.textMaxCharacters,
          timeoutSeconds: mode.timeoutSeconds,
          queryCount: uniqueQueries.length,
          sourceCount,
          uniqueSourceCount: uniqueResults.length,
          elapsedMs: 0, // populated below
        },
      };

      // Determine output paths
      const format: ReportFormat =
        (params.reportFormat as ReportFormat) ?? "findings";
      let outputPath: string | undefined;
      let rawOutputPath: string | undefined;
      if (params.outputPath) {
        outputPath = resolveOutputPath(cwd, params.outputPath);
        if (format === "findings") {
          rawOutputPath = params.rawOutputPath
            ? resolveOutputPath(cwd, params.rawOutputPath)
            : defaultRawOutputPath(outputPath);
        } else if (format === "markdown" && params.rawOutputPath) {
          rawOutputPath = resolveOutputPath(cwd, params.rawOutputPath);
        }
      } else if (params.rawOutputPath) {
        rawOutputPath = resolveOutputPath(cwd, params.rawOutputPath);
      }

      // Render report
      const report =
        format === "json"
          ? JSON.stringify(response.raw, null, 2)
          : renderFindingsReport(prepared, response, { rawOutputPath });

      // Write files
      if (outputPath) {
        await writeQueued(outputPath, report);
      }
      if (rawOutputPath) {
        await writeQueued(
          rawOutputPath,
          JSON.stringify(buildRawSidecar(response, rawOutputPath), null, 2),
        );
      }

      // Track in session
      appendEntry("pi-tools-research", {
        query: prepared.query,
        outputPath,
        rawOutputPath,
        metadata: response.metadata,
        sourceCount: uniqueResults.length,
      });

      // Return result
      const text = outputPath
        ? `Exa deep research complete. Report: ${displayPath(cwd, outputPath)}\nSources: ${uniqueResults.length}${rawOutputPath ? `\nRaw metadata: ${displayPath(cwd, rawOutputPath)}` : ""}`
        : report;

      return {
        content: [{ type: "text" as const, text }],
        details: {
          outputPath,
          rawOutputPath,
          sourceCount: uniqueResults.length,
          metadata: response.metadata,
        },
      };
    },
    renderCall(args, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      const mode = args.researchMode ?? "standard";
      const queryPreview = args.query ?? args.queryFile ?? "research";
      const preview =
        queryPreview.length > 60
          ? `${queryPreview.slice(0, 57)}...`
          : queryPreview;
      text.setText(
        `${theme.fg("toolTitle", theme.bold("web_research"))} ${theme.fg("accent", `"${preview}"`)} ${theme.fg("muted", `(${mode})`)}`,
      );
      return text;
    },
    renderResult(result, options, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      if (context.isError) {
        const errorText =
          result.content[0] && "text" in result.content[0]
            ? result.content[0].text
            : "failed";
        text.setText(theme.fg("error", `web_research failed: ${errorText}`));
        return text;
      }
      const details = result.details as WebResearchDetails | undefined;
      const sourceCount = details?.sourceCount ?? 0;
      const outputPath = details?.outputPath;
      const parts = [`web_research complete`, `${sourceCount} sources`];
      if (outputPath)
        parts.push(`report: ${displayPath(context.cwd, outputPath)}`);
      text.setText(theme.fg("toolOutput", parts.join(" - ")));
      return text;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/tools/web-research.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/web-research.ts tests/tools/web-research.test.ts
git commit -m "feat(tools): add web_research tool definition"
```

---

## Phase 7: Registration and Wiring

### Task 7: Register web_research in index.ts

**Files:**

- Modify: `src/index.ts`
- Modify: `tests/index.test.ts` (add registration test)

- [ ] **Step 1: Write the failing test**

Add to `tests/index.test.ts` (or a new test file if the existing one is large):

Create `tests/index-research.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createMockPi } from "./helpers.ts";

// Mock the config to control Exa key availability
vi.mock("../src/config.ts", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    loadMergedConfig: vi.fn(),
  };
});

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    withFileMutationQueue: async (_path: string, fn: () => Promise<void>) =>
      fn(),
  };
});

describe("web_research registration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("registers web_research when exa API key is available", async () => {
    const { loadMergedConfig } = await import("../src/config.ts");
    vi.mocked(loadMergedConfig).mockReturnValue({
      defaultProvider: "auto",
      selectionStrategy: "auto",
      providers: {
        exa: { enabled: true, apiKey: "test-key" },
      },
      github: { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
      ssrf: { allowRanges: [] },
      combine: { enabled: false, mode: "targeted", targetBackends: 3, k: 60 },
      deepResearch: { enabled: true },
    } as any);

    // Set env var so resolveApiKey works
    process.env.EXA_API_KEY = "test-exa-key";
    const pi = createMockPi();
    const { default: createExtension } = await import("../src/index.ts");
    createExtension(pi as any);

    const toolNames = pi.tools.map((t) => t.name);
    expect(toolNames).toContain("web_research");
    delete process.env.EXA_API_KEY;
  });

  it("does not register web_research when exa API key is missing", async () => {
    const { loadMergedConfig } = await import("../src/config.ts");
    vi.mocked(loadMergedConfig).mockReturnValue({
      defaultProvider: "auto",
      selectionStrategy: "auto",
      providers: {
        exa: { enabled: true, apiKey: "EXA_API_KEY" },
      },
      github: { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
      ssrf: { allowRanges: [] },
      combine: { enabled: false, mode: "targeted", targetBackends: 3, k: 60 },
      deepResearch: { enabled: true },
    } as any);

    delete process.env.EXA_API_KEY;
    const pi = createMockPi();
    const { default: createExtension } = await import("../src/index.ts");
    createExtension(pi as any);

    const toolNames = pi.tools.map((t) => t.name);
    expect(toolNames).not.toContain("web_research");
  });

  it("does not register web_research when deepResearch.enabled is false", async () => {
    const { loadMergedConfig } = await import("../src/config.ts");
    vi.mocked(loadMergedConfig).mockReturnValue({
      defaultProvider: "auto",
      selectionStrategy: "auto",
      providers: {
        exa: { enabled: true, apiKey: "test-key" },
      },
      github: { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
      ssrf: { allowRanges: [] },
      combine: { enabled: false, mode: "targeted", targetBackends: 3, k: 60 },
      deepResearch: { enabled: false },
    } as any);

    process.env.EXA_API_KEY = "test-exa-key";
    const pi = createMockPi();
    const { default: createExtension } = await import("../src/index.ts");
    createExtension(pi as any);

    const toolNames = pi.tools.map((t) => t.name);
    expect(toolNames).not.toContain("web_research");
    delete process.env.EXA_API_KEY;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/index-research.test.ts`
Expected: FAIL — `web_research` not registered

- [ ] **Step 3: Wire registration in index.ts**

Add import at top of `src/index.ts`:

```typescript
import { createWebResearchTool } from "./tools/web-research.ts";
import { resolveApiKey } from "./config.ts";
```

Add registration after the docs tools block (after line 119), before the tier map:

```typescript
// Register web_research when Exa provider is available and deep research enabled
const exaConfig = configManager.current.providers?.exa;
const resolvedExaKey = resolveApiKey(exaConfig?.apiKey);
if (resolvedExaKey && configManager.current.deepResearch?.enabled !== false) {
  pi.registerTool(
    createWebResearchTool(
      resolvedExaKey,
      configManager.current.deepResearch,
      (customType, data) => pi.appendEntry(customType, data),
      configManager.current.deepResearch?.guidance,
    ),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/index-research.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/index.ts tests/index-research.test.ts
git commit -m "feat: register web_research tool conditionally on Exa key"
```

---

## Phase 8: Final Verification

### Task 8: Full check and cleanup

- [ ] **Step 1: Run the full check command**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npm run check`
Expected: lint, typecheck, and all tests pass

- [ ] **Step 2: Fix any issues found**

If biome lint reports formatting issues, run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npm run format`

- [ ] **Step 3: Verify the tool appears in extension output**

Quick smoke test — the extension should register 7 tools when Exa key is present (was 6 before):

```bash
cd /Users/lanh/Developer/pi-vault/pi-tools && EXA_API_KEY=test npx vitest run tests/index.test.ts
```

- [ ] **Step 4: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: formatting and lint fixes"
```
