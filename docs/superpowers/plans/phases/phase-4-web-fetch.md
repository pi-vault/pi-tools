# Phase 4: HTML Extraction + web_fetch Tool

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the `web_fetch` tool with Tier 1 HTML extraction (HTTP + Readability + Turndown). After this phase, agents can fetch and read web pages as markdown.

**Spec:** `docs/superpowers/specs/2026-06-27-pi-tools-design.md`

**Depends on:** Phase 1 (SSRF, truncate, storage, errors), Phase 2 (index.ts), Phase 3 (web_read, content store)

**Produces:** `src/extract/html.ts`, `src/extract/pipeline.ts`, `src/tools/web-fetch.ts`, updated `src/index.ts`

---

## Task 4.1: HTML Extraction Pipeline

**Files:**
- Create: `src/extract/html.ts`
- Test: `tests/extract/html.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/extract/html.test.ts
import { describe, expect, it } from "vitest";
import { extractHtml } from "../../src/extract/html.ts";

const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<head><title>Test Page</title></head>
<body>
  <header><nav>Navigation</nav></header>
  <article>
    <h1>Main Article</h1>
    <p>This is the main content of the article. It has enough text to be considered
    meaningful content by Readability. The article discusses important topics that
    are relevant to the reader and provides valuable information about the subject
    matter at hand. We need sufficient content for Readability to consider this
    worth extracting.</p>
    <p>Another paragraph with more details about the topic. This adds depth to the
    article and ensures that the content meets the minimum threshold for extraction.
    Additional context helps the reader understand the full picture.</p>
    <table>
      <tr><th>Name</th><th>Value</th></tr>
      <tr><td>Alpha</td><td>100</td></tr>
    </table>
  </article>
  <script>alert('ignored')</script>
  <footer>Footer content</footer>
</body>
</html>`;

describe("extractHtml", () => {
  it("extracts article content as markdown", () => {
    const result = extractHtml(SAMPLE_HTML, "https://example.com/article");
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Main Article");
    expect(result!.text).toContain("main content");
  });

  it("strips script and style tags", () => {
    const result = extractHtml(SAMPLE_HTML, "https://example.com/article");
    expect(result).not.toBeNull();
    expect(result!.text).not.toContain("alert");
  });

  it("preserves tables as GFM markdown", () => {
    const result = extractHtml(SAMPLE_HTML, "https://example.com/article");
    expect(result).not.toBeNull();
    // GFM tables use pipe characters
    expect(result!.text).toContain("|");
    expect(result!.text).toContain("Alpha");
  });

  it("includes title when available", () => {
    const result = extractHtml(SAMPLE_HTML, "https://example.com/article");
    expect(result).not.toBeNull();
    expect(result!.title).toBeDefined();
  });

  it("returns null for content too short to be useful", () => {
    const thinHtml = "<html><body><p>Hi</p></body></html>";
    const result = extractHtml(thinHtml, "https://example.com");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/extract/html.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement HTML extraction**

```typescript
// src/extract/html.ts
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { gfm } from "@joplin/turndown-plugin-gfm";

const MIN_CONTENT_LENGTH = 500;

export interface HtmlExtractResult {
  text: string;
  title?: string;
}

export function extractHtml(
  html: string,
  _url: string,
): HtmlExtractResult | null {
  const { document } = parseHTML(html);

  // Strip non-content elements
  for (const tag of ["script", "style", "noscript"]) {
    for (const el of document.querySelectorAll(tag)) {
      el.remove();
    }
  }

  // Run Readability
  const reader = new Readability(document);
  const article = reader.parse();

  if (!article || !article.content) return null;

  // Convert HTML to Markdown
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  turndown.use(gfm);
  let markdown = turndown.turndown(article.content);

  // Normalize whitespace
  markdown = markdown.replace(/\n{3,}/g, "\n\n").trim();

  if (markdown.length < MIN_CONTENT_LENGTH) return null;

  return {
    text: markdown,
    title: article.title || undefined,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/extract/html.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extract/html.ts tests/extract/html.test.ts
git commit -m "feat: add HTML extraction via Readability + Turndown"
```

## Task 4.2: Extraction Pipeline Orchestrator

**Files:**
- Create: `src/extract/pipeline.ts`
- Test: `tests/extract/pipeline.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/extract/pipeline.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractContent } from "../../src/extract/pipeline.ts";
import { stubFetch } from "../helpers.ts";

const GOOD_HTML = `
<!DOCTYPE html><html><head><title>Article</title></head><body>
<article><h1>Real Article</h1>
<p>${"This is meaningful content about the topic. ".repeat(30)}</p>
</article></body></html>`;

describe("extractContent", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("extracts HTML content via Readability pipeline", async () => {
    fetchStub.addResponse("example.com/article", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    const result = await extractContent("https://example.com/article");
    expect(result.text).toContain("Real Article");
    expect(result.extractionChain).toContain("readability");
    expect(result.chars).toBeGreaterThan(0);
  });

  it("tracks extraction chain metadata", async () => {
    fetchStub.addResponse("example.com", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html" },
    });
    const result = await extractContent("https://example.com");
    expect(result.extractionChain.length).toBeGreaterThan(0);
    expect(result.url).toBe("https://example.com");
  });

  it("rejects non-http URLs via SSRF guard", async () => {
    await expect(extractContent("ftp://evil.com")).rejects.toThrow();
  });

  it("rejects private IPs", async () => {
    await expect(extractContent("http://127.0.0.1/admin")).rejects.toThrow();
  });

  it("rejects binary content types", async () => {
    fetchStub.addResponse("example.com/image.png", {
      body: "binary",
      headers: { "content-type": "image/png" },
    });
    await expect(
      extractContent("https://example.com/image.png"),
    ).rejects.toThrow(/binary/i);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/extract/pipeline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement extraction pipeline**

```typescript
// src/extract/pipeline.ts
import { validateUrl } from "../utils/ssrf.ts";
import { extractHtml } from "./html.ts";

export interface ExtractedContent {
  text: string;
  title?: string;
  url: string;
  extractionChain: string[];
  chars: number;
  truncated: boolean;
  contentId?: string;
}

const BINARY_CONTENT_TYPES = [
  "image/",
  "audio/",
  "video/",
  "application/zip",
  "application/gzip",
  "application/octet-stream",
];

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

export async function extractContent(
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedContent> {
  validateUrl(url);

  const chain: string[] = [];

  const response = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal,
    redirect: "follow",
  });

  chain.push(`http:${response.status}`);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  // Block binary content
  for (const prefix of BINARY_CONTENT_TYPES) {
    if (contentType.startsWith(prefix)) {
      throw new Error(`Unsupported binary content type: ${contentType}`);
    }
  }

  const body = await response.text();

  // Tier 1: Readability
  const htmlResult = extractHtml(body, url);
  if (htmlResult && htmlResult.text.length >= 500) {
    chain.push("readability");
    return {
      text: htmlResult.text,
      title: htmlResult.title,
      url,
      extractionChain: chain,
      chars: htmlResult.text.length,
      truncated: false,
    };
  }
  chain.push("readability:thin");

  // Fallback: return raw text (stripped of HTML if possible)
  chain.push("raw-text");
  const rawText = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (rawText.length === 0) {
    throw new Error(
      `Could not extract content from ${url}. Tried: ${chain.join(" -> ")}`,
    );
  }
  return {
    text: rawText,
    title: undefined,
    url,
    extractionChain: chain,
    chars: rawText.length,
    truncated: false,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/extract/pipeline.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extract/pipeline.ts tests/extract/pipeline.test.ts
git commit -m "feat: add extraction pipeline orchestrator with HTML tier"
```

## Task 4.3: web_fetch Tool

**Files:**
- Create: `src/tools/web-fetch.ts`
- Test: `tests/tools/web-fetch.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/tools/web-fetch.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWebFetchTool } from "../../src/tools/web-fetch.ts";
import { ContentStore } from "../../src/storage.ts";
import { makeCtx, stubFetch } from "../helpers.ts";

const GOOD_HTML = `
<!DOCTYPE html><html><head><title>Test</title></head><body>
<article><h1>Article Title</h1>
<p>${"Meaningful content about the topic. ".repeat(30)}</p>
</article></body></html>`;

describe("web_fetch tool", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct tool metadata", () => {
    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    expect(tool.name).toBe("web_fetch");
    expect(tool.label).toBe("Web Fetch");
  });

  it("fetches and extracts HTML content", async () => {
    fetchStub.addResponse("example.com/page", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-1",
      { url: "https://example.com/page" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Article Title");
  });

  it("stores large content and returns contentId", async () => {
    const largeContent = `
<!DOCTYPE html><html><head><title>Large</title></head><body>
<article><h1>Large Article</h1>
<p>${"A".repeat(20_000)}</p>
</article></body></html>`;

    fetchStub.addResponse("example.com/large", {
      body: largeContent,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-2",
      { url: "https://example.com/large" },
      undefined,
      undefined,
      ctx,
    );
    expect(result.details).toHaveProperty("contentId");
    expect(result.details.truncated).toBe(true);
  });

  it("returns error for SSRF violations", async () => {
    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-3",
      { url: "http://127.0.0.1/admin" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("error");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/tools/web-fetch.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement web_fetch tool**

```typescript
// src/tools/web-fetch.ts
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ContentStore } from "../storage.ts";
import { extractContent } from "../extract/pipeline.ts";
import { truncateContent } from "../utils/truncate.ts";
import { sanitizeError } from "../utils/errors.ts";

const INLINE_LIMIT = 15_000;

const WebFetchParams = Type.Object({
  url: Type.String({ description: "HTTP(S) URL to fetch" }),
});

interface WebFetchDetails {
  url: string;
  title?: string;
  chars: number;
  truncated: boolean;
  contentId?: string;
  extractionChain: string[];
}

export function createWebFetchTool(
  store: ContentStore,
): ToolDefinition<typeof WebFetchParams, WebFetchDetails> {
  return {
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a URL and extract readable content as markdown. Supports HTML, PDFs, and JS-rendered pages.",
    promptSnippet:
      "Fetch a URL and extract readable content as markdown. Supports HTML, PDFs, and JS-rendered pages.",
    promptGuidelines: [
      "Use web_fetch when you have a specific URL to read.",
      "For large pages, use web_read with the returned contentId to retrieve the full text.",
    ],
    parameters: WebFetchParams,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      try {
        const extracted = await extractContent(params.url, signal ?? undefined);

        let contentId: string | undefined;
        let outputText: string;
        let truncated = false;

        if (extracted.chars > INLINE_LIMIT) {
          contentId = store.store({
            url: extracted.url,
            title: extracted.title,
            text: extracted.text,
            source: "web_fetch",
          });
          const trunc = truncateContent(extracted.text, INLINE_LIMIT);
          outputText = trunc.text;
          truncated = true;
        } else {
          outputText = extracted.text;
        }

        const header = [
          extracted.title ? `# ${extracted.title}` : `# ${extracted.url}`,
          `Source: ${extracted.url}`,
          `Chars: ${extracted.chars}${truncated ? ` (truncated, use web_read with contentId "${contentId}" for full text)` : ""}`,
          "",
        ].join("\n");

        return {
          content: [{ type: "text" as const, text: header + outputText }],
          details: {
            url: extracted.url,
            title: extracted.title,
            chars: extracted.chars,
            truncated,
            contentId,
            extractionChain: extracted.extractionChain,
          },
        };
      } catch (error) {
        const msg = sanitizeError(error);
        return {
          content: [{ type: "text" as const, text: `Fetch error: ${msg}` }],
          details: {
            url: params.url,
            chars: 0,
            truncated: false,
            extractionChain: [],
          },
        };
      }
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/tools/web-fetch.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Wire into index.ts**

Add the `web-fetch` import and tool registration to `src/index.ts`. Do NOT replace the file — only add the two lines below to the existing code:

1. Add import after the existing `createWebSearchTool` import:
```typescript
import { createWebFetchTool } from "./tools/web-fetch.ts";
```

2. Add tool registration between the `web_search` and `web_read` registrations:
```typescript
  pi.registerTool(createWebFetchTool(store));
```

The resulting imports section should look like:
```typescript
import { createWebSearchTool } from "./tools/web-search.ts";
import { createWebFetchTool } from "./tools/web-fetch.ts";
import { createWebReadTool } from "./tools/web-read.ts";
```

And the registration block:
```typescript
  pi.registerTool(createWebSearchTool(resolveSearchProvider));
  pi.registerTool(createWebFetchTool(store));
  pi.registerTool(createWebReadTool(store));
```

- [ ] **Step 6: Update index test**

Add to `tests/index.test.ts`:

```typescript
  it("registers web_fetch tool", () => {
    const pi = createMockPi();
    createExtension(pi as any);
    expect(pi.tools.some((t) => t.name === "web_fetch")).toBe(true);
  });
```

- [ ] **Step 7: Run all tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add src/tools/web-fetch.ts src/index.ts tests/tools/web-fetch.test.ts tests/index.test.ts
git commit -m "feat: add web_fetch tool with HTML extraction pipeline"
```

## Phase 4 Checkpoint

Three tools are now functional: `web_search`, `web_fetch`, `web_read`. Agents can search the web, fetch page content as markdown, and retrieve large stored content.
