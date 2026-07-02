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
