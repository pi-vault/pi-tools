import { describe, expect, it, vi } from "vitest";
import { createCodeSearchTool } from "../../src/tools/code-search.ts";
import { makeCtx } from "../helpers.ts";
import type { CodeSearchProvider } from "../../src/providers/types.ts";

function mockCodeSearch(): CodeSearchProvider {
  return {
    name: "exa",
    codeSearch: vi.fn().mockResolvedValue([
      {
        title: "React useState",
        url: "https://github.com/facebook/react",
        snippet: "const [state, setState] = useState(0);",
        language: "typescript",
      },
      {
        title: "Express Router",
        url: "https://github.com/expressjs/express",
        snippet: "const router = express.Router();",
        language: "javascript",
      },
    ]),
  };
}

describe("code_search tool", () => {
  it("has correct tool metadata", () => {
    const tool = createCodeSearchTool(() => mockCodeSearch());
    expect(tool.name).toBe("code_search");
    expect(tool.label).toBe("Code Search");
  });

  it("returns formatted code results", async () => {
    const tool = createCodeSearchTool(() => mockCodeSearch());
    const ctx = makeCtx();
    const result = await tool.execute("call-1", { query: "react hooks" }, undefined, undefined, ctx);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("React useState");
    expect(text).toContain("typescript");
  });

  it("returns error when no code search provider available", async () => {
    const tool = createCodeSearchTool(() => undefined);
    const ctx = makeCtx();
    const result = await tool.execute("call-2", { query: "test" }, undefined, undefined, ctx);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Exa");
    expect(text.toLowerCase()).toContain("api key");
  });

  it("calls onSuccess with provider name after successful search", async () => {
    const onSuccess = vi.fn();
    const tool = createCodeSearchTool(() => mockCodeSearch(), onSuccess);
    const ctx = makeCtx();
    await tool.execute("call-3", { query: "hooks" }, undefined, undefined, ctx);
    expect(onSuccess).toHaveBeenCalledWith("exa");
  });

  it("does not call onSuccess when provider throws", async () => {
    const failingProvider: CodeSearchProvider = {
      name: "exa",
      codeSearch: vi.fn().mockRejectedValue(new Error("Provider exploded")),
    };
    const onSuccess = vi.fn();
    const tool = createCodeSearchTool(() => failingProvider, onSuccess);
    const ctx = makeCtx();
    const result = await tool.execute("call-4", { query: "test" }, undefined, undefined, ctx);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("error");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("returns no results message when provider returns empty array", async () => {
    const emptyProvider: CodeSearchProvider = {
      name: "exa",
      codeSearch: vi.fn().mockResolvedValue([]),
    };
    const tool = createCodeSearchTool(() => emptyProvider);
    const ctx = makeCtx();
    const result = await tool.execute("call-5", { query: "nonexistent" }, undefined, undefined, ctx);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toBe("No code results found.");
  });

  it("passes numResults to provider", async () => {
    const provider = mockCodeSearch();
    const tool = createCodeSearchTool(() => provider);
    const ctx = makeCtx();
    await tool.execute("call-6", { query: "test", numResults: 3 }, undefined, undefined, ctx);
    expect(provider.codeSearch).toHaveBeenCalledWith("test", 3, undefined);
  });
});
