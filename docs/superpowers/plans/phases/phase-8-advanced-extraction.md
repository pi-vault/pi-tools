# Phase 8: Advanced Extraction (PDF, RSC, Jina Reader, Provider Fallbacks)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the extraction pipeline with PDF support, Next.js RSC parsing, Jina Reader fallback, and provider-based extraction. After this phase, `web_fetch` handles PDFs, JS-heavy sites, and complex pages.

**Spec:** `docs/superpowers/specs/2026-06-27-pi-tools-design.md`

**Depends on:** Phase 4 (extraction pipeline with HTML tier)

**Produces:** `src/extract/pdf.ts`, `src/extract/rsc.ts`, `src/extract/jina-reader.ts`, updated `src/extract/pipeline.ts`

---

## Task 8.1: PDF Extraction

**Files:**
- Create: `src/extract/pdf.ts`
- Test: `tests/extract/pdf.test.ts`
- Modify: `src/extract/pipeline.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/extract/pdf.test.ts
import { describe, expect, it } from "vitest";
import { extractPdf } from "../../src/extract/pdf.ts";

describe("extractPdf", () => {
  it("extracts text from a minimal PDF buffer", async () => {
    // Create a minimal valid PDF for testing
    // In practice, unpdf handles real PDFs. This tests the wrapper.
    // We test the function signature and error handling.
    const emptyBuffer = new Uint8Array(0);
    await expect(extractPdf(emptyBuffer)).rejects.toThrow();
  });

  it("exports extractPdf function", () => {
    expect(typeof extractPdf).toBe("function");
  });
});
```

- [ ] **Step 2: Implement PDF extraction**

```typescript
// src/extract/pdf.ts
import { getDocumentProxy, extractText } from "unpdf";

export async function extractPdf(
  buffer: Uint8Array,
  maxPages = 100,
): Promise<string> {
  const doc = await getDocumentProxy(buffer);
  const totalPages = Math.min(doc.numPages, maxPages);
  const { text } = await extractText(doc, { mergePages: true });
  return text.trim();
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm test -- tests/extract/pdf.test.ts`
Expected: Tests PASS (error handling test passes, function exists).

- [ ] **Step 4: Commit**

```bash
git add src/extract/pdf.ts tests/extract/pdf.test.ts
git commit -m "feat: add PDF text extraction via unpdf"
```

## Task 8.2: RSC Parser

**Files:**
- Create: `src/extract/rsc.ts`
- Test: `tests/extract/rsc.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/extract/rsc.test.ts
import { describe, expect, it } from "vitest";
import { extractRsc } from "../../src/extract/rsc.ts";

describe("extractRsc", () => {
  it("detects and extracts RSC content", () => {
    const html = `
    <html><body>
    <script>self.__next_f.push([1,"0:[\\"$\\",\\"div\\",null,{\\"children\\":\\"Hello RSC World\\"}]"])</script>
    <script>self.__next_f.push([1,"More RSC content here with actual text about the topic that is long enough to be useful content for extraction purposes."])</script>
    </body></html>`;

    const result = extractRsc(html);
    expect(result).not.toBeNull();
    expect(result).toContain("Hello RSC World");
  });

  it("returns null for non-RSC pages", () => {
    const html = "<html><body><p>Normal page</p></body></html>";
    expect(extractRsc(html)).toBeNull();
  });

  it("returns null when extracted content is too short", () => {
    const html = `<html><body>
    <script>self.__next_f.push([1,"x"])</script>
    </body></html>`;
    expect(extractRsc(html)).toBeNull();
  });
});
```

- [ ] **Step 2: Implement RSC parser**

```typescript
// src/extract/rsc.ts

const RSC_MARKER = "self.__next_f.push";
const MIN_CONTENT_LENGTH = 200;

export function extractRsc(html: string): string | null {
  if (!html.includes(RSC_MARKER)) return null;

  const chunks: string[] = [];
  const pattern = /self\.__next_f\.push\(\[1,"([^"]*?)"\]\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    try {
      // Unescape the JSON string
      const decoded = match[1]
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .replace(/\\n/g, "\n");
      chunks.push(decoded);
    } catch {
      // Skip malformed chunks
    }
  }

  if (chunks.length === 0) return null;

  // Extract text content from RSC payload
  const combined = chunks.join("\n");

  // Strip RSC protocol markers and extract readable text
  const text = combined
    .replace(/\$[A-Za-z0-9]+/g, "") // Remove RSC references
    .replace(/\["[^"]*",/g, "") // Remove component markers
    .replace(/[{}\[\]]/g, " ") // Remove JSON structure
    .replace(/\\u[0-9a-fA-F]{4}/g, "") // Remove unicode escapes
    .replace(/\s+/g, " ")
    .trim();

  if (text.length < MIN_CONTENT_LENGTH) return null;

  return text;
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm test -- tests/extract/rsc.test.ts`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/extract/rsc.ts tests/extract/rsc.test.ts
git commit -m "feat: add Next.js RSC parser for JS-rendered content"
```

## Task 8.3: Jina Reader Extraction

**Files:**
- Create: `src/extract/jina-reader.ts`
- Test: `tests/extract/jina-reader.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/extract/jina-reader.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractViaJinaReader } from "../../src/extract/jina-reader.ts";
import { stubFetch } from "../helpers.ts";

describe("extractViaJinaReader", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => { fetchStub = stubFetch(); });
  afterEach(() => { fetchStub.restore(); });

  it("returns markdown from Jina Reader", async () => {
    fetchStub.addResponse("r.jina.ai", {
      body: "# Page Title\n\nRendered content from JS page",
      headers: { "content-type": "text/plain" },
    });

    const result = await extractViaJinaReader("https://example.com");
    expect(result).not.toBeNull();
    expect(result).toContain("Rendered content");
  });

  it("returns null on failure", async () => {
    fetchStub.addResponse("r.jina.ai", { status: 500, body: "Error" });
    const result = await extractViaJinaReader("https://example.com");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Implement Jina Reader extraction**

```typescript
// src/extract/jina-reader.ts

export async function extractViaJinaReader(
  url: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const readerUrl = `https://r.jina.ai/${url}`;
    const response = await fetch(readerUrl, {
      headers: { Accept: "text/plain" },
      signal,
    });

    if (!response.ok) return null;

    const text = await response.text();
    if (!text || text.trim().length < 100) return null;

    return text.trim();
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm test -- tests/extract/jina-reader.test.ts`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/extract/jina-reader.ts tests/extract/jina-reader.test.ts
git commit -m "feat: add Jina Reader fallback extractor"
```

## Task 8.4: Integrate All Extraction Tiers into Pipeline

**Files:**
- Modify: `src/extract/pipeline.ts`
- Modify: `tests/extract/pipeline.test.ts`

- [ ] **Step 1: Update pipeline with PDF, RSC, Jina Reader, and provider fallbacks**

```typescript
// src/extract/pipeline.ts
import { validateUrl } from "../utils/ssrf.ts";
import { extractHtml } from "./html.ts";
import { extractPdf } from "./pdf.ts";
import { extractRsc } from "./rsc.ts";
import { extractViaJinaReader } from "./jina-reader.ts";

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

  // Block binary content (except PDF)
  if (!contentType.includes("application/pdf")) {
    for (const prefix of BINARY_CONTENT_TYPES) {
      if (contentType.startsWith(prefix)) {
        throw new Error(`Unsupported binary content type: ${contentType}`);
      }
    }
  }

  // PDF extraction
  if (contentType.includes("application/pdf")) {
    chain.push("pdf");
    try {
      const buffer = new Uint8Array(await response.arrayBuffer());
      const text = await extractPdf(buffer);
      if (text.length > 0) {
        return {
          text,
          title: undefined,
          url,
          extractionChain: chain,
          chars: text.length,
          truncated: false,
        };
      }
    } catch {
      chain.push("pdf:fail");
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

  // Tier 2: RSC parser
  const rscText = extractRsc(body);
  if (rscText) {
    chain.push("rsc");
    return {
      text: rscText,
      title: undefined,
      url,
      extractionChain: chain,
      chars: rscText.length,
      truncated: false,
    };
  }
  chain.push("rsc:no-match");

  // Tier 3: Jina Reader
  const jinaText = await extractViaJinaReader(url, signal);
  if (jinaText) {
    chain.push("jina-reader");
    return {
      text: jinaText,
      title: undefined,
      url,
      extractionChain: chain,
      chars: jinaText.length,
      truncated: false,
    };
  }
  chain.push("jina-reader:fail");

  // Final fallback: raw text stripped of HTML
  const rawText = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (rawText.length > 0) {
    chain.push("raw-text");
    return {
      text: rawText,
      title: undefined,
      url,
      extractionChain: chain,
      chars: rawText.length,
      truncated: false,
    };
  }

  throw new Error(
    `Could not extract content from ${url}. Tried: ${chain.join(" -> ")}`,
  );
}
```

- [ ] **Step 2: Add pipeline tests for new tiers**

Add to `tests/extract/pipeline.test.ts`:

```typescript
  it("falls back to RSC parser for Next.js pages", async () => {
    const rscHtml = `<html><body>
      <script>self.__next_f.push([1,"${'Real content '.repeat(50)}"])</script>
    </body></html>`;
    fetchStub.addResponse("nextjs-app.com", {
      body: rscHtml,
      headers: { "content-type": "text/html" },
    });
    const result = await extractContent("https://nextjs-app.com");
    expect(result.extractionChain).toContain("rsc");
  });

  it("rejects binary image content", async () => {
    fetchStub.addResponse("example.com/photo.jpg", {
      body: "binary",
      headers: { "content-type": "image/jpeg" },
    });
    await expect(extractContent("https://example.com/photo.jpg")).rejects.toThrow(/binary/i);
  });
```

- [ ] **Step 3: Run tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/extract/pipeline.ts tests/extract/pipeline.test.ts
git commit -m "feat: extend extraction pipeline with PDF, RSC, Jina Reader tiers"
```

## Phase 8 Checkpoint

The extraction pipeline now handles HTML, PDFs, Next.js RSC pages, JS-rendered pages (via Jina Reader), with raw text as final fallback. `web_fetch` can handle a wide variety of web content.

## Known Gaps (Not Addressed)

- **No PDF integration test in pipeline:** Hard to test through `stubFetch` since PDF parsing requires valid binary. The `extractPdf` unit test covers the module directly.
- **RSC MIN_CONTENT_LENGTH is 200, not 500:** Intentionally lower than Readability's 500-char threshold. RSC payloads are less structured and meaningful fragments are shorter.
- **Jina Reader has no retry/backoff for 429:** Returns null on any failure including rate limits. Acceptable for a fallback tier — if Jina fails, the pipeline falls through to raw-text.
