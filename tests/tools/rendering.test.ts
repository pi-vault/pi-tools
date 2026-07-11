import { describe, expect, it, vi } from "vitest";
import { Text } from "@earendil-works/pi-tui";
import { createWebSearchTool } from "../../src/tools/web-search.ts";
import { createWebFetchTool } from "../../src/tools/web-fetch.ts";
import { createCodeSearchTool } from "../../src/tools/code-search.ts";
import { createWebReadTool } from "../../src/tools/web-read.ts";
import { createWebResearchTool } from "../../src/tools/web-research.ts";
import { ContentStore } from "../../src/storage.ts";
import { DuckDuckGoProvider } from "../../src/providers/duckduckgo.ts";

// Minimal mock theme: passes text through unstyled so assertions are readable
const mockTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as any;

function makeContext(
  overrides: Partial<{
    isPartial: boolean;
    isError: boolean;
    expanded: boolean;
    lastComponent: unknown;
    argsComplete: boolean;
    executionStarted: boolean;
  }> = {},
) {
  return {
    args: {},
    toolCallId: "test-id",
    invalidate: () => {},
    lastComponent: undefined,
    state: undefined,
    cwd: "/tmp",
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    ...overrides,
  } as any;
}

describe("web_search rendering", () => {
  const tool = createWebSearchTool(() => [new DuckDuckGoProvider()]);

  it("renderCall returns a Text component showing tool name and query", () => {
    const ctx = makeContext();
    const component = tool.renderCall!({ query: "vitest mocking", numResults: 5 }, mockTheme, ctx);
    expect(component).toBeInstanceOf(Text);
    const output = component.render(120).join("");
    expect(output).toContain("web_search");
    expect(output).toContain("vitest mocking");
  });

  it("renderCall shows streaming placeholder when args are incomplete", () => {
    const ctx = makeContext({ argsComplete: false });
    const component = tool.renderCall!({ query: "" }, mockTheme, ctx);
    const output = component.render(120).join("");
    expect(output).toContain("Searching");
    expect(output).not.toContain("web_search");
  });

  it("renderResult shows result count and provider when collapsed", () => {
    const result = {
      content: [{ type: "text" as const, text: "1. [Title](https://example.com)\n   snippet" }],
      details: { provider: "duckduckgo", resultCount: 3 },
    };
    const component = tool.renderResult!(
      result,
      { expanded: false, isPartial: false },
      mockTheme,
      makeContext(),
    );
    expect(component).toBeInstanceOf(Text);
    const output = component.render(120).join("");
    expect(output).toContain("3");
    expect(output).toContain("duckduckgo");
  });

  it("renderResult shows content preview when expanded", () => {
    const result = {
      content: [
        { type: "text" as const, text: "1. [My Result Title](https://ex.com)\n   snippet" },
      ],
      details: { provider: "duckduckgo", resultCount: 1 },
    };
    const component = tool.renderResult!(
      result,
      { expanded: true, isPartial: false },
      mockTheme,
      makeContext({ expanded: true }),
    );
    const output = component.render(120).join("\n");
    expect(output).toContain("My Result Title");
  });
});

describe("web_fetch rendering", () => {
  const tool = createWebFetchTool(new ContentStore(() => {}));

  it("renderCall shows tool name and URL", () => {
    const component = tool.renderCall!(
      { url: "https://example.com/page" },
      mockTheme,
      makeContext(),
    );
    expect(component).toBeInstanceOf(Text);
    const output = component.render(120).join("");
    expect(output).toContain("web_fetch");
    expect(output).toContain("example.com/page");
  });

  it("renderCall shows streaming placeholder when args are incomplete", () => {
    const component = tool.renderCall!(
      { url: "" },
      mockTheme,
      makeContext({ argsComplete: false }),
    );
    const output = component.render(120).join("");
    expect(output).toContain("Fetching");
    expect(output).not.toContain("web_fetch");
  });

  it("renderResult shows char count when collapsed", () => {
    const result = {
      content: [{ type: "text" as const, text: "page content" }],
      details: {
        url: "https://example.com",
        chars: 4200,
        truncated: false,
        extractionChain: ["readability"],
      },
    };
    const component = tool.renderResult!(
      result,
      { expanded: false, isPartial: false },
      mockTheme,
      makeContext(),
    );
    expect(component).toBeInstanceOf(Text);
    const output = component.render(120).join("");
    expect(output).toContain("4200");
    expect(output).not.toContain("truncated");
  });

  it("renderResult notes truncation in result", () => {
    const result = {
      content: [{ type: "text" as const, text: "..." }],
      details: {
        url: "https://example.com",
        chars: 20000,
        truncated: true,
        extractionChain: ["readability"],
      },
    };
    const component = tool.renderResult!(
      result,
      { expanded: false, isPartial: false },
      mockTheme,
      makeContext(),
    );
    const output = component.render(120).join("");
    expect(output).toContain("20000");
    expect(output).toContain("truncated");
  });
});

describe("code_search rendering", () => {
  const tool = createCodeSearchTool(() => undefined);

  it("renderCall shows tool name and query", () => {
    const component = tool.renderCall!(
      { query: "async iterator typescript" },
      mockTheme,
      makeContext(),
    );
    expect(component).toBeInstanceOf(Text);
    const output = component.render(120).join("");
    expect(output).toContain("code_search");
    expect(output).toContain("async iterator typescript");
  });

  it("renderResult shows result count when collapsed", () => {
    const result = {
      content: [{ type: "text" as const, text: "results..." }],
      details: { provider: "exa", resultCount: 5 },
    };
    const component = tool.renderResult!(
      result,
      { expanded: false, isPartial: false },
      mockTheme,
      makeContext(),
    );
    expect(component).toBeInstanceOf(Text);
    const output = component.render(120).join("");
    expect(output).toContain("5");
  });
});

describe("web_read rendering", () => {
  const tool = createWebReadTool(new ContentStore(() => {}));

  it("renderCall shows tool name and content ID", () => {
    const component = tool.renderCall!({ contentId: "abc123" }, mockTheme, makeContext());
    expect(component).toBeInstanceOf(Text);
    const output = component.render(120).join("");
    expect(output).toContain("web_read");
    expect(output).toContain("abc123");
  });

  it("renderResult shows char count when collapsed", () => {
    const result = {
      content: [{ type: "text" as const, text: "x".repeat(500) }],
      details: undefined,
    };
    const component = tool.renderResult!(
      result,
      { expanded: false, isPartial: false },
      mockTheme,
      makeContext(),
    );
    expect(component).toBeInstanceOf(Text);
    const output = component.render(120).join("");
    expect(output).toContain("500");
  });
});

describe("long input truncation", () => {
  it("web_search renderCall truncates queries over 70 chars", () => {
    const tool = createWebSearchTool(() => [new DuckDuckGoProvider()]);
    const longQuery = "a".repeat(100);
    const component = tool.renderCall!({ query: longQuery }, mockTheme, makeContext());
    const output = component.render(120).join("");
    expect(output).toContain("a".repeat(67) + "...");
    expect(output).not.toContain("a".repeat(68));
  });

  it("web_fetch renderCall truncates URLs over 70 chars", () => {
    const tool = createWebFetchTool(new ContentStore(() => {}));
    const longUrl = "https://example.com/" + "x".repeat(80);
    const component = tool.renderCall!({ url: longUrl }, mockTheme, makeContext());
    const output = component.render(120).join("");
    expect(output).toContain("...");
    expect(output).not.toContain(longUrl);
  });
});

describe("component reuse across renders", () => {
  it("web_search renderCall reuses lastComponent instance", () => {
    const tool = createWebSearchTool(() => [new DuckDuckGoProvider()]);
    const existing = new Text("old text");
    const ctx = makeContext({ lastComponent: existing });
    const returned = tool.renderCall!({ query: "test" }, mockTheme, ctx);
    expect(returned).toBe(existing);
    expect(returned.render(120).join("")).toContain("test");
  });

  it("web_fetch renderCall reuses lastComponent instance", () => {
    const tool = createWebFetchTool(new ContentStore(() => {}));
    const existing = new Text("old text");
    const ctx = makeContext({ lastComponent: existing });
    const returned = tool.renderCall!({ url: "https://example.com" }, mockTheme, ctx);
    expect(returned).toBe(existing);
  });
});

describe("web_research rendering", () => {
  const tool = createWebResearchTool("key", { enabled: true }, vi.fn());

  it("renderCall shows tool name and query preview with mode", () => {
    const component = tool.renderCall!(
      { query: "what are the best testing frameworks" },
      mockTheme,
      makeContext(),
    );
    expect(component).toBeInstanceOf(Text);
    const output = component.render(120).join("");
    expect(output).toContain("web_research");
    expect(output).toContain("what are the best testing frameworks");
    expect(output).toContain("standard");
  });

  it("renderCall truncates long queries at 60 chars", () => {
    const longQuery = "a".repeat(80);
    const component = tool.renderCall!({ query: longQuery }, mockTheme, makeContext());
    const output = component.render(120).join("");
    expect(output).toContain("a".repeat(57) + "...");
    expect(output).not.toContain("a".repeat(58));
  });

  it("renderCall shows streaming placeholder when args are incomplete", () => {
    const component = tool.renderCall!(
      { query: "" },
      mockTheme,
      makeContext({ argsComplete: false }),
    );
    const output = component.render(120).join("");
    expect(output).toContain("Researching");
    expect(output).not.toContain("web_research");
  });

  it("renderCall displays specified researchMode", () => {
    const component = tool.renderCall!(
      { query: "test", researchMode: "full" },
      mockTheme,
      makeContext(),
    );
    const output = component.render(120).join("");
    expect(output).toContain("full");
  });

  it("renderResult shows source count and output path", () => {
    const result = {
      content: [{ type: "text" as const, text: "report content" }],
      details: { sourceCount: 7, outputPath: "/tmp/findings.md" },
    };
    const component = tool.renderResult!(
      result,
      { expanded: false, isPartial: false },
      mockTheme,
      makeContext(),
    );
    expect(component).toBeInstanceOf(Text);
    const output = component.render(120).join("");
    expect(output).toContain("7 sources");
    expect(output).toContain("findings.md");
  });

  it("renderResult shows error text on failure", () => {
    const result = {
      content: [{ type: "text" as const, text: "API rate limit exceeded" }],
      details: undefined as any,
    };
    const component = tool.renderResult!(
      result,
      { expanded: false, isPartial: false },
      mockTheme,
      makeContext({ isError: true }),
    );
    const output = component.render(120).join("");
    expect(output).toContain("failed");
    expect(output).toContain("API rate limit exceeded");
  });

  it("renderResult shows placeholder when partial", () => {
    const result = {
      content: [],
      details: undefined as any,
    };
    const component = tool.renderResult!(
      result,
      { expanded: false, isPartial: true },
      mockTheme,
      makeContext({ isPartial: true }),
    );
    const output = component.render(120).join("");
    expect(output).toContain("Researching");
  });
});
