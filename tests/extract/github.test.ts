import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  parseGitHubUrl,
  isBinaryFile,
  fetchRaw,
  fetchViaApi,
  fetchViaClone,
  extractGitHub,
  _resetCloneCache,
} from "../../src/extract/github.ts";
import type { GitHubConfig } from "../../src/extract/github.ts";
import { stubFetch } from "../helpers.ts";

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

describe("fetchViaClone", () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  const testCacheDir = path.join(os.tmpdir(), "pi-tools-github-cache-test");

  beforeEach(() => {
    fetchStub = stubFetch();
    _resetCloneCache();
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
    const cloneDir = path.join(testCacheDir, "owner", "repo@main");
    fs.mkdirSync(cloneDir, { recursive: true });
    fs.mkdirSync(path.join(cloneDir, "src"));
    fs.mkdirSync(path.join(cloneDir, "node_modules"));
    fs.mkdirSync(path.join(cloneDir, ".git"));
    fs.mkdirSync(path.join(cloneDir, "dist"));
    fs.writeFileSync(path.join(cloneDir, "README.md"), "# Test");
    fs.writeFileSync(path.join(cloneDir, "package.json"), "{}");

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
        body: "export const x = 1;",
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
    // Add more-specific mock first so it wins over the less-specific repo mock
    fetchStub.addResponse("api.github.com/repos/owner/repo/contents/", {
      body: [
        { name: "README.md", type: "file", size: 5000 },
        { name: "src", type: "dir", size: 0 },
      ],
      headers: { "content-type": "application/json" },
    });
    // Tier 2: maxRepoSizeMB=0 so any repo triggers skip; size check uses this mock
    fetchStub.addResponse("api.github.com/repos/owner/repo", {
      body: { size: 1024 }, // 1 MB
      headers: { "content-type": "application/json" },
    });

    const parsed = parseGitHubUrl("https://github.com/owner/repo")!;
    // Force Tier 2 to fail by setting maxRepoSizeMB=0 so size check fails
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
    // Tier 1 fails (404 from raw)
    fetchStub.addResponse(
      "raw.githubusercontent.com/owner/repo/main/secret.ts",
      { status: 404, body: "Not Found" },
    );

    // Tier 3 mock added BEFORE the less-specific repo mock so it wins
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

    // Tier 2 skipped (repo too large) - added after contents mock
    fetchStub.addResponse("api.github.com/repos/owner/repo", {
      body: { size: 500 * 1024 }, // 500 MB
      headers: { "content-type": "application/json" },
    });

    const parsed = parseGitHubUrl(
      "https://github.com/owner/repo/blob/main/secret.ts",
    )!;
    const result = await extractGitHub(parsed);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("tier3");
    expect(result!.extractionChain).toContain("github:api");
  });

  it("returns null when all tiers fail", async () => {
    fetchStub.addResponse(
      "raw.githubusercontent.com/owner/repo/main/gone.ts",
      { status: 404, body: "Not Found" },
    );
    fetchStub.addResponse("api.github.com/repos/owner/repo", {
      body: { size: 500 * 1024 },
      headers: { "content-type": "application/json" },
    });
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
