# Phase 5: GitHub URL Interception — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Intercept GitHub repository URLs in web_fetch to return actual file content instead of scraped HTML, using raw URL rewrite, clone cache, and API fallback.

**Architecture:** New `src/extract/github.ts` module with URL parser, three-tier fetch strategy (raw rewrite -> clone cache -> API fallback), binary detection, and config. Integrated as first check in `extractContent()` pipeline.

**Tech Stack:** TypeScript, Vitest, Node.js child_process for git, GitHub REST API.

---

### Task 1: GitHub URL parser

**Files:**
- Create: `src/extract/github.ts`
- Create: `tests/extract/github.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/extract/github.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseGitHubUrl } from "../../src/extract/github.ts";

describe("parseGitHubUrl", () => {
  describe("root URLs", () => {
    it("parses github.com/{owner}/{repo}", () => {
      const result = parseGitHubUrl("https://github.com/facebook/react");
      expect(result).toEqual({
        owner: "facebook",
        repo: "react",
        ref: undefined,
        path: undefined,
        type: "root",
      });
    });

    it("parses root URL with trailing slash", () => {
      const result = parseGitHubUrl("https://github.com/facebook/react/");
      expect(result).toEqual({
        owner: "facebook",
        repo: "react",
        ref: undefined,
        path: undefined,
        type: "root",
      });
    });
  });

  describe("tree URLs", () => {
    it("parses tree URL with ref only", () => {
      const result = parseGitHubUrl(
        "https://github.com/facebook/react/tree/main",
      );
      expect(result).toEqual({
        owner: "facebook",
        repo: "react",
        ref: "main",
        path: undefined,
        type: "tree",
      });
    });

    it("parses tree URL with ref and path", () => {
      const result = parseGitHubUrl(
        "https://github.com/facebook/react/tree/main/packages/react",
      );
      expect(result).toEqual({
        owner: "facebook",
        repo: "react",
        ref: "main",
        path: "packages/react",
        type: "tree",
      });
    });

    it("handles refs with slashes (tag-like)", () => {
      const result = parseGitHubUrl(
        "https://github.com/owner/repo/tree/v1.0.0/src",
      );
      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
        ref: "v1.0.0",
        path: "src",
        type: "tree",
      });
    });
  });

  describe("blob URLs", () => {
    it("parses blob URL", () => {
      const result = parseGitHubUrl(
        "https://github.com/facebook/react/blob/main/README.md",
      );
      expect(result).toEqual({
        owner: "facebook",
        repo: "react",
        ref: "main",
        path: "README.md",
        type: "blob",
      });
    });

    it("parses blob URL with deep path", () => {
      const result = parseGitHubUrl(
        "https://github.com/facebook/react/blob/main/packages/react/src/React.js",
      );
      expect(result).toEqual({
        owner: "facebook",
        repo: "react",
        ref: "main",
        path: "packages/react/src/React.js",
        type: "blob",
      });
    });

    it("parses blob URL with commit SHA ref", () => {
      const result = parseGitHubUrl(
        "https://github.com/facebook/react/blob/abc123def/README.md",
      );
      expect(result).toEqual({
        owner: "facebook",
        repo: "react",
        ref: "abc123def",
        path: "README.md",
        type: "blob",
      });
    });
  });

  describe("raw URLs", () => {
    it("parses raw.githubusercontent.com URL", () => {
      const result = parseGitHubUrl(
        "https://raw.githubusercontent.com/facebook/react/main/README.md",
      );
      expect(result).toEqual({
        owner: "facebook",
        repo: "react",
        ref: "main",
        path: "README.md",
        type: "raw",
      });
    });

    it("parses raw URL with deep path", () => {
      const result = parseGitHubUrl(
        "https://raw.githubusercontent.com/facebook/react/main/packages/react/package.json",
      );
      expect(result).toEqual({
        owner: "facebook",
        repo: "react",
        ref: "main",
        path: "packages/react/package.json",
        type: "raw",
      });
    });
  });

  describe("non-content URLs (unknown type)", () => {
    it("returns unknown for issues URL", () => {
      const result = parseGitHubUrl(
        "https://github.com/facebook/react/issues/123",
      );
      expect(result).toEqual({
        owner: "facebook",
        repo: "react",
        ref: undefined,
        path: undefined,
        type: "unknown",
      });
    });

    it("returns unknown for pull request URL", () => {
      const result = parseGitHubUrl(
        "https://github.com/facebook/react/pull/456",
      );
      expect(result).toEqual({
        owner: "facebook",
        repo: "react",
        ref: undefined,
        path: undefined,
        type: "unknown",
      });
    });

    it("returns unknown for actions URL", () => {
      const result = parseGitHubUrl(
        "https://github.com/facebook/react/actions",
      );
      expect(result).toEqual({
        owner: "facebook",
        repo: "react",
        ref: undefined,
        path: undefined,
        type: "unknown",
      });
    });

    it("returns unknown for wiki URL", () => {
      const result = parseGitHubUrl(
        "https://github.com/facebook/react/wiki",
      );
      expect(result).toEqual({
        owner: "facebook",
        repo: "react",
        ref: undefined,
        path: undefined,
        type: "unknown",
      });
    });

    it("returns unknown for settings URL", () => {
      const result = parseGitHubUrl(
        "https://github.com/facebook/react/settings",
      );
      expect(result).toEqual({
        owner: "facebook",
        repo: "react",
        ref: undefined,
        path: undefined,
        type: "unknown",
      });
    });

    it("returns unknown for discussions URL", () => {
      const result = parseGitHubUrl(
        "https://github.com/facebook/react/discussions",
      );
      expect(result).toEqual({
        owner: "facebook",
        repo: "react",
        ref: undefined,
        path: undefined,
        type: "unknown",
      });
    });

    it("returns unknown for releases URL", () => {
      const result = parseGitHubUrl(
        "https://github.com/facebook/react/releases",
      );
      expect(result).toEqual({
        owner: "facebook",
        repo: "react",
        ref: undefined,
        path: undefined,
        type: "unknown",
      });
    });

    it("returns unknown for compare URL", () => {
      const result = parseGitHubUrl(
        "https://github.com/facebook/react/compare/main...dev",
      );
      expect(result).toEqual({
        owner: "facebook",
        repo: "react",
        ref: undefined,
        path: undefined,
        type: "unknown",
      });
    });

    it("returns unknown for commits URL", () => {
      const result = parseGitHubUrl(
        "https://github.com/facebook/react/commits/main",
      );
      expect(result).toEqual({
        owner: "facebook",
        repo: "react",
        ref: undefined,
        path: undefined,
        type: "unknown",
      });
    });
  });

  describe("non-GitHub URLs", () => {
    it("returns null for non-GitHub URL", () => {
      const result = parseGitHubUrl("https://example.com/foo/bar");
      expect(result).toBeNull();
    });

    it("returns null for GitHub profile URL (no repo)", () => {
      const result = parseGitHubUrl("https://github.com/facebook");
      expect(result).toBeNull();
    });

    it("returns null for github.com root", () => {
      const result = parseGitHubUrl("https://github.com");
      expect(result).toBeNull();
    });

    it("returns null for github.com with only slash", () => {
      const result = parseGitHubUrl("https://github.com/");
      expect(result).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/extract/github.test.ts`
Expected: FAIL -- `parseGitHubUrl` is not exported from `src/extract/github.ts`

- [ ] **Step 3: Implement `parseGitHubUrl`**

Create `src/extract/github.ts`:

```ts
export interface GitHubUrl {
  owner: string;
  repo: string;
  ref?: string;
  path?: string;
  type: "tree" | "blob" | "root" | "raw" | "unknown";
}

const NON_CONTENT_SEGMENTS = new Set([
  "issues",
  "pull",
  "pulls",
  "actions",
  "wiki",
  "settings",
  "discussions",
  "releases",
  "compare",
  "commits",
  "commit",
  "graphs",
  "network",
  "projects",
  "security",
  "packages",
  "stargazers",
  "watchers",
  "tags",
  "labels",
  "milestones",
  "archive",
  "codespaces",
  "deployments",
  "environments",
  "forks",
  "invitations",
]);

/**
 * Parse a GitHub URL into structured components.
 * Returns null if the URL is not a GitHub URL or lacks an owner/repo pair.
 * Returns type "unknown" for non-content pages (issues, PRs, etc.) that
 * should fall through to the normal extraction pipeline.
 */
export function parseGitHubUrl(url: string): GitHubUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // raw.githubusercontent.com/{owner}/{repo}/{ref}/{path...}
  if (parsed.hostname === "raw.githubusercontent.com") {
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 3) return null;
    const [owner, repo, ref, ...rest] = segments;
    return {
      owner,
      repo,
      ref,
      path: rest.length > 0 ? rest.join("/") : undefined,
      type: "raw",
    };
  }

  // Only handle github.com
  if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);

  // Need at least owner/repo
  if (segments.length < 2) return null;

  const [owner, repo, action, ref, ...rest] = segments;

  // No action segment -> root
  if (!action) {
    return { owner, repo, ref: undefined, path: undefined, type: "root" };
  }

  // Content URL types
  if (action === "tree") {
    return {
      owner,
      repo,
      ref: ref ?? undefined,
      path: rest.length > 0 ? rest.join("/") : undefined,
      type: "tree",
    };
  }

  if (action === "blob") {
    return {
      owner,
      repo,
      ref: ref ?? undefined,
      path: rest.length > 0 ? rest.join("/") : undefined,
      type: "blob",
    };
  }

  // Non-content URL types
  if (NON_CONTENT_SEGMENTS.has(action)) {
    return { owner, repo, ref: undefined, path: undefined, type: "unknown" };
  }

  // Any other action segment we don't recognize -> unknown
  return { owner, repo, ref: undefined, path: undefined, type: "unknown" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/extract/github.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/extract/github.ts tests/extract/github.test.ts
git commit -m "feat(github): add GitHub URL parser with type classification"
```

---

### Task 2: Binary file detection utility

**Files:**
- Modify: `src/extract/github.ts`
- Modify: `tests/extract/github.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/extract/github.test.ts`:

```ts
import { parseGitHubUrl, isBinaryFile } from "../../src/extract/github.ts";

describe("isBinaryFile", () => {
  describe("extension-based detection", () => {
    it("detects common image extensions", () => {
      expect(isBinaryFile("photo.png")).toBe(true);
      expect(isBinaryFile("photo.jpg")).toBe(true);
      expect(isBinaryFile("photo.jpeg")).toBe(true);
      expect(isBinaryFile("icon.gif")).toBe(true);
      expect(isBinaryFile("icon.ico")).toBe(true);
      expect(isBinaryFile("image.webp")).toBe(true);
      expect(isBinaryFile("image.svg")).toBe(false);
    });

    it("detects font extensions", () => {
      expect(isBinaryFile("font.woff")).toBe(true);
      expect(isBinaryFile("font.woff2")).toBe(true);
      expect(isBinaryFile("font.ttf")).toBe(true);
      expect(isBinaryFile("font.eot")).toBe(true);
      expect(isBinaryFile("font.otf")).toBe(true);
    });

    it("detects archive extensions", () => {
      expect(isBinaryFile("bundle.zip")).toBe(true);
      expect(isBinaryFile("archive.tar")).toBe(true);
      expect(isBinaryFile("compressed.gz")).toBe(true);
      expect(isBinaryFile("archive.tar.gz")).toBe(true);
      expect(isBinaryFile("package.tgz")).toBe(true);
    });

    it("detects compiled/native extensions", () => {
      expect(isBinaryFile("app.exe")).toBe(true);
      expect(isBinaryFile("lib.dll")).toBe(true);
      expect(isBinaryFile("lib.so")).toBe(true);
      expect(isBinaryFile("lib.dylib")).toBe(true);
      expect(isBinaryFile("module.o")).toBe(true);
      expect(isBinaryFile("App.class")).toBe(true);
      expect(isBinaryFile("module.pyc")).toBe(true);
      expect(isBinaryFile("module.wasm")).toBe(true);
    });

    it("does not flag text file extensions", () => {
      expect(isBinaryFile("README.md")).toBe(false);
      expect(isBinaryFile("index.ts")).toBe(false);
      expect(isBinaryFile("config.json")).toBe(false);
      expect(isBinaryFile("style.css")).toBe(false);
      expect(isBinaryFile("Makefile")).toBe(false);
      expect(isBinaryFile("LICENSE")).toBe(false);
    });

    it("handles paths with directories", () => {
      expect(isBinaryFile("src/assets/logo.png")).toBe(true);
      expect(isBinaryFile("src/index.ts")).toBe(false);
    });

    it("is case-insensitive for extensions", () => {
      expect(isBinaryFile("image.PNG")).toBe(true);
      expect(isBinaryFile("archive.ZIP")).toBe(true);
    });
  });

  describe("content-based detection", () => {
    it("detects null bytes in content", () => {
      const buf = Buffer.from("hello\x00world");
      expect(isBinaryFile("unknown-file", buf)).toBe(true);
    });

    it("does not flag clean text content", () => {
      const buf = Buffer.from("hello world\nthis is text");
      expect(isBinaryFile("unknown-file", buf)).toBe(false);
    });

    it("checks only the first 8KB of content", () => {
      const text = Buffer.alloc(16_384, 0x41); // 16KB of 'A'
      text[10_000] = 0x00; // null byte after 8KB boundary
      expect(isBinaryFile("unknown-file", text)).toBe(false);
    });

    it("detects null byte within first 8KB", () => {
      const text = Buffer.alloc(16_384, 0x41);
      text[4_000] = 0x00; // null byte within 8KB
      expect(isBinaryFile("unknown-file", text)).toBe(true);
    });

    it("extension takes priority over content", () => {
      const textBuf = Buffer.from("this is text");
      expect(isBinaryFile("image.png", textBuf)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/extract/github.test.ts`
Expected: FAIL -- `isBinaryFile` is not exported from `src/extract/github.ts`

- [ ] **Step 3: Implement `isBinaryFile`**

Add to `src/extract/github.ts`, after the `parseGitHubUrl` function:

```ts
const BINARY_EXTENSIONS = new Set([
  // Images
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".bmp", ".tiff", ".tif",
  // Fonts
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  // Archives
  ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar",
  // Compiled / native
  ".exe", ".dll", ".so", ".dylib", ".o", ".a", ".lib",
  ".class", ".pyc", ".pyo", ".wasm",
  // Media
  ".mp3", ".mp4", ".wav", ".avi", ".mov", ".flac", ".ogg", ".webm",
  // Databases
  ".sqlite", ".db",
  // Documents (binary)
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
]);

const BINARY_CHECK_SIZE = 8 * 1024; // 8KB

/**
 * Check if a file is binary based on its extension and optionally its content.
 * Extension check runs first; content check (null-byte scan in first 8KB)
 * runs only if extension is inconclusive and a buffer is provided.
 */
export function isBinaryFile(path: string, content?: Buffer): boolean {
  // Extension-based check
  const lastDot = path.lastIndexOf(".");
  if (lastDot !== -1) {
    const ext = path.slice(lastDot).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) return true;
  }

  // Content-based check: scan first 8KB for null bytes
  if (content) {
    const scanLength = Math.min(content.length, BINARY_CHECK_SIZE);
    for (let i = 0; i < scanLength; i++) {
      if (content[i] === 0x00) return true;
    }
  }

  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/extract/github.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/extract/github.ts tests/extract/github.test.ts
git commit -m "feat(github): add binary file detection utility"
```

---

### Task 3: Tier 1 -- Raw URL rewrite (blob URLs)

**Files:**
- Modify: `src/extract/github.ts`
- Modify: `tests/extract/github.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/extract/github.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseGitHubUrl,
  isBinaryFile,
  fetchRaw,
} from "../../src/extract/github.ts";
import { stubFetch } from "../helpers.ts";

describe("fetchRaw", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("rewrites blob URL to raw.githubusercontent.com and fetches content", async () => {
    fetchStub.addResponse(
      "raw.githubusercontent.com/facebook/react/main/README.md",
      {
        body: "# React\n\nA JavaScript library for building UIs.",
        headers: { "content-type": "text/plain" },
      },
    );

    const parsed = parseGitHubUrl(
      "https://github.com/facebook/react/blob/main/README.md",
    )!;
    const result = await fetchRaw(parsed);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("React");
    expect(result!.extractionChain).toContain("github:raw");
  });

  it("returns null for non-blob URLs", async () => {
    const parsed = parseGitHubUrl("https://github.com/facebook/react")!;
    const result = await fetchRaw(parsed);
    expect(result).toBeNull();
  });

  it("returns null when raw fetch fails (non-2xx)", async () => {
    fetchStub.addResponse(
      "raw.githubusercontent.com/facebook/react/main/missing.md",
      { status: 404, body: "Not Found" },
    );

    const parsed = parseGitHubUrl(
      "https://github.com/facebook/react/blob/main/missing.md",
    )!;
    const result = await fetchRaw(parsed);
    expect(result).toBeNull();
  });

  it("truncates content at 100,000 chars", async () => {
    const longContent = "x".repeat(150_000);
    fetchStub.addResponse(
      "raw.githubusercontent.com/owner/repo/main/big.txt",
      {
        body: longContent,
        headers: { "content-type": "text/plain" },
      },
    );

    const parsed = parseGitHubUrl(
      "https://github.com/owner/repo/blob/main/big.txt",
    )!;
    const result = await fetchRaw(parsed);
    expect(result).not.toBeNull();
    expect(result!.chars).toBe(150_000);
    expect(result!.truncated).toBe(true);
    expect(result!.text.length).toBeLessThanOrEqual(100_000);
  });

  it("returns binary placeholder for binary files", async () => {
    fetchStub.addResponse(
      "raw.githubusercontent.com/owner/repo/main/logo.png",
      {
        body: "fake-binary-data",
        headers: { "content-type": "image/png" },
      },
    );

    const parsed = parseGitHubUrl(
      "https://github.com/owner/repo/blob/main/logo.png",
    )!;
    const result = await fetchRaw(parsed);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Binary file");
    expect(result!.text).toContain("logo.png");
  });

  it("handles raw.githubusercontent.com URLs directly", async () => {
    fetchStub.addResponse(
      "raw.githubusercontent.com/facebook/react/main/README.md",
      {
        body: "# React\n\nContent here.",
        headers: { "content-type": "text/plain" },
      },
    );

    const parsed = parseGitHubUrl(
      "https://raw.githubusercontent.com/facebook/react/main/README.md",
    )!;
    const result = await fetchRaw(parsed);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("React");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/extract/github.test.ts`
Expected: FAIL -- `fetchRaw` is not exported from `src/extract/github.ts`

- [ ] **Step 3: Implement `fetchRaw`**

Add to `src/extract/github.ts`:

```ts
import type { ExtractedContent } from "./pipeline.ts";

const RAW_CONTENT_LIMIT = 100_000;

/**
 * Tier 1: Rewrite a blob (or raw) URL to raw.githubusercontent.com and
 * fetch the file content directly.
 * Returns null if the URL type is not blob/raw or the fetch fails.
 */
export async function fetchRaw(
  parsed: GitHubUrl,
  signal?: AbortSignal,
): Promise<ExtractedContent | null> {
  if (parsed.type !== "blob" && parsed.type !== "raw") return null;
  if (!parsed.ref || !parsed.path) return null;

  // Binary check by extension before fetching
  if (isBinaryFile(parsed.path)) {
    const url = `https://github.com/${parsed.owner}/${parsed.repo}/blob/${parsed.ref}/${parsed.path}`;
    return {
      text: `Binary file: ${parsed.path}`,
      title: `${parsed.owner}/${parsed.repo} - ${parsed.path}`,
      url,
      extractionChain: ["github:raw", "binary-skip"],
      chars: 0,
      truncated: false,
    };
  }

  const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${parsed.ref}/${parsed.path}`;

  let response: Response;
  try {
    response = await fetch(rawUrl, { signal });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const text = await response.text();
  const originalUrl = `https://github.com/${parsed.owner}/${parsed.repo}/blob/${parsed.ref}/${parsed.path}`;
  const totalChars = text.length;

  let outputText = text;
  let truncated = false;
  if (totalChars > RAW_CONTENT_LIMIT) {
    outputText =
      text.slice(0, RAW_CONTENT_LIMIT) +
      `\n\n[truncated] showing ${RAW_CONTENT_LIMIT.toLocaleString()} of ${totalChars.toLocaleString()} chars`;
    truncated = true;
  }

  return {
    text: outputText,
    title: `${parsed.owner}/${parsed.repo} - ${parsed.path}`,
    url: originalUrl,
    extractionChain: ["github:raw"],
    chars: totalChars,
    truncated,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/extract/github.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/extract/github.ts tests/extract/github.test.ts
git commit -m "feat(github): add Tier 1 raw URL rewrite for blob fetching"
```

---

### Task 4: Tier 3 -- GitHub API fallback

Tier 3 is implemented before Tier 2 because it is simpler (no git dependency) and provides a good fallback to test against.

**Files:**
- Modify: `src/extract/github.ts`
- Modify: `tests/extract/github.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/extract/github.test.ts`:

```ts
import {
  parseGitHubUrl,
  isBinaryFile,
  fetchRaw,
  fetchViaApi,
} from "../../src/extract/github.ts";

describe("fetchViaApi", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("fetches file content via /contents/ endpoint (base64 response)", async () => {
    const content = Buffer.from("# Hello World\n\nSome content.").toString(
      "base64",
    );
    fetchStub.addResponse(
      "api.github.com/repos/owner/repo/contents/README.md",
      {
        body: {
          type: "file",
          name: "README.md",
          content,
          encoding: "base64",
          size: 28,
        },
        headers: { "content-type": "application/json" },
      },
    );

    const parsed = parseGitHubUrl(
      "https://github.com/owner/repo/blob/main/README.md",
    )!;
    const result = await fetchViaApi(parsed);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Hello World");
    expect(result!.extractionChain).toContain("github:api");
  });

  it("fetches directory listing via /contents/ endpoint", async () => {
    fetchStub.addResponse(
      "api.github.com/repos/owner/repo/contents/src",
      {
        body: [
          { name: "index.ts", type: "file", size: 1200 },
          { name: "utils", type: "dir", size: 0 },
          { name: "config.ts", type: "file", size: 450 },
        ],
        headers: { "content-type": "application/json" },
      },
    );

    const parsed = parseGitHubUrl(
      "https://github.com/owner/repo/tree/main/src",
    )!;
    const result = await fetchViaApi(parsed);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("index.ts");
    expect(result!.text).toContain("utils/");
    expect(result!.text).toContain("config.ts");
  });

  it("fetches root tree listing for root URLs", async () => {
    fetchStub.addResponse(
      "api.github.com/repos/owner/repo/contents/",
      {
        body: [
          { name: "README.md", type: "file", size: 5000 },
          { name: "src", type: "dir", size: 0 },
          { name: "package.json", type: "file", size: 800 },
        ],
        headers: { "content-type": "application/json" },
      },
    );

    const parsed = parseGitHubUrl("https://github.com/owner/repo")!;
    const result = await fetchViaApi(parsed);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("README.md");
    expect(result!.text).toContain("src/");
  });

  it("returns null on API error (rate limited)", async () => {
    fetchStub.addResponse(
      "api.github.com/repos/owner/repo/contents/README.md",
      {
        status: 403,
        body: { message: "API rate limit exceeded" },
        headers: { "content-type": "application/json" },
      },
    );

    const parsed = parseGitHubUrl(
      "https://github.com/owner/repo/blob/main/README.md",
    )!;
    const result = await fetchViaApi(parsed);
    expect(result).toBeNull();
  });

  it("returns binary placeholder for binary files", async () => {
    const content = Buffer.from("\x00\x01\x02binary").toString("base64");
    fetchStub.addResponse(
      "api.github.com/repos/owner/repo/contents/image.png",
      {
        body: {
          type: "file",
          name: "image.png",
          content,
          encoding: "base64",
          size: 10240,
        },
        headers: { "content-type": "application/json" },
      },
    );

    const parsed = parseGitHubUrl(
      "https://github.com/owner/repo/blob/main/image.png",
    )!;
    const result = await fetchViaApi(parsed);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Binary file");
    expect(result!.text).toContain("image.png");
  });

  it("uses GITHUB_TOKEN header when env var is set", async () => {
    process.env.GITHUB_TOKEN = "ghp_test123";

    fetchStub.addResponse(
      "api.github.com/repos/owner/repo/contents/README.md",
      {
        body: {
          type: "file",
          name: "README.md",
          content: Buffer.from("# Auth Test").toString("base64"),
          encoding: "base64",
          size: 11,
        },
        headers: { "content-type": "application/json" },
      },
    );

    const parsed = parseGitHubUrl(
      "https://github.com/owner/repo/blob/main/README.md",
    )!;
    await fetchViaApi(parsed);

    // Verify the token was sent (check the mock's call args)
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    const headers = lastCall[1]?.headers as Record<string, string>;
    expect(headers?.Authorization).toBe("Bearer ghp_test123");

    delete process.env.GITHUB_TOKEN;
  });

  it("caps directory listing at 200 entries", async () => {
    const entries = Array.from({ length: 300 }, (_, i) => ({
      name: `file-${i}.ts`,
      type: "file",
      size: 100,
    }));
    fetchStub.addResponse("api.github.com/repos/owner/repo/contents/src", {
      body: entries,
      headers: { "content-type": "application/json" },
    });

    const parsed = parseGitHubUrl(
      "https://github.com/owner/repo/tree/main/src",
    )!;
    const result = await fetchViaApi(parsed);
    expect(result).not.toBeNull();
    // Count the number of file entries in the output
    const fileLines = result!.text
      .split("\n")
      .filter((line) => line.match(/^\s*([\u{1F4C4}\u{1F4C1}]|file-)/u));
    expect(fileLines.length).toBeLessThanOrEqual(200);
    expect(result!.text).toContain("truncated");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/extract/github.test.ts`
Expected: FAIL -- `fetchViaApi` is not exported from `src/extract/github.ts`

- [ ] **Step 3: Implement `fetchViaApi`**

Add to `src/extract/github.ts`:

```ts
const MAX_DIR_ENTRIES = 200;

interface GitHubApiHeaders {
  Accept: string;
  "User-Agent": string;
  Authorization?: string;
}

function apiHeaders(): GitHubApiHeaders {
  const headers: GitHubApiHeaders = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "pi-tools",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

interface GitHubContentsFile {
  type: "file";
  name: string;
  content: string;
  encoding: string;
  size: number;
}

interface GitHubContentsDir {
  name: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size: number;
}

/**
 * Tier 3: Fetch content via the GitHub REST API.
 * Uses /repos/{owner}/{repo}/contents/{path} endpoints.
 * Returns null on API errors (rate limiting, auth, etc.).
 */
export async function fetchViaApi(
  parsed: GitHubUrl,
  signal?: AbortSignal,
): Promise<ExtractedContent | null> {
  const headers = apiHeaders();
  const refParam = parsed.ref ? `?ref=${encodeURIComponent(parsed.ref)}` : "";
  const originalUrl = buildOriginalUrl(parsed);

  if (parsed.type === "blob" || parsed.type === "raw") {
    // Fetch single file
    if (!parsed.path) return null;

    const apiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${parsed.path}${refParam}`;

    let response: Response;
    try {
      response = await fetch(apiUrl, { headers, signal });
    } catch {
      return null;
    }

    if (!response.ok) return null;

    const data = (await response.json()) as GitHubContentsFile;
    if (data.type !== "file") return null;

    // Binary check by extension
    if (isBinaryFile(parsed.path)) {
      return {
        text: `Binary file: ${parsed.path} (${data.size} bytes)`,
        title: `${parsed.owner}/${parsed.repo} - ${parsed.path}`,
        url: originalUrl,
        extractionChain: ["github:api", "binary-skip"],
        chars: 0,
        truncated: false,
      };
    }

    // Decode base64 content
    const rawContent = Buffer.from(data.content, "base64");

    // Binary check by content
    if (isBinaryFile(parsed.path, rawContent)) {
      return {
        text: `Binary file: ${parsed.path} (${data.size} bytes)`,
        title: `${parsed.owner}/${parsed.repo} - ${parsed.path}`,
        url: originalUrl,
        extractionChain: ["github:api", "binary-skip"],
        chars: 0,
        truncated: false,
      };
    }

    const text = rawContent.toString("utf-8");
    let outputText = text;
    let truncated = false;
    if (text.length > RAW_CONTENT_LIMIT) {
      outputText =
        text.slice(0, RAW_CONTENT_LIMIT) +
        `\n\n[truncated] showing ${RAW_CONTENT_LIMIT.toLocaleString()} of ${text.length.toLocaleString()} chars`;
      truncated = true;
    }

    return {
      text: outputText,
      title: `${parsed.owner}/${parsed.repo} - ${parsed.path}`,
      url: originalUrl,
      extractionChain: ["github:api"],
      chars: text.length,
      truncated,
    };
  }

  // Root or tree -- fetch directory listing
  const dirPath = parsed.path ?? "";
  const apiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${dirPath}${refParam}`;

  let response: Response;
  try {
    response = await fetch(apiUrl, { headers, signal });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const data = (await response.json()) as GitHubContentsDir[];
  if (!Array.isArray(data)) return null;

  const listing = formatDirListing(data, parsed);

  return {
    text: listing,
    title: `${parsed.owner}/${parsed.repo}${dirPath ? ` - ${dirPath}` : ""}`,
    url: originalUrl,
    extractionChain: ["github:api"],
    chars: listing.length,
    truncated: false,
  };
}

function formatDirListing(
  entries: GitHubContentsDir[],
  parsed: GitHubUrl,
): string {
  const truncated = entries.length > MAX_DIR_ENTRIES;
  const visible = entries.slice(0, MAX_DIR_ENTRIES);

  const lines: string[] = [];
  const pathLabel = parsed.path ?? "";
  const ref = parsed.ref ?? "HEAD";
  lines.push(
    `# ${parsed.owner}/${parsed.repo}${pathLabel ? `/${pathLabel}` : ""} (${ref})`,
  );
  lines.push("");

  // Separate dirs and files
  const dirs = visible.filter((e) => e.type === "dir");
  const files = visible.filter((e) => e.type !== "dir");

  for (const dir of dirs) {
    lines.push(`  ${dir.name}/`);
  }
  for (const file of files) {
    const size = file.size > 0 ? ` (${formatSize(file.size)})` : "";
    lines.push(`  ${file.name}${size}`);
  }

  if (truncated) {
    lines.push("");
    lines.push(
      `[truncated] showing ${MAX_DIR_ENTRIES} of ${entries.length} entries`,
    );
  }

  return lines.join("\n");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildOriginalUrl(parsed: GitHubUrl): string {
  const base = `https://github.com/${parsed.owner}/${parsed.repo}`;
  if (parsed.type === "root") return base;
  if (parsed.type === "raw" && parsed.ref && parsed.path) {
    return `${base}/blob/${parsed.ref}/${parsed.path}`;
  }
  const action = parsed.type === "blob" ? "blob" : "tree";
  if (parsed.ref && parsed.path) return `${base}/${action}/${parsed.ref}/${parsed.path}`;
  if (parsed.ref) return `${base}/${action}/${parsed.ref}`;
  return base;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/extract/github.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/extract/github.ts tests/extract/github.test.ts
git commit -m "feat(github): add Tier 3 GitHub API fallback for file and directory content"
```

---

### Task 5: Tier 2 -- Clone cache

**Files:**
- Modify: `src/extract/github.ts`
- Modify: `tests/extract/github.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/extract/github.test.ts`:

```ts
import { vi, type Mock } from "vitest";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  parseGitHubUrl,
  fetchViaClone,
  _resetCloneCache,
} from "../../src/extract/github.ts";
import type { GitHubConfig } from "../../src/extract/github.ts";

describe("fetchViaClone", () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  const testCacheDir = path.join(os.tmpdir(), "pi-tools-github-cache-test");

  beforeEach(() => {
    fetchStub = stubFetch();
    _resetCloneCache();
    // Clean up test cache dir
    fs.rmSync(testCacheDir, { recursive: true, force: true });
  });

  afterEach(() => {
    fetchStub.restore();
    fs.rmSync(testCacheDir, { recursive: true, force: true });
  });

  it("returns null for unknown URL types", async () => {
    const parsed = parseGitHubUrl(
      "https://github.com/owner/repo/issues/123",
    )!;
    const result = await fetchViaClone(parsed);
    expect(result).toBeNull();
  });

  it("skips clone when repo size exceeds maxRepoSizeMB", async () => {
    // Mock the repo size API response (size is in KB)
    fetchStub.addResponse("api.github.com/repos/huge/repo", {
      body: { size: 400 * 1024 }, // 400 MB in KB
      headers: { "content-type": "application/json" },
    });

    const parsed = parseGitHubUrl("https://github.com/huge/repo")!;
    const config: GitHubConfig = {
      enabled: true,
      maxRepoSizeMB: 350,
      cloneTimeoutSeconds: 30,
    };
    const result = await fetchViaClone(parsed, undefined, config);
    expect(result).toBeNull();
  });

  it("filters noise directories from tree listings", async () => {
    // This is a unit test for the noise filtering logic
    // Create a mock clone directory with noise dirs
    const cloneDir = path.join(testCacheDir, "owner", "repo@main");
    fs.mkdirSync(cloneDir, { recursive: true });
    fs.mkdirSync(path.join(cloneDir, "src"));
    fs.mkdirSync(path.join(cloneDir, "node_modules"));
    fs.mkdirSync(path.join(cloneDir, ".git"));
    fs.mkdirSync(path.join(cloneDir, "dist"));
    fs.writeFileSync(path.join(cloneDir, "README.md"), "# Test");
    fs.writeFileSync(path.join(cloneDir, "package.json"), "{}");

    // Import and test the internal listing helper
    const { listCloneDir } = await import("../../src/extract/github.ts");
    const listing = listCloneDir(cloneDir, "owner", "repo", "main");
    expect(listing).toContain("src/");
    expect(listing).toContain("README.md");
    expect(listing).toContain("package.json");
    expect(listing).not.toContain("node_modules");
    expect(listing).not.toContain(".git");
    expect(listing).not.toContain("dist");
  });

  it("reads file content from clone for blob URLs", async () => {
    // Create a mock clone directory with a file
    const cloneDir = path.join(testCacheDir, "owner", "repo@main");
    fs.mkdirSync(path.join(cloneDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(cloneDir, "src", "index.ts"),
      'export const hello = "world";',
    );

    const { readCloneFile } = await import("../../src/extract/github.ts");
    const content = readCloneFile(cloneDir, "src/index.ts");
    expect(content).toContain('export const hello = "world"');
  });

  it("returns binary placeholder for binary files in clone", async () => {
    const cloneDir = path.join(testCacheDir, "owner", "repo@main");
    fs.mkdirSync(cloneDir, { recursive: true });
    const binaryContent = Buffer.alloc(100);
    binaryContent[0] = 0x89; // PNG header-like
    fs.writeFileSync(path.join(cloneDir, "logo.png"), binaryContent);

    const { readCloneFile } = await import("../../src/extract/github.ts");
    const content = readCloneFile(cloneDir, "logo.png");
    expect(content).toContain("Binary file");
  });

  it("includes README content in root URL listings", async () => {
    const cloneDir = path.join(testCacheDir, "owner", "repo@main");
    fs.mkdirSync(path.join(cloneDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(cloneDir, "README.md"),
      "# My Project\n\nA description of the project.",
    );
    fs.writeFileSync(path.join(cloneDir, "package.json"), "{}");

    const { listCloneDir } = await import("../../src/extract/github.ts");
    const listing = listCloneDir(cloneDir, "owner", "repo", "main", true);
    expect(listing).toContain("My Project");
    expect(listing).toContain("A description of the project");
  });

  it("truncates README content at 8,000 chars", async () => {
    const cloneDir = path.join(testCacheDir, "owner", "repo@main");
    fs.mkdirSync(cloneDir, { recursive: true });
    fs.writeFileSync(path.join(cloneDir, "README.md"), "x".repeat(10_000));

    const { listCloneDir } = await import("../../src/extract/github.ts");
    const listing = listCloneDir(cloneDir, "owner", "repo", "main", true);
    // The README portion should be truncated
    expect(listing).toContain("[truncated]");
  });

  it("caps tree listings at 200 entries", async () => {
    const cloneDir = path.join(testCacheDir, "owner", "repo@main");
    fs.mkdirSync(cloneDir, { recursive: true });
    for (let i = 0; i < 250; i++) {
      fs.writeFileSync(path.join(cloneDir, `file-${i}.ts`), `// file ${i}`);
    }

    const { listCloneDir } = await import("../../src/extract/github.ts");
    const listing = listCloneDir(cloneDir, "owner", "repo", "main");
    const fileLines = listing.split("\n").filter((l) => l.match(/file-\d+\.ts/));
    expect(fileLines.length).toBeLessThanOrEqual(200);
    expect(listing).toContain("truncated");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/extract/github.test.ts`
Expected: FAIL -- `fetchViaClone`, `listCloneDir`, `readCloneFile`, `_resetCloneCache` not exported

- [ ] **Step 3: Implement clone cache**

Add to `src/extract/github.ts`:

```ts
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitHubConfig {
  enabled: boolean;
  maxRepoSizeMB: number;
  cloneTimeoutSeconds: number;
}

const DEFAULT_GITHUB_CONFIG: GitHubConfig = {
  enabled: true,
  maxRepoSizeMB: 350,
  cloneTimeoutSeconds: 30,
};

const NOISE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "vendor",
  "__pycache__",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
  ".cache",
]);

const README_LIMIT = 8_000;
const CACHE_BASE = path.join(os.tmpdir(), "pi-tools-github-cache");

// Session-scoped set of cloned repos (owner/repo@ref -> local path)
let cloneRegistry = new Map<string, string>();

/** Test helper: reset the clone registry between tests. */
export function _resetCloneCache(): void {
  cloneRegistry = new Map();
}

/**
 * List directory contents of a clone directory with noise filtering.
 * If includeReadme is true, prepend README content (for root URLs).
 */
export function listCloneDir(
  cloneDir: string,
  owner: string,
  repo: string,
  ref: string,
  includeReadme = false,
): string {
  const lines: string[] = [];
  lines.push(`# ${owner}/${repo} (${ref})`);
  lines.push("");

  // Include README content if requested
  if (includeReadme) {
    const readmeNames = ["README.md", "README", "README.txt", "readme.md"];
    for (const name of readmeNames) {
      const readmePath = path.join(cloneDir, name);
      if (fs.existsSync(readmePath)) {
        let readmeContent = fs.readFileSync(readmePath, "utf-8");
        if (readmeContent.length > README_LIMIT) {
          readmeContent =
            readmeContent.slice(0, README_LIMIT) +
            `\n\n[truncated] README showing ${README_LIMIT.toLocaleString()} of ${readmeContent.length.toLocaleString()} chars`;
        }
        lines.push(readmeContent);
        lines.push("");
        lines.push("---");
        lines.push("");
        break;
      }
    }
  }

  lines.push("## Files");
  lines.push("");

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(cloneDir, { withFileTypes: true });
  } catch {
    return lines.join("\n");
  }

  // Filter noise directories
  const filtered = entries.filter((e) => !NOISE_DIRS.has(e.name));

  const dirs = filtered.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  const files = filtered.filter((e) => !e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));

  const all = [...dirs, ...files];
  const truncated = all.length > MAX_DIR_ENTRIES;
  const visible = all.slice(0, MAX_DIR_ENTRIES);

  for (const entry of visible) {
    if (entry.isDirectory()) {
      lines.push(`  ${entry.name}/`);
    } else {
      lines.push(`  ${entry.name}`);
    }
  }

  if (truncated) {
    lines.push("");
    lines.push(
      `[truncated] showing ${MAX_DIR_ENTRIES} of ${all.length} entries`,
    );
  }

  return lines.join("\n");
}

/**
 * Read a single file from a clone directory.
 * Returns binary placeholder for binary files.
 */
export function readCloneFile(cloneDir: string, filePath: string): string {
  const fullPath = path.join(cloneDir, filePath);

  if (!fs.existsSync(fullPath)) {
    return `File not found: ${filePath}`;
  }

  const stat = fs.statSync(fullPath);

  // Extension-based binary check
  if (isBinaryFile(filePath)) {
    return `Binary file: ${filePath} (${stat.size} bytes)`;
  }

  // Read content
  const buf = fs.readFileSync(fullPath);

  // Content-based binary check
  if (isBinaryFile(filePath, buf)) {
    return `Binary file: ${filePath} (${stat.size} bytes)`;
  }

  let text = buf.toString("utf-8");
  if (text.length > RAW_CONTENT_LIMIT) {
    text =
      text.slice(0, RAW_CONTENT_LIMIT) +
      `\n\n[truncated] showing ${RAW_CONTENT_LIMIT.toLocaleString()} of ${text.length.toLocaleString()} chars`;
  }

  return text;
}

/**
 * Check repo size via GitHub API. Returns size in MB, or null on error.
 */
async function getRepoSizeMB(
  owner: string,
  repo: string,
  signal?: AbortSignal,
): Promise<number | null> {
  const headers = apiHeaders();
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;

  try {
    const response = await fetch(apiUrl, { headers, signal });
    if (!response.ok) return null;
    const data = (await response.json()) as { size: number };
    // API returns size in KB
    return data.size / 1024;
  } catch {
    return null;
  }
}

/**
 * Clone a repo (shallow, blobless) into the cache directory.
 * Returns the clone directory path, or null on failure.
 */
async function cloneRepo(
  owner: string,
  repo: string,
  ref: string,
  timeoutSeconds: number,
): Promise<string | null> {
  const cacheKey = `${owner}/${repo}@${ref}`;

  // Check if already cloned this session
  const existing = cloneRegistry.get(cacheKey);
  if (existing && fs.existsSync(existing)) {
    return existing;
  }

  const cloneDir = path.join(CACHE_BASE, owner, `${repo}@${ref}`);

  // Check if directory exists from a previous incomplete run
  if (fs.existsSync(cloneDir)) {
    cloneRegistry.set(cacheKey, cloneDir);
    return cloneDir;
  }

  fs.mkdirSync(path.dirname(cloneDir), { recursive: true });

  const cloneUrl = `https://github.com/${owner}/${repo}.git`;
  const args = [
    "clone",
    "--depth=1",
    "--filter=blob:none",
    "--single-branch",
    `--branch=${ref}`,
    cloneUrl,
    cloneDir,
  ];

  try {
    await execFileAsync("git", args, {
      timeout: timeoutSeconds * 1000,
    });
    cloneRegistry.set(cacheKey, cloneDir);
    return cloneDir;
  } catch {
    // Clean up failed clone
    fs.rmSync(cloneDir, { recursive: true, force: true });
    return null;
  }
}

/**
 * Tier 2: Shallow-clone the repo and read from the local filesystem.
 * Session-scoped cache: clones persist for process lifetime.
 * Returns null if cloning fails, repo is too large, or URL type is unsupported.
 */
export async function fetchViaClone(
  parsed: GitHubUrl,
  signal?: AbortSignal,
  config?: GitHubConfig,
): Promise<ExtractedContent | null> {
  if (parsed.type === "unknown") return null;

  const cfg = config ?? DEFAULT_GITHUB_CONFIG;
  const ref = parsed.ref ?? "HEAD";
  const originalUrl = buildOriginalUrl(parsed);

  // Check repo size before cloning
  const sizeMB = await getRepoSizeMB(parsed.owner, parsed.repo, signal);
  if (sizeMB !== null && sizeMB > cfg.maxRepoSizeMB) {
    return null;
  }

  // Clone the repo
  const cloneDir = await cloneRepo(
    parsed.owner,
    parsed.repo,
    ref,
    cfg.cloneTimeoutSeconds,
  );
  if (!cloneDir) return null;

  // Return content based on URL type
  if (parsed.type === "blob" || parsed.type === "raw") {
    if (!parsed.path) return null;

    const content = readCloneFile(cloneDir, parsed.path);
    const isBinary = content.startsWith("Binary file:");
    return {
      text: content,
      title: `${parsed.owner}/${parsed.repo} - ${parsed.path}`,
      url: originalUrl,
      extractionChain: ["github:clone"],
      chars: isBinary ? 0 : content.length,
      truncated: content.includes("[truncated]"),
    };
  }

  // Root or tree
  const isRoot = parsed.type === "root";
  const targetDir = parsed.path
    ? path.join(cloneDir, parsed.path)
    : cloneDir;

  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    return null;
  }

  const listing = listCloneDir(
    targetDir,
    parsed.owner,
    parsed.repo,
    ref,
    isRoot || hasReadme(targetDir),
  );

  return {
    text: listing,
    title: `${parsed.owner}/${parsed.repo}${parsed.path ? ` - ${parsed.path}` : ""}`,
    url: originalUrl,
    extractionChain: ["github:clone"],
    chars: listing.length,
    truncated: false,
  };
}

function hasReadme(dir: string): boolean {
  const readmeNames = ["README.md", "README", "README.txt", "readme.md"];
  return readmeNames.some((name) => fs.existsSync(path.join(dir, name)));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/extract/github.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/extract/github.ts tests/extract/github.test.ts
git commit -m "feat(github): add Tier 2 clone cache with noise filtering and binary detection"
```

---

### Task 6: Orchestrator (combines all 3 tiers)

**Files:**
- Modify: `src/extract/github.ts`
- Modify: `tests/extract/github.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/extract/github.test.ts`:

```ts
import {
  parseGitHubUrl,
  extractGitHub,
} from "../../src/extract/github.ts";
import type { GitHubConfig } from "../../src/extract/github.ts";

describe("extractGitHub", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
    _resetCloneCache();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("returns null for unknown URL type", async () => {
    const parsed = parseGitHubUrl(
      "https://github.com/owner/repo/issues/123",
    )!;
    const result = await extractGitHub(parsed);
    expect(result).toBeNull();
  });

  it("uses Tier 1 (raw rewrite) for blob URLs when available", async () => {
    fetchStub.addResponse(
      "raw.githubusercontent.com/owner/repo/main/src/index.ts",
      {
        body: 'export const x = 1;',
        headers: { "content-type": "text/plain" },
      },
    );

    const parsed = parseGitHubUrl(
      "https://github.com/owner/repo/blob/main/src/index.ts",
    )!;
    const result = await extractGitHub(parsed);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("export const x = 1");
    expect(result!.extractionChain).toContain("github:raw");
  });

  it("skips Tier 1 for root URLs (goes to Tier 2 or 3)", async () => {
    // For root URLs, Tier 1 (raw rewrite) is skipped because there's no
    // single file to fetch. The orchestrator should try Tier 2/3 instead.
    // Mock the API response for Tier 3 fallback
    fetchStub.addResponse("api.github.com/repos/owner/repo", {
      body: { size: 1024 }, // 1 MB -- small enough to clone
      headers: { "content-type": "application/json" },
    });
    fetchStub.addResponse("api.github.com/repos/owner/repo/contents/", {
      body: [
        { name: "README.md", type: "file", size: 5000 },
        { name: "src", type: "dir", size: 0 },
      ],
      headers: { "content-type": "application/json" },
    });

    const parsed = parseGitHubUrl("https://github.com/owner/repo")!;
    // Disable clone by setting very low maxRepoSizeMB to force API fallback
    const config: GitHubConfig = {
      enabled: true,
      maxRepoSizeMB: 0,
      cloneTimeoutSeconds: 30,
    };
    const result = await extractGitHub(parsed, undefined, config);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("README.md");
    expect(result!.extractionChain).toContain("github:api");
  });

  it("falls back to Tier 3 when Tier 1 fails for blob URL", async () => {
    // Tier 1 fails (404 from raw.githubusercontent.com)
    fetchStub.addResponse(
      "raw.githubusercontent.com/owner/repo/main/secret.ts",
      { status: 404, body: "Not Found" },
    );

    // Tier 2 skipped (repo too large)
    fetchStub.addResponse("api.github.com/repos/owner/repo", {
      body: { size: 500 * 1024 }, // 500 MB
      headers: { "content-type": "application/json" },
    });

    // Tier 3 succeeds
    const content = Buffer.from('const secret = "tier3";').toString("base64");
    fetchStub.addResponse(
      "api.github.com/repos/owner/repo/contents/secret.ts",
      {
        body: {
          type: "file",
          name: "secret.ts",
          content,
          encoding: "base64",
          size: 23,
        },
        headers: { "content-type": "application/json" },
      },
    );

    const parsed = parseGitHubUrl(
      "https://github.com/owner/repo/blob/main/secret.ts",
    )!;
    const result = await extractGitHub(parsed);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("tier3");
    expect(result!.extractionChain).toContain("github:api");
  });

  it("returns null when all tiers fail", async () => {
    // Tier 1 fails
    fetchStub.addResponse(
      "raw.githubusercontent.com/owner/repo/main/gone.ts",
      { status: 404, body: "Not Found" },
    );

    // Tier 2 fails (repo too large)
    fetchStub.addResponse("api.github.com/repos/owner/repo", {
      body: { size: 500 * 1024 },
      headers: { "content-type": "application/json" },
    });

    // Tier 3 fails
    fetchStub.addResponse(
      "api.github.com/repos/owner/repo/contents/gone.ts",
      {
        status: 404,
        body: { message: "Not Found" },
        headers: { "content-type": "application/json" },
      },
    );

    const parsed = parseGitHubUrl(
      "https://github.com/owner/repo/blob/main/gone.ts",
    )!;
    const result = await extractGitHub(parsed);
    expect(result).toBeNull();
  });

  it("handles raw.githubusercontent.com URLs via Tier 1", async () => {
    fetchStub.addResponse(
      "raw.githubusercontent.com/owner/repo/main/data.json",
      {
        body: '{"key": "value"}',
        headers: { "content-type": "text/plain" },
      },
    );

    const parsed = parseGitHubUrl(
      "https://raw.githubusercontent.com/owner/repo/main/data.json",
    )!;
    const result = await extractGitHub(parsed);
    expect(result).not.toBeNull();
    expect(result!.text).toContain('"key": "value"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/extract/github.test.ts`
Expected: FAIL -- `extractGitHub` is not exported from `src/extract/github.ts`

- [ ] **Step 3: Implement `extractGitHub`**

Add to `src/extract/github.ts`:

```ts
/**
 * Main GitHub content extraction orchestrator.
 * Tries three tiers in order: raw rewrite -> clone cache -> API fallback.
 * Returns null if the URL type is "unknown" or all tiers fail,
 * letting the main extraction pipeline handle it.
 */
export async function extractGitHub(
  parsed: GitHubUrl,
  signal?: AbortSignal,
  config?: GitHubConfig,
): Promise<ExtractedContent | null> {
  if (parsed.type === "unknown") return null;

  // Tier 1: Raw URL rewrite (blob and raw URLs only)
  if (parsed.type === "blob" || parsed.type === "raw") {
    const rawResult = await fetchRaw(parsed, signal);
    if (rawResult) return rawResult;
  }

  // Tier 2: Clone cache (all content URL types)
  const cloneResult = await fetchViaClone(parsed, signal, config);
  if (cloneResult) return cloneResult;

  // Tier 3: API fallback
  const apiResult = await fetchViaApi(parsed, signal);
  if (apiResult) return apiResult;

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/extract/github.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/extract/github.ts tests/extract/github.test.ts
git commit -m "feat(github): add extractGitHub orchestrator combining all 3 tiers"
```

---

### Task 7: Config additions for GitHub section

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/config.test.ts`:

```ts
describe("GitHub config", () => {
  it("provides default GitHub config when not specified", () => {
    const config = loadConfig("/nonexistent/path.json");
    expect(config.github).toBeDefined();
    expect(config.github.enabled).toBe(true);
    expect(config.github.maxRepoSizeMB).toBe(350);
    expect(config.github.cloneTimeoutSeconds).toBe(30);
  });

  it("merges user GitHub config with defaults", () => {
    const tempFile = path.join(os.tmpdir(), "pi-tools-test-gh-config.json");
    fs.writeFileSync(
      tempFile,
      JSON.stringify({
        github: {
          maxRepoSizeMB: 500,
        },
      }),
    );

    try {
      const config = loadConfig(tempFile);
      expect(config.github.enabled).toBe(true); // from defaults
      expect(config.github.maxRepoSizeMB).toBe(500); // from user
      expect(config.github.cloneTimeoutSeconds).toBe(30); // from defaults
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it("allows disabling GitHub interception", () => {
    const tempFile = path.join(os.tmpdir(), "pi-tools-test-gh-disabled.json");
    fs.writeFileSync(
      tempFile,
      JSON.stringify({
        github: {
          enabled: false,
        },
      }),
    );

    try {
      const config = loadConfig(tempFile);
      expect(config.github.enabled).toBe(false);
    } finally {
      fs.unlinkSync(tempFile);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL -- `config.github` is undefined

- [ ] **Step 3: Update `PiToolsConfig` and `loadConfig`**

In `src/config.ts`, add the `GitHubConfig` interface and update `PiToolsConfig`:

Add after the `ProviderConfigEntry` interface:

```ts
export interface GitHubConfig {
  enabled: boolean;
  maxRepoSizeMB: number;
  cloneTimeoutSeconds: number;
}
```

Update `PiToolsConfig`:

```ts
export interface PiToolsConfig {
  defaultProvider: string;
  providers: Record<string, ProviderConfigEntry>;
  github: GitHubConfig;
}
```

Add default GitHub config to `DEFAULT_CONFIG`:

```ts
const DEFAULT_CONFIG: PiToolsConfig = {
  defaultProvider: "auto",
  providers: {
    brave: { enabled: true, monthlyQuota: 2000, apiKey: "BRAVE_API_KEY" },
    exa: { enabled: true, monthlyQuota: 1000, apiKey: "EXA_API_KEY" },
    tavily: { enabled: false, apiKey: "TAVILY_API_KEY" },
    jina: { enabled: true },
    duckduckgo: { enabled: true },
    serper: { enabled: false, apiKey: "SERPER_API_KEY" },
    perplexity: { enabled: true, apiKey: "PERPLEXITY_API_KEY" },
    firecrawl: { enabled: true, apiKey: "FIRECRAWL_API_KEY" },
  },
  github: {
    enabled: true,
    maxRepoSizeMB: 350,
    cloneTimeoutSeconds: 30,
  },
};
```

Update `loadConfig` return to merge the github section:

```ts
export function loadConfig(configPath?: string): PiToolsConfig {
  const filePath = configPath ?? getConfigPath();
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      defaultProvider: parsed.defaultProvider ?? DEFAULT_CONFIG.defaultProvider,
      providers: {
        ...DEFAULT_CONFIG.providers,
        ...parsed.providers,
      },
      github: {
        ...DEFAULT_CONFIG.github,
        ...parsed.github,
      },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/config.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat(config): add github section with enabled, maxRepoSizeMB, cloneTimeoutSeconds"
```

---

### Task 8: Integration into `extractContent` pipeline

**Files:**
- Modify: `src/extract/pipeline.ts`
- Modify: `tests/extract/pipeline.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/extract/pipeline.test.ts`:

```ts
import { extractContent } from "../../src/extract/pipeline.ts";

describe("GitHub URL interception in extractContent", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("intercepts blob URL and returns raw file content", async () => {
    fetchStub.addResponse(
      "raw.githubusercontent.com/facebook/react/main/README.md",
      {
        body: "# React\n\nA library for building UIs.",
        headers: { "content-type": "text/plain" },
      },
    );

    const result = await extractContent(
      "https://github.com/facebook/react/blob/main/README.md",
    );
    expect(result.text).toContain("React");
    expect(result.extractionChain).toContain("github:raw");
    // Should NOT have gone through the normal HTTP pipeline
    expect(result.extractionChain).not.toContain("readability");
  });

  it("intercepts raw.githubusercontent.com URL directly", async () => {
    fetchStub.addResponse(
      "raw.githubusercontent.com/owner/repo/main/config.json",
      {
        body: '{"setting": true}',
        headers: { "content-type": "text/plain" },
      },
    );

    const result = await extractContent(
      "https://raw.githubusercontent.com/owner/repo/main/config.json",
    );
    expect(result.text).toContain('"setting": true');
    expect(result.extractionChain).toContain("github:raw");
  });

  it("does NOT intercept issues URL — falls through to normal pipeline", async () => {
    const issuesHtml = `
      <!DOCTYPE html><html><head><title>Issue #123</title></head><body>
      <article><h1>Bug Report</h1>
      <p>${"This issue describes a bug in the system. ".repeat(30)}</p>
      </article></body></html>`;

    fetchStub.addResponse(
      "github.com/facebook/react/issues/123",
      {
        body: issuesHtml,
        headers: { "content-type": "text/html" },
      },
    );

    const result = await extractContent(
      "https://github.com/facebook/react/issues/123",
    );
    // Should go through normal extraction (Readability, etc.)
    expect(result.extractionChain).toContain("readability");
    expect(result.extractionChain).not.toContain("github:raw");
    expect(result.extractionChain).not.toContain("github:clone");
    expect(result.extractionChain).not.toContain("github:api");
  });

  it("does NOT intercept pull request URL", async () => {
    const prHtml = `
      <!DOCTYPE html><html><head><title>PR #456</title></head><body>
      <article><h1>Feature PR</h1>
      <p>${"This PR adds a new feature to the codebase. ".repeat(30)}</p>
      </article></body></html>`;

    fetchStub.addResponse(
      "github.com/facebook/react/pull/456",
      {
        body: prHtml,
        headers: { "content-type": "text/html" },
      },
    );

    const result = await extractContent(
      "https://github.com/facebook/react/pull/456",
    );
    expect(result.extractionChain).toContain("readability");
  });

  it("falls through to normal pipeline when GitHub interceptor returns null", async () => {
    // Tier 1: raw fetch fails
    fetchStub.addResponse(
      "raw.githubusercontent.com/owner/repo/main/missing.ts",
      { status: 404, body: "Not Found" },
    );

    // Tier 2: repo size check fails (API returns error)
    fetchStub.addResponse("api.github.com/repos/owner/repo", {
      status: 403,
      body: { message: "rate limited" },
      headers: { "content-type": "application/json" },
    });

    // Tier 3: API also fails
    fetchStub.addResponse(
      "api.github.com/repos/owner/repo/contents/missing.ts",
      {
        status: 404,
        body: { message: "Not Found" },
        headers: { "content-type": "application/json" },
      },
    );

    // Normal pipeline's HTTP fetch for the original URL
    const fallbackHtml = `
      <!DOCTYPE html><html><head><title>Blob View</title></head><body>
      <article><h1>File Content</h1>
      <p>${"Rendered blob view content from GitHub. ".repeat(30)}</p>
      </article></body></html>`;

    fetchStub.addResponse(
      "github.com/owner/repo/blob/main/missing.ts",
      {
        body: fallbackHtml,
        headers: { "content-type": "text/html" },
      },
    );

    const result = await extractContent(
      "https://github.com/owner/repo/blob/main/missing.ts",
    );
    // Falls through to normal pipeline
    expect(result.extractionChain).toContain("readability");
  });

  it("intercepts non-GitHub URLs normally (no interception)", async () => {
    fetchStub.addResponse("example.com/page", {
      body: `<html><head><title>Normal Page</title></head><body>
        <article><h1>Normal Content</h1>
        <p>${"Regular web page content. ".repeat(30)}</p>
        </article></body></html>`,
      headers: { "content-type": "text/html" },
    });

    const result = await extractContent("https://example.com/page");
    expect(result.text).toContain("Normal Content");
    expect(result.extractionChain).toContain("readability");
    expect(result.extractionChain).not.toContain("github:raw");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/extract/pipeline.test.ts`
Expected: FAIL -- `extractContent` with GitHub blob URLs still goes through normal HTTP pipeline, `extractionChain` does not contain `"github:raw"`

- [ ] **Step 3: Update `extractContent` to check GitHub URLs first**

In `src/extract/pipeline.ts`, add the GitHub import and intercept check at the top of `extractContent`, before the HTTP fetch:

Add import at the top of the file:

```ts
import { parseGitHubUrl, extractGitHub } from "./github.ts";
```

Update `extractContent` to add GitHub interception before the `fetch` call:

```ts
export async function extractContent(
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedContent> {
  validateUrl(url);

  // GitHub interception: try to extract from GitHub before HTTP fetch
  const ghParsed = parseGitHubUrl(url);
  if (ghParsed && ghParsed.type !== "unknown") {
    const ghResult = await extractGitHub(ghParsed, signal);
    if (ghResult) return ghResult;
    // If interceptor returns null, fall through to normal pipeline
  }

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

  // ... rest of pipeline unchanged
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/extract/pipeline.test.ts`
Expected: All tests PASS (both new GitHub tests and existing tests)

- [ ] **Step 5: Wire config into the integration point**

Update `src/extract/pipeline.ts` to accept optional config and pass it through:

```ts
import { loadConfig } from "../config.ts";

export async function extractContent(
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedContent> {
  validateUrl(url);

  // GitHub interception
  const ghParsed = parseGitHubUrl(url);
  if (ghParsed && ghParsed.type !== "unknown") {
    const config = loadConfig();
    if (config.github.enabled) {
      const ghResult = await extractGitHub(ghParsed, signal, config.github);
      if (ghResult) return ghResult;
    }
  }

  // ... rest unchanged
```

Note: `loadConfig()` is cheap (reads a JSON file) and is already called once at startup in `src/index.ts`. For the pipeline integration, calling it per-request is acceptable since GitHub URL interception is infrequent. If profiling shows it's a concern, the config can be cached or injected via parameter later.

- [ ] **Step 6: Run full pipeline tests**

Run: `npx vitest run tests/extract/pipeline.test.ts`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/extract/pipeline.ts tests/extract/pipeline.test.ts
git commit -m "feat(github): integrate GitHub interceptor into extractContent pipeline"
```

---

### Task 9: Full regression test

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS across all test files

- [ ] **Step 2: Run type checking**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Verify no unused imports**

Scan the following files for unused imports:
- `src/extract/pipeline.ts` -- should import `parseGitHubUrl`, `extractGitHub` from `./github.ts` and `loadConfig` from `../config.ts`
- `src/extract/github.ts` -- should import `ExtractedContent` from `./pipeline.ts`, plus `node:child_process`, `node:fs`, `node:os`, `node:path`, `node:util`
- `src/config.ts` -- should export `GitHubConfig`

- [ ] **Step 4: Manual smoke test**

Run a quick manual test to verify GitHub interception works end-to-end:

```bash
# Test blob URL (should return raw file content via Tier 1)
curl -s "https://raw.githubusercontent.com/facebook/react/main/README.md" | head -5

# Verify the extraction pipeline would handle it
npx tsx -e "
  const { extractContent } = require('./src/extract/pipeline.ts');
  extractContent('https://github.com/facebook/react/blob/main/README.md')
    .then(r => console.log('Chain:', r.extractionChain, 'Chars:', r.chars))
    .catch(e => console.error(e));
"
```

- [ ] **Step 5: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: phase 5 cleanup and regression verification"
```

---

## Summary of files changed

| File | Action | Description |
|------|--------|-------------|
| `src/extract/github.ts` | Create | URL parser, binary detection, 3-tier fetch (raw, clone, API), orchestrator |
| `tests/extract/github.test.ts` | Create | Full test coverage for all GitHub extraction components |
| `src/config.ts` | Modify | Add `GitHubConfig` interface and `github` section to config |
| `tests/config.test.ts` | Modify | Tests for GitHub config defaults and merging |
| `src/extract/pipeline.ts` | Modify | Add GitHub interception as first check in `extractContent()` |
| `tests/extract/pipeline.test.ts` | Modify | Integration tests for GitHub URL interception in pipeline |

## Dependencies

- **No new npm packages.** Uses `node:child_process`, `node:fs`, `node:os`, `node:path`, `node:util` (all built-in).
- **External dependency:** `git` CLI must be available on PATH for Tier 2 (clone cache). Tier 1 and Tier 3 work without git.
- **Optional:** `GITHUB_TOKEN` env var for higher API rate limits (5,000 req/hour vs 60 req/hour without auth).

## Risk notes

- **Clone cache disk usage:** Shallow blobless clones are small but not zero. Session-scoped cleanup (process exit) limits accumulation. The `maxRepoSizeMB` guard prevents cloning huge repos.
- **API rate limiting:** Without `GITHUB_TOKEN`, the GitHub API allows only 60 requests/hour. Tier 1 (raw rewrite) and Tier 2 (clone) don't consume API quota for content fetching, only for repo size checks.
- **Ref ambiguity:** The parser treats the first path segment after `tree/` or `blob/` as the ref. This works for simple branch names and tags but could be wrong for refs containing `/` (e.g., `feature/my-branch`). GitHub itself has this same ambiguity in its URL structure. The three-tier fallback handles failures gracefully.
