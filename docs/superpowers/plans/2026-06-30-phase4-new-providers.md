# Phase 4: New Providers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 new search/fetch providers: Exa MCP, OpenAI native, Parallel, SearXNG, and WebSearchAPI.

**Architecture:** Each provider is an independent module implementing `SearchProvider` (and optionally `FetchProvider`). Registered via the existing factory pattern in `src/index.ts`. SearXNG requires SSRF exemption for its configured localhost instance URL.

**Tech Stack:** TypeScript, Vitest, existing pi-tools provider interfaces.

---

### Task 1: Exa MCP provider

Simplest starting point — no API key, free endpoint, JSON-RPC over HTTP. Good first provider to validate the pattern.

**Files:**
- Create: `src/providers/exa-mcp.ts`
- Create: `tests/providers/exa-mcp.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/providers/exa-mcp.test.ts`:

```ts
// tests/providers/exa-mcp.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExaMcpProvider } from "../../src/providers/exa-mcp.ts";
import { stubFetch } from "../helpers.ts";

describe("ExaMcpProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = new ExaMcpProvider();
    expect(provider.name).toBe("exa-mcp");
    expect(provider.label).toBe("Exa MCP");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("mcp.exa.ai", {
      body: {
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify([
                { title: "Exa Result", url: "https://exa.ai/page", text: "A snippet from Exa" },
                { title: "Second Result", url: "https://exa.ai/other", text: "Another snippet" },
              ]),
            },
          ],
        },
      },
    });

    const provider = new ExaMcpProvider();
    const results = await provider.search("test query", 5);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Exa Result",
      url: "https://exa.ai/page",
      snippet: "A snippet from Exa",
    });
    expect(results[1]).toEqual({
      title: "Second Result",
      url: "https://exa.ai/other",
      snippet: "Another snippet",
    });
  });

  it("sends correct JSON-RPC request body", async () => {
    fetchStub.addResponse("mcp.exa.ai", {
      body: {
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "[]" }] },
      },
    });

    const provider = new ExaMcpProvider();
    await provider.search("my query", 3);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "web_search_exa",
        arguments: { query: "my query", numResults: 3 },
      },
    });
    expect(fetchCall[1].method).toBe("POST");
    expect(fetchCall[1].headers["Content-Type"]).toBe("application/json");
  });

  it("limits results to maxResults", async () => {
    const manyResults = Array.from({ length: 10 }, (_, i) => ({
      title: `Result ${i}`,
      url: `https://exa.ai/${i}`,
      text: `Snippet ${i}`,
    }));
    fetchStub.addResponse("mcp.exa.ai", {
      body: {
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: JSON.stringify(manyResults) }] },
      },
    });

    const provider = new ExaMcpProvider();
    const results = await provider.search("test", 3);
    expect(results).toHaveLength(3);
  });

  it("throws on HTTP error response", async () => {
    fetchStub.addResponse("mcp.exa.ai", { status: 500, body: "Server Error" });
    const provider = new ExaMcpProvider();
    await expect(provider.search("test", 5)).rejects.toThrow("Exa MCP error");
  });

  it("throws on JSON-RPC error response", async () => {
    fetchStub.addResponse("mcp.exa.ai", {
      body: {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32600, message: "Invalid request" },
      },
    });
    const provider = new ExaMcpProvider();
    await expect(provider.search("test", 5)).rejects.toThrow("Invalid request");
  });

  it("handles empty result content gracefully", async () => {
    fetchStub.addResponse("mcp.exa.ai", {
      body: {
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "[]" }] },
      },
    });

    const provider = new ExaMcpProvider();
    const results = await provider.search("nothing", 5);
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/providers/exa-mcp.test.ts`
Expected: FAIL — `ExaMcpProvider` cannot be imported (module does not exist)

- [ ] **Step 3: Implement `ExaMcpProvider`**

Create `src/providers/exa-mcp.ts`:

```ts
// src/providers/exa-mcp.ts
import type { SearchFilters, SearchProvider, SearchResult } from "./types.ts";

const EXA_MCP_ENDPOINT = "https://mcp.exa.ai/mcp";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: {
    content: Array<{ type: string; text: string }>;
  };
  error?: {
    code: number;
    message: string;
  };
}

interface ExaMcpResult {
  title: string;
  url: string;
  text?: string;
}

export class ExaMcpProvider implements SearchProvider {
  readonly name = "exa-mcp";
  readonly label = "Exa MCP";

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    _filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const response = await fetch(EXA_MCP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "web_search_exa",
          arguments: { query, numResults: maxResults },
        },
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `Exa MCP error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as JsonRpcResponse;

    if (data.error) {
      throw new Error(
        `Exa MCP JSON-RPC error: ${data.error.message}`,
      );
    }

    const textContent = data.result?.content?.[0]?.text;
    if (!textContent) return [];

    const parsed = JSON.parse(textContent) as ExaMcpResult[];
    return parsed.slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.text ?? "",
    }));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/providers/exa-mcp.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/exa-mcp.ts tests/providers/exa-mcp.test.ts
git commit -m "feat: add Exa MCP provider (free, no-auth JSON-RPC search)"
```

---

### Task 2: WebSearchAPI provider

POST-based search API (api.websearchapi.ai). Auth via Bearer token. Response uses `organic[]` array. Single-capability provider (search only).

**Files:**
- Create: `src/providers/websearchapi.ts`
- Create: `tests/providers/websearchapi.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/providers/websearchapi.test.ts`:

```ts
// tests/providers/websearchapi.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSearchApiProvider } from "../../src/providers/websearchapi.ts";
import { stubFetch } from "../helpers.ts";

describe("WebSearchApiProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = new WebSearchApiProvider("test-key");
    expect(provider.name).toBe("websearchapi");
    expect(provider.label).toBe("WebSearchAPI");
  });

  it("returns normalized search results from organic array", async () => {
    fetchStub.addResponse("api.websearchapi.ai", {
      body: {
        organic: [
          {
            title: "WS Result",
            url: "https://example.com/page",
            description: "A WebSearchAPI snippet",
            position: 1,
            score: 0.95,
          },
          {
            title: "Second Result",
            url: "https://example.com/other",
            description: "Another snippet",
            position: 2,
            score: 0.88,
          },
        ],
        responseTime: 1.2,
      },
    });

    const provider = new WebSearchApiProvider("test-key");
    const results = await provider.search("test query", 5);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "WS Result",
      url: "https://example.com/page",
      snippet: "A WebSearchAPI snippet",
    });
    expect(results[1]).toEqual({
      title: "Second Result",
      url: "https://example.com/other",
      snippet: "Another snippet",
    });
  });

  it("sends correct POST request with Bearer auth", async () => {
    fetchStub.addResponse("api.websearchapi.ai", {
      body: { organic: [], responseTime: 0.5 },
    });

    const provider = new WebSearchApiProvider("my-ws-key");
    await provider.search("my query", 7);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toBe("https://api.websearchapi.ai/ai-search");
    expect(fetchCall[1].method).toBe("POST");

    const body = JSON.parse(fetchCall[1].body);
    expect(body.query).toBe("my query");
    expect(body.maxResults).toBe(7);

    expect(fetchCall[1].headers["Authorization"]).toBe("Bearer my-ws-key");
    expect(fetchCall[1].headers["Content-Type"]).toBe("application/json");
  });

  it("limits results to maxResults", async () => {
    const manyResults = Array.from({ length: 10 }, (_, i) => ({
      title: `Result ${i}`,
      url: `https://example.com/${i}`,
      description: `Snippet ${i}`,
      position: i + 1,
      score: 0.9 - i * 0.05,
    }));
    fetchStub.addResponse("api.websearchapi.ai", {
      body: { organic: manyResults, responseTime: 1.0 },
    });

    const provider = new WebSearchApiProvider("key");
    const results = await provider.search("test", 3);
    expect(results).toHaveLength(3);
  });

  it("throws on error response", async () => {
    fetchStub.addResponse("api.websearchapi.ai", {
      status: 401,
      body: "Unauthorized",
    });
    const provider = new WebSearchApiProvider("bad-key");
    await expect(provider.search("test", 5)).rejects.toThrow(
      "WebSearchAPI error",
    );
  });

  it("handles empty organic array", async () => {
    fetchStub.addResponse("api.websearchapi.ai", {
      body: { organic: [], responseTime: 0.3 },
    });

    const provider = new WebSearchApiProvider("key");
    const results = await provider.search("nothing", 5);
    expect(results).toEqual([]);
  });

  it("handles missing organic field gracefully", async () => {
    fetchStub.addResponse("api.websearchapi.ai", {
      body: { responseTime: 0.3 },
    });

    const provider = new WebSearchApiProvider("key");
    const results = await provider.search("nothing", 5);
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/providers/websearchapi.test.ts`
Expected: FAIL — `WebSearchApiProvider` cannot be imported

- [ ] **Step 3: Implement `WebSearchApiProvider`**

Create `src/providers/websearchapi.ts`:

```ts
// src/providers/websearchapi.ts
import type { SearchFilters, SearchProvider, SearchResult } from "./types.ts";

const WEBSEARCHAPI_ENDPOINT = "https://api.websearchapi.ai/ai-search";

interface WebSearchApiResponse {
  organic?: Array<{
    title: string;
    url: string;
    description: string;
    position?: number;
    score?: number;
  }>;
  responseTime?: number;
}

export class WebSearchApiProvider implements SearchProvider {
  readonly name = "websearchapi";
  readonly label = "WebSearchAPI";
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
    const response = await fetch(WEBSEARCHAPI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ query, maxResults }),
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `WebSearchAPI error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as WebSearchApiResponse;
    return (data.organic ?? []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/providers/websearchapi.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/websearchapi.ts tests/providers/websearchapi.test.ts
git commit -m "feat: add WebSearchAPI provider (Google-powered POST search)"
```

---

### Task 3: OpenAI native provider

Uses the OpenAI Responses API with the built-in `web_search` tool. Search results are extracted from `url_citation` annotations in the message output (there is no separate `web_search_results` type). Uses `gpt-4.1-nano` for minimal cost.

**Files:**
- Create: `src/providers/openai-native.ts`
- Create: `tests/providers/openai-native.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/providers/openai-native.test.ts`:

```ts
// tests/providers/openai-native.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpenAINativeProvider } from "../../src/providers/openai-native.ts";
import { stubFetch } from "../helpers.ts";

describe("OpenAINativeProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = new OpenAINativeProvider("test-key");
    expect(provider.name).toBe("openai-native");
    expect(provider.label).toBe("OpenAI Web Search");
  });

  it("returns normalized search results from url_citation annotations", async () => {
    fetchStub.addResponse("api.openai.com/v1/responses", {
      body: {
        id: "resp_123",
        output: [
          {
            type: "web_search_call",
            id: "ws_1",
            status: "completed",
            action: { type: "search", query: "test query" },
          },
          {
            type: "message",
            id: "msg_1",
            status: "completed",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Here are your results about the topic.",
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://openai.com/page",
                    title: "OpenAI Result",
                    start_index: 0,
                    end_index: 20,
                  },
                  {
                    type: "url_citation",
                    url: "https://example.com/other",
                    title: "Another Result",
                    start_index: 21,
                    end_index: 38,
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const provider = new OpenAINativeProvider("test-key");
    const results = await provider.search("test query", 5);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "OpenAI Result",
      url: "https://openai.com/page",
      snippet: "",
    });
    expect(results[1]).toEqual({
      title: "Another Result",
      url: "https://example.com/other",
      snippet: "",
    });
  });

  it("deduplicates citations by URL", async () => {
    fetchStub.addResponse("api.openai.com/v1/responses", {
      body: {
        id: "resp_123",
        output: [
          {
            type: "web_search_call",
            id: "ws_1",
            status: "completed",
            action: { type: "search", query: "test" },
          },
          {
            type: "message",
            id: "msg_1",
            status: "completed",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Multiple citations from same source.",
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://example.com/page",
                    title: "Same Page",
                    start_index: 0,
                    end_index: 10,
                  },
                  {
                    type: "url_citation",
                    url: "https://example.com/page",
                    title: "Same Page",
                    start_index: 15,
                    end_index: 30,
                  },
                  {
                    type: "url_citation",
                    url: "https://other.com",
                    title: "Other Page",
                    start_index: 31,
                    end_index: 35,
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const provider = new OpenAINativeProvider("key");
    const results = await provider.search("test", 10);
    expect(results).toHaveLength(2);
    expect(results[0].url).toBe("https://example.com/page");
    expect(results[1].url).toBe("https://other.com");
  });

  it("sends correct request body with web_search tool", async () => {
    fetchStub.addResponse("api.openai.com/v1/responses", {
      body: { id: "resp_123", output: [] },
    });

    const provider = new OpenAINativeProvider("my-openai-key");
    await provider.search("my query", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(fetchCall[1].method).toBe("POST");

    const body = JSON.parse(fetchCall[1].body);
    expect(body.model).toBe("gpt-4.1-nano");
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.input).toContain("my query");
    expect(body.tool_choice).toBe("required");

    expect(fetchCall[1].headers["Authorization"]).toBe("Bearer my-openai-key");
    expect(fetchCall[1].headers["Content-Type"]).toBe("application/json");
  });

  it("limits results to maxResults", async () => {
    const annotations = Array.from({ length: 10 }, (_, i) => ({
      type: "url_citation",
      url: `https://example.com/${i}`,
      title: `Result ${i}`,
      start_index: i * 10,
      end_index: i * 10 + 9,
    }));
    fetchStub.addResponse("api.openai.com/v1/responses", {
      body: {
        id: "resp_123",
        output: [
          {
            type: "web_search_call",
            id: "ws_1",
            status: "completed",
            action: { type: "search", query: "test" },
          },
          {
            type: "message",
            id: "msg_1",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: "Results.", annotations }],
          },
        ],
      },
    });

    const provider = new OpenAINativeProvider("key");
    const results = await provider.search("test", 3);
    expect(results).toHaveLength(3);
  });

  it("throws on HTTP error response", async () => {
    fetchStub.addResponse("api.openai.com/v1/responses", {
      status: 401,
      body: "Invalid API key",
    });
    const provider = new OpenAINativeProvider("bad-key");
    await expect(provider.search("test", 5)).rejects.toThrow(
      "OpenAI API error",
    );
  });

  it("returns empty results when no message in output", async () => {
    fetchStub.addResponse("api.openai.com/v1/responses", {
      body: { id: "resp_123", output: [] },
    });

    const provider = new OpenAINativeProvider("key");
    const results = await provider.search("obscure query", 5);
    expect(results).toEqual([]);
  });

  it("returns empty results when message has no annotations", async () => {
    fetchStub.addResponse("api.openai.com/v1/responses", {
      body: {
        id: "resp_123",
        output: [
          {
            type: "message",
            id: "msg_1",
            status: "completed",
            role: "assistant",
            content: [
              { type: "output_text", text: "I could not find any results." },
            ],
          },
        ],
      },
    });

    const provider = new OpenAINativeProvider("key");
    const results = await provider.search("nothing found", 5);
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/providers/openai-native.test.ts`
Expected: FAIL — `OpenAINativeProvider` cannot be imported

- [ ] **Step 3: Implement `OpenAINativeProvider`**

Create `src/providers/openai-native.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/providers/openai-native.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/openai-native.ts tests/providers/openai-native.test.ts
git commit -m "feat: add OpenAI native provider (Responses API url_citation parsing)"
```

---

### Task 4: Parallel provider

Implements both `SearchProvider` and `FetchProvider`. Uses `https://api.parallel.ai/v1/search` (POST) and `https://api.parallel.ai/v1/extract` (POST). Auth via `x-api-key` header. Search results have `excerpts[]` arrays (joined as snippet). Extract returns `full_content` markdown.

**Files:**
- Create: `src/providers/parallel.ts`
- Create: `tests/providers/parallel.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/providers/parallel.test.ts`:

```ts
// tests/providers/parallel.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ParallelProvider } from "../../src/providers/parallel.ts";
import { stubFetch } from "../helpers.ts";

describe("ParallelProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = new ParallelProvider("test-key");
    expect(provider.name).toBe("parallel");
    expect(provider.label).toBe("Parallel");
  });

  describe("search", () => {
    it("returns normalized search results with excerpts joined as snippet", async () => {
      fetchStub.addResponse("api.parallel.ai/v1/search", {
        body: {
          search_id: "search_abc123",
          results: [
            {
              url: "https://example.com/page",
              title: "Parallel Result",
              excerpts: ["First excerpt.", "Second excerpt."],
            },
            {
              url: "https://example.com/other",
              title: "Second Result",
              excerpts: ["Another snippet"],
            },
          ],
          session_id: "session_abc123",
        },
      });

      const provider = new ParallelProvider("test-key");
      const results = await provider.search("test query", 5);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        title: "Parallel Result",
        url: "https://example.com/page",
        snippet: "First excerpt. Second excerpt.",
      });
      expect(results[1]).toEqual({
        title: "Second Result",
        url: "https://example.com/other",
        snippet: "Another snippet",
      });
    });

    it("sends correct POST request with x-api-key header", async () => {
      fetchStub.addResponse("api.parallel.ai/v1/search", {
        body: { search_id: "s_1", results: [], session_id: "sess_1" },
      });

      const provider = new ParallelProvider("my-parallel-key");
      await provider.search("my query", 7);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toBe("https://api.parallel.ai/v1/search");
      expect(fetchCall[1].method).toBe("POST");

      const body = JSON.parse(fetchCall[1].body);
      expect(body.search_queries).toEqual(["my query"]);
      expect(body.objective).toBe("my query");
      expect(body.mode).toBe("basic");

      expect(fetchCall[1].headers["x-api-key"]).toBe("my-parallel-key");
      expect(fetchCall[1].headers["Content-Type"]).toBe("application/json");
    });

    it("limits results to maxResults", async () => {
      const manyResults = Array.from({ length: 10 }, (_, i) => ({
        url: `https://example.com/${i}`,
        title: `Result ${i}`,
        excerpts: [`Snippet ${i}`],
      }));
      fetchStub.addResponse("api.parallel.ai/v1/search", {
        body: { search_id: "s_1", results: manyResults, session_id: "sess_1" },
      });

      const provider = new ParallelProvider("key");
      const results = await provider.search("test", 3);
      expect(results).toHaveLength(3);
    });

    it("throws on error response", async () => {
      fetchStub.addResponse("api.parallel.ai/v1/search", {
        status: 403,
        body: "Forbidden",
      });
      const provider = new ParallelProvider("bad-key");
      await expect(provider.search("test", 5)).rejects.toThrow(
        "Parallel search error",
      );
    });

    it("handles empty results array", async () => {
      fetchStub.addResponse("api.parallel.ai/v1/search", {
        body: { search_id: "s_1", results: [], session_id: "sess_1" },
      });

      const provider = new ParallelProvider("key");
      const results = await provider.search("nothing", 5);
      expect(results).toEqual([]);
    });

    it("handles results with empty excerpts", async () => {
      fetchStub.addResponse("api.parallel.ai/v1/search", {
        body: {
          search_id: "s_1",
          results: [{ url: "https://example.com", title: "No excerpts", excerpts: [] }],
          session_id: "sess_1",
        },
      });

      const provider = new ParallelProvider("key");
      const results = await provider.search("test", 5);
      expect(results[0].snippet).toBe("");
    });
  });

  describe("fetch", () => {
    it("returns fetched content from extract endpoint", async () => {
      fetchStub.addResponse("api.parallel.ai/v1/extract", {
        body: {
          extract_id: "extract_abc123",
          results: [
            {
              url: "https://example.com/page",
              title: "Page Title",
              full_content: "# Page Title\n\nFetched markdown content from the page.",
              excerpts: ["Some excerpt"],
            },
          ],
          session_id: "session_abc123",
        },
      });

      const provider = new ParallelProvider("test-key");
      const result = await provider.fetch("https://example.com/page");

      expect(result.text).toBe("# Page Title\n\nFetched markdown content from the page.");
      expect(result.title).toBe("Page Title");
    });

    it("sends correct POST request for extract", async () => {
      fetchStub.addResponse("api.parallel.ai/v1/extract", {
        body: {
          extract_id: "e_1",
          results: [{ url: "https://example.com/target", title: "", full_content: "" }],
          session_id: "sess_1",
        },
      });

      const provider = new ParallelProvider("my-key");
      await provider.fetch("https://example.com/target");

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toBe("https://api.parallel.ai/v1/extract");
      expect(fetchCall[1].method).toBe("POST");

      const body = JSON.parse(fetchCall[1].body);
      expect(body.urls).toEqual(["https://example.com/target"]);
      expect(body.full_content).toBe(true);

      expect(fetchCall[1].headers["x-api-key"]).toBe("my-key");
    });

    it("throws on extract error response", async () => {
      fetchStub.addResponse("api.parallel.ai/v1/extract", {
        status: 500,
        body: "Server Error",
      });
      const provider = new ParallelProvider("key");
      await expect(
        provider.fetch("https://example.com/broken"),
      ).rejects.toThrow("Parallel extract error");
    });

    it("throws when extract returns no results for URL", async () => {
      fetchStub.addResponse("api.parallel.ai/v1/extract", {
        body: {
          extract_id: "e_1",
          results: [],
          session_id: "sess_1",
        },
      });
      const provider = new ParallelProvider("key");
      await expect(
        provider.fetch("https://example.com/missing"),
      ).rejects.toThrow("Parallel extract error");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/providers/parallel.test.ts`
Expected: FAIL — `ParallelProvider` cannot be imported

- [ ] **Step 3: Implement `ParallelProvider`**

Create `src/providers/parallel.ts`:

```ts
// src/providers/parallel.ts
import type {
  FetchProvider,
  FetchResult,
  SearchFilters,
  SearchProvider,
  SearchResult,
} from "./types.ts";

const PARALLEL_SEARCH_ENDPOINT = "https://api.parallel.ai/v1/search";
const PARALLEL_EXTRACT_ENDPOINT = "https://api.parallel.ai/v1/extract";

interface ParallelSearchResponse {
  search_id: string;
  results: Array<{
    url: string;
    title: string;
    excerpts: string[];
    publish_date?: string;
  }>;
  session_id: string;
}

interface ParallelExtractResponse {
  extract_id: string;
  results: Array<{
    url: string;
    title?: string;
    excerpts?: string[];
    full_content?: string;
  }>;
  session_id: string;
}

export class ParallelProvider implements SearchProvider, FetchProvider {
  readonly name = "parallel";
  readonly label = "Parallel";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
    };
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    _filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const response = await fetch(PARALLEL_SEARCH_ENDPOINT, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        search_queries: [query],
        objective: query,
        mode: "basic",
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `Parallel search error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as ParallelSearchResponse;
    return (data.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.excerpts.join(" "),
    }));
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const response = await fetch(PARALLEL_EXTRACT_ENDPOINT, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ urls: [url], full_content: true }),
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `Parallel extract error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as ParallelExtractResponse;
    const result = data.results?.[0];
    if (!result) {
      throw new Error(`Parallel extract error: no results for ${url}`);
    }

    return {
      text: result.full_content ?? result.excerpts?.join("\n\n") ?? "",
      title: result.title,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/providers/parallel.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/parallel.ts tests/providers/parallel.test.ts
git commit -m "feat: add Parallel provider (search + extract)"
```

---

### Task 5: SearXNG provider with SSRF exemption

Self-hosted metasearch engine. Requires an SSRF exemption so the provider can reach its configured localhost/private-network instance URL.

**Files:**
- Modify: `src/utils/ssrf.ts`
- Modify: `tests/utils/ssrf.test.ts` (or create if absent)
- Create: `src/providers/searxng.ts`
- Create: `tests/providers/searxng.test.ts`

- [ ] **Step 1: Write failing tests for the SSRF `allowedBaseUrls` parameter**

Add to the existing `tests/utils/ssrf.test.ts` (or create if the file does not exist). Keep all existing tests intact; add a new `describe` block:

```ts
import { describe, expect, it } from "vitest";
import { validateUrl } from "../../src/utils/ssrf.ts";

describe("validateUrl with allowedBaseUrls", () => {
  it("allows localhost URL when it matches an allowed base URL", () => {
    const result = validateUrl(
      "http://localhost:8080/search?q=test&format=json",
      { allowedBaseUrls: ["http://localhost:8080"] },
    );
    expect(result.hostname).toBe("localhost");
  });

  it("allows private IP URL when it matches an allowed base URL", () => {
    const result = validateUrl(
      "http://192.168.1.100:8080/search?q=hello",
      { allowedBaseUrls: ["http://192.168.1.100:8080"] },
    );
    expect(result.hostname).toBe("192.168.1.100");
  });

  it("still blocks localhost without allowedBaseUrls", () => {
    expect(() => validateUrl("http://localhost:8080/search")).toThrow(
      "Blocked hostname",
    );
  });

  it("blocks localhost when URL does not match any allowed base URL", () => {
    expect(() =>
      validateUrl("http://localhost:9090/search", {
        allowedBaseUrls: ["http://localhost:8080"],
      }),
    ).toThrow("Blocked hostname");
  });

  it("requires the allowed URL to be a prefix match (scheme + host + port)", () => {
    // Port mismatch
    expect(() =>
      validateUrl("http://localhost:3000/path", {
        allowedBaseUrls: ["http://localhost:8080"],
      }),
    ).toThrow("Blocked hostname");

    // Scheme mismatch
    expect(() =>
      validateUrl("https://localhost:8080/path", {
        allowedBaseUrls: ["http://localhost:8080"],
      }),
    ).toThrow("Blocked hostname");
  });

  it("does not bypass protocol or credential checks for allowed URLs", () => {
    expect(() =>
      validateUrl("ftp://localhost:8080/path", {
        allowedBaseUrls: ["ftp://localhost:8080"],
      }),
    ).toThrow("Blocked protocol");

    expect(() =>
      validateUrl("http://user:pass@localhost:8080/path", {
        allowedBaseUrls: ["http://localhost:8080"],
      }),
    ).toThrow("credentials");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/utils/ssrf.test.ts`
Expected: FAIL — `validateUrl` does not accept a second argument

- [ ] **Step 3: Update `validateUrl` to accept `allowedBaseUrls`**

Modify `src/utils/ssrf.ts`. Replace the existing `validateUrl` function:

```ts
export interface ValidateUrlOptions {
  allowedBaseUrls?: string[];
}

export function validateUrl(
  url: string,
  options?: ValidateUrlOptions,
): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SSRFError(`Invalid URL: ${url}`);
  }

  // Protocol check
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SSRFError(`Blocked protocol: ${parsed.protocol}`);
  }

  // Credentials check
  if (parsed.username || parsed.password) {
    throw new SSRFError("URLs with credentials are not allowed");
  }

  // Hostname checks (guaranteed non-empty for http/https, but guard explicitly)
  const hostname = parsed.hostname;
  if (!hostname) {
    throw new SSRFError("URL has no hostname");
  }

  // Check if the URL matches an allowed base URL (SSRF exemption)
  const isAllowed = options?.allowedBaseUrls?.some((base) => {
    try {
      const baseUrl = new URL(base);
      return (
        parsed.protocol === baseUrl.protocol &&
        parsed.hostname === baseUrl.hostname &&
        parsed.port === baseUrl.port
      );
    } catch {
      return false;
    }
  });

  if (!isAllowed) {
    if (isBlockedHostname(hostname)) {
      throw new SSRFError(`Blocked hostname: ${hostname}`);
    }

    if (isPrivateIP(hostname)) {
      throw new SSRFError(`Blocked private/reserved IP: ${hostname}`);
    }
  }

  return parsed;
}
```

- [ ] **Step 4: Run SSRF tests to verify they pass**

Run: `npx vitest run tests/utils/ssrf.test.ts`
Expected: All tests PASS (both existing and new)

- [ ] **Step 5: Commit the SSRF change**

```bash
git add src/utils/ssrf.ts tests/utils/ssrf.test.ts
git commit -m "feat: add allowedBaseUrls SSRF exemption for self-hosted providers"
```

- [ ] **Step 6: Write failing tests for `SearXNGProvider`**

Create `tests/providers/searxng.test.ts`:

```ts
// tests/providers/searxng.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SearXNGProvider } from "../../src/providers/searxng.ts";
import { stubFetch } from "../helpers.ts";

describe("SearXNGProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = new SearXNGProvider();
    expect(provider.name).toBe("searxng");
    expect(provider.label).toBe("SearXNG");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("localhost:8080/search", {
      body: {
        results: [
          {
            title: "SearXNG Result",
            url: "https://example.com/page",
            content: "A snippet from SearXNG",
          },
          {
            title: "Second Result",
            url: "https://example.com/other",
            content: "Another snippet",
          },
        ],
      },
    });

    const provider = new SearXNGProvider();
    const results = await provider.search("test query", 5);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "SearXNG Result",
      url: "https://example.com/page",
      snippet: "A snippet from SearXNG",
    });
    expect(results[1]).toEqual({
      title: "Second Result",
      url: "https://example.com/other",
      snippet: "Another snippet",
    });
  });

  it("uses default localhost:8080 instance URL", async () => {
    fetchStub.addResponse("localhost:8080/search", {
      body: { results: [] },
    });

    const provider = new SearXNGProvider();
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toContain("http://localhost:8080/search");
    expect(url).toContain("q=test");
    expect(url).toContain("format=json");
  });

  it("uses custom instance URL", async () => {
    fetchStub.addResponse("192.168.1.50:9090/search", {
      body: { results: [] },
    });

    const provider = new SearXNGProvider({
      instanceUrl: "http://192.168.1.50:9090",
    });
    await provider.search("custom", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toContain("http://192.168.1.50:9090/search");
  });

  it("uses SEARXNG_URL env var when set", async () => {
    const original = process.env.SEARXNG_URL;
    process.env.SEARXNG_URL = "http://10.0.0.5:8888";

    fetchStub.addResponse("10.0.0.5:8888/search", {
      body: { results: [] },
    });

    try {
      const provider = new SearXNGProvider();
      await provider.search("env-test", 5);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain("http://10.0.0.5:8888/search");
    } finally {
      if (original === undefined) {
        delete process.env.SEARXNG_URL;
      } else {
        process.env.SEARXNG_URL = original;
      }
    }
  });

  it("config instanceUrl takes precedence over SEARXNG_URL env var", async () => {
    const original = process.env.SEARXNG_URL;
    process.env.SEARXNG_URL = "http://should-not-use:8888";

    fetchStub.addResponse("my-instance:3000/search", {
      body: { results: [] },
    });

    try {
      const provider = new SearXNGProvider({
        instanceUrl: "http://my-instance:3000",
      });
      await provider.search("priority-test", 5);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain("http://my-instance:3000/search");
    } finally {
      if (original === undefined) {
        delete process.env.SEARXNG_URL;
      } else {
        process.env.SEARXNG_URL = original;
      }
    }
  });

  it("sends API key in Authorization header when provided", async () => {
    fetchStub.addResponse("localhost:8080/search", {
      body: { results: [] },
    });

    const provider = new SearXNGProvider({ apiKey: "my-searxng-key" });
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["Authorization"]).toBe(
      "Bearer my-searxng-key",
    );
  });

  it("omits Authorization header when no API key", async () => {
    fetchStub.addResponse("localhost:8080/search", {
      body: { results: [] },
    });

    const provider = new SearXNGProvider();
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["Authorization"]).toBeUndefined();
  });

  it("limits results to maxResults", async () => {
    const manyResults = Array.from({ length: 10 }, (_, i) => ({
      title: `Result ${i}`,
      url: `https://example.com/${i}`,
      content: `Snippet ${i}`,
    }));
    fetchStub.addResponse("localhost:8080/search", {
      body: { results: manyResults },
    });

    const provider = new SearXNGProvider();
    const results = await provider.search("test", 3);
    expect(results).toHaveLength(3);
  });

  it("throws on error response", async () => {
    fetchStub.addResponse("localhost:8080/search", {
      status: 500,
      body: "Internal Server Error",
    });
    const provider = new SearXNGProvider();
    await expect(provider.search("test", 5)).rejects.toThrow(
      "SearXNG error",
    );
  });

  it("handles empty results array", async () => {
    fetchStub.addResponse("localhost:8080/search", {
      body: { results: [] },
    });

    const provider = new SearXNGProvider();
    const results = await provider.search("nothing", 5);
    expect(results).toEqual([]);
  });

  it("exposes instanceUrl for SSRF allowlisting", () => {
    const provider = new SearXNGProvider({
      instanceUrl: "http://192.168.1.50:9090",
    });
    expect(provider.instanceUrl).toBe("http://192.168.1.50:9090");
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npx vitest run tests/providers/searxng.test.ts`
Expected: FAIL — `SearXNGProvider` cannot be imported

- [ ] **Step 8: Implement `SearXNGProvider`**

Create `src/providers/searxng.ts`:

```ts
// src/providers/searxng.ts
import type { SearchFilters, SearchProvider, SearchResult } from "./types.ts";

const DEFAULT_INSTANCE_URL = "http://localhost:8080";

interface SearXNGOptions {
  instanceUrl?: string;
  apiKey?: string;
}

interface SearXNGSearchResponse {
  results: Array<{
    title: string;
    url: string;
    content: string;
  }>;
}

export class SearXNGProvider implements SearchProvider {
  readonly name = "searxng";
  readonly label = "SearXNG";
  readonly instanceUrl: string;
  private apiKey?: string;

  constructor(options?: SearXNGOptions) {
    this.instanceUrl =
      options?.instanceUrl ??
      process.env.SEARXNG_URL ??
      DEFAULT_INSTANCE_URL;
    this.apiKey = options?.apiKey;
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    _filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const url = `${this.instanceUrl}/search?q=${encodeURIComponent(query)}&format=json`;
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, { headers, signal });

    if (!response.ok) {
      throw new Error(
        `SearXNG error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as SearXNGSearchResponse;
    return (data.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    }));
  }
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run tests/providers/searxng.test.ts`
Expected: All tests PASS

- [ ] **Step 10: Commit**

```bash
git add src/providers/searxng.ts tests/providers/searxng.test.ts
git commit -m "feat: add SearXNG provider (self-hosted metasearch with SSRF exemption)"
```

---

### Task 6: Register all providers in factory and config

Wire all 5 new providers into `src/index.ts` and `src/config.ts`. The factory pattern needs a minor extension: `ProviderFactory.create` currently accepts `(key?: string)`, but SearXNG also needs `instanceUrl` from config. Extend `create` to accept `(key?: string, config?: ProviderConfigEntry)` so the SearXNG factory can read its `instanceUrl`.

**Files:**
- Modify: `src/config.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Extend `ProviderConfigEntry` to support `instanceUrl`**

In `src/config.ts`, add `instanceUrl` as an optional field:

```ts
export interface ProviderConfigEntry {
  enabled: boolean;
  monthlyQuota?: number;
  apiKey?: string;
  instanceUrl?: string;
}
```

- [ ] **Step 2: Add new provider defaults to `DEFAULT_CONFIG`**

In `src/config.ts`, add the 5 new entries to `DEFAULT_CONFIG.providers` (after the existing `firecrawl` entry):

```ts
"exa-mcp": { enabled: true },
"openai-native": { enabled: true, apiKey: "OPENAI_API_KEY" },
parallel: { enabled: false, apiKey: "PARALLEL_API_KEY" },
searxng: { enabled: false, instanceUrl: "http://localhost:8080" },
websearchapi: { enabled: false, apiKey: "WEBSEARCHAPI_API_KEY" },
```

- [ ] **Step 3: Update `ProviderFactory.create` signature to accept provider config**

In `src/index.ts`, update the `ProviderFactory` interface:

Replace:
```ts
interface ProviderFactory {
  create: (key?: string) => {
    search?: SearchProvider;
    fetch?: FetchProvider;
    codeSearch?: CodeSearchProvider;
  };
  tier: 1 | 2 | 3;
  monthlyQuota: number | null;
  requiresKey: boolean;
}
```

With:
```ts
interface ProviderFactory {
  create: (key?: string, providerConfig?: ProviderConfigEntry) => {
    search?: SearchProvider;
    fetch?: FetchProvider;
    codeSearch?: CodeSearchProvider;
  };
  tier: 1 | 2 | 3;
  monthlyQuota: number | null;
  requiresKey: boolean;
}
```

- [ ] **Step 4: Add imports for new providers**

In `src/index.ts`, add import statements after the existing provider imports:

```ts
import { ExaMcpProvider } from "./providers/exa-mcp.ts";
import { OpenAINativeProvider } from "./providers/openai-native.ts";
import { ParallelProvider } from "./providers/parallel.ts";
import { SearXNGProvider } from "./providers/searxng.ts";
import { WebSearchApiProvider } from "./providers/websearchapi.ts";
```

Also add the config type import:
```ts
import { loadConfig, resolveApiKey, type ProviderConfigEntry } from "./config.ts";
```

- [ ] **Step 5: Add factory entries for all 5 providers**

In `src/index.ts`, add the following entries to the `providerFactories` object (after the existing `firecrawl` entry):

```ts
"exa-mcp": {
  create: () => ({ search: new ExaMcpProvider() }),
  tier: 3, monthlyQuota: null, requiresKey: false,
},
"openai-native": {
  create: (key) => ({ search: new OpenAINativeProvider(key!) }),
  tier: 1, monthlyQuota: null, requiresKey: true,
},
parallel: {
  create: (key) => {
    const p = new ParallelProvider(key!);
    return { search: p, fetch: p };
  },
  tier: 1, monthlyQuota: null, requiresKey: true,
},
searxng: {
  create: (_key, providerConfig) => ({
    search: new SearXNGProvider({
      instanceUrl: providerConfig?.instanceUrl,
      apiKey: providerConfig?.apiKey ? resolveApiKey(providerConfig.apiKey) : undefined,
    }),
  }),
  tier: 2, monthlyQuota: null, requiresKey: false,
},
websearchapi: {
  create: (key) => ({ search: new WebSearchApiProvider(key!) }),
  tier: 1, monthlyQuota: null, requiresKey: true,
},
```

- [ ] **Step 6: Pass provider config to factory `create()` in the registration loop**

In `src/index.ts`, update the factory `create` call in the registration loop:

Replace:
```ts
const instances = factory.create(resolvedKey);
```

With:
```ts
const instances = factory.create(resolvedKey, providerConfig);
```

- [ ] **Step 7: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 8: Commit**

```bash
git add src/config.ts src/index.ts
git commit -m "feat: register all 5 new providers in factory and config"
```

---

### Task 7: Full regression test

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS across all test files

- [ ] **Step 2: Run type checking**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Verify new provider files exist**

Run:
```bash
ls -la src/providers/exa-mcp.ts src/providers/openai-native.ts src/providers/parallel.ts src/providers/searxng.ts src/providers/websearchapi.ts
ls -la tests/providers/exa-mcp.test.ts tests/providers/openai-native.test.ts tests/providers/parallel.test.ts tests/providers/searxng.test.ts tests/providers/websearchapi.test.ts
```
Expected: All 10 files exist

- [ ] **Step 4: Verify factory registration count**

Search for entries in `providerFactories`:
```bash
grep -c 'create:' src/index.ts
```
Expected: 13 (8 existing + 5 new)

- [ ] **Step 5: Verify config defaults count**

Search for entries in `DEFAULT_CONFIG.providers`:
```bash
grep -c 'enabled:' src/config.ts
```
Expected: 13 (8 existing + 5 new)

- [ ] **Step 6: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: phase 4 cleanup and regression verification"
```
