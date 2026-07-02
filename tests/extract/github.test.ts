import { describe, expect, it } from "vitest";
import { parseGitHubUrl, isBinaryFile } from "../../src/extract/github.ts";

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
