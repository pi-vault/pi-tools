import { describe, expect, it, vi } from "vitest";
import { createWebSearchTool } from "../../src/tools/web-search.ts";
import { createWebFetchTool } from "../../src/tools/web-fetch.ts";
import { createWebReadTool } from "../../src/tools/web-read.ts";
import { createCodeSearchTool } from "../../src/tools/code-search.ts";
import { createWebResearchTool } from "../../src/tools/web-research.ts";
import type { GuidanceOverride } from "../../src/config.ts";
import type { ContentStore } from "../../src/storage.ts";

function mockStore(): ContentStore {
  return {
    store: vi.fn().mockReturnValue("content-id"),
    get: vi.fn().mockReturnValue(undefined),
    restore: vi.fn(),
  } as unknown as ContentStore;
}

describe("prompt guidance overrides", () => {
  it("web_search uses custom promptSnippet when provided", () => {
    const guidance: GuidanceOverride = {
      promptSnippet: "Custom search snippet",
    };
    const tool = createWebSearchTool(
      () => {
        throw new Error("not called");
      },
      undefined,
      guidance,
    );
    expect(tool.promptSnippet).toBe("Custom search snippet");
  });

  it("web_search uses custom promptGuidelines when provided", () => {
    const guidance: GuidanceOverride = {
      promptGuidelines: ["Guideline A", "Guideline B"],
    };
    const tool = createWebSearchTool(
      () => {
        throw new Error("not called");
      },
      undefined,
      guidance,
    );
    expect(tool.promptGuidelines).toEqual(["Guideline A", "Guideline B"]);
  });

  it("web_search uses defaults when no guidance provided", () => {
    const tool = createWebSearchTool(() => {
      throw new Error("not called");
    });
    expect(tool.promptSnippet).toBe("Search the web for up-to-date information.");
    expect(tool.promptGuidelines!.length).toBeGreaterThan(0);
  });

  it("web_search uses defaults when guidance fields are undefined", () => {
    const guidance: GuidanceOverride = {};
    const tool = createWebSearchTool(
      () => {
        throw new Error("not called");
      },
      undefined,
      guidance,
    );
    expect(tool.promptSnippet).toBe("Search the web for up-to-date information.");
  });

  it("web_fetch uses custom promptSnippet when provided", () => {
    const guidance: GuidanceOverride = {
      promptSnippet: "Custom fetch snippet",
    };
    // guidance is the 4th parameter: (store, resolveFetchCandidates, cache, guidance)
    const tool = createWebFetchTool(mockStore(), undefined, undefined, guidance);
    expect(tool.promptSnippet).toBe("Custom fetch snippet");
  });

  it("web_fetch uses defaults when no guidance provided", () => {
    const tool = createWebFetchTool(mockStore());
    expect(tool.promptSnippet).toBe(
      "Fetch a URL and extract readable content as markdown. Supports HTML pages, YouTube videos (transcript + thumbnail), and local video files (Gemini analysis).",
    );
  });

  it("web_read uses custom promptSnippet when provided", () => {
    const guidance: GuidanceOverride = {
      promptSnippet: "Custom read snippet",
    };
    const tool = createWebReadTool(mockStore(), guidance);
    expect(tool.promptSnippet).toBe("Custom read snippet");
  });

  it("web_read uses defaults when no guidance provided", () => {
    const tool = createWebReadTool(mockStore());
    expect(tool.promptSnippet).toBe(
      "Retrieve previously fetched web content by its content ID without re-fetching.",
    );
  });

  it("code_search uses custom promptGuidelines when provided", () => {
    const guidance: GuidanceOverride = {
      promptGuidelines: ["Custom code guideline"],
    };
    const tool = createCodeSearchTool(() => undefined, undefined, guidance);
    expect(tool.promptGuidelines).toEqual(["Custom code guideline"]);
  });

  it("code_search uses defaults when no guidance provided", () => {
    const tool = createCodeSearchTool(() => undefined);
    expect(tool.promptSnippet).toBe(
      "Search code, library APIs, and technical documentation across the web.",
    );
  });

  it("web_research uses custom promptSnippet when provided", () => {
    const guidance: GuidanceOverride = {
      promptSnippet: "Custom research snippet",
    };
    const tool = createWebResearchTool("key", { enabled: true }, vi.fn(), guidance);
    expect(tool.promptSnippet).toBe("Custom research snippet");
  });

  it("web_research uses custom promptGuidelines when provided", () => {
    const guidance: GuidanceOverride = {
      promptGuidelines: ["Research guideline A"],
    };
    const tool = createWebResearchTool("key", { enabled: true }, vi.fn(), guidance);
    expect(tool.promptGuidelines).toEqual(["Research guideline A"]);
  });

  it("web_research uses defaults when no guidance provided", () => {
    const tool = createWebResearchTool("key", { enabled: true }, vi.fn());
    expect(tool.promptSnippet).toContain("Exa deep research");
    expect(tool.promptGuidelines!.length).toBeGreaterThan(0);
  });
});
