import { describe, expect, it, vi } from "vitest";
import { createWebDocsFetchTool } from "../../src/tools/web-docs-fetch.ts";
import { makeCtx } from "../helpers.ts";
import { ContentStore } from "../../src/storage.ts";
import type { DocsProvider } from "../../src/providers/types.ts";
import { Context7Error } from "../../src/providers/context7.ts";

function mockDocsProvider(
  contextResponse: string = "# Docs\n\nSample documentation",
): DocsProvider {
  return {
    name: "context7",
    label: "Context7",
    searchLibrary: vi.fn().mockResolvedValue([]),
    getContext: vi.fn().mockResolvedValue(contextResponse),
  };
}

function createStore(): ContentStore {
  return new ContentStore(vi.fn());
}

describe("web_docs_fetch tool", () => {
  it("has correct tool metadata", () => {
    const tool = createWebDocsFetchTool(
      () => mockDocsProvider(),
      createStore(),
    );
    expect(tool.name).toBe("web_docs_fetch");
    expect(tool.label).toBe("Docs Fetch");
  });

  it("rejects empty libraryId", async () => {
    const tool = createWebDocsFetchTool(() => mockDocsProvider(), createStore());
    const ctx = makeCtx();
    await expect(
      tool.execute("call-1", { libraryId: "  ", query: "hooks" }, undefined, undefined, ctx),
    ).rejects.toThrow("libraryId");
  });

  it("rejects empty query", async () => {
    const tool = createWebDocsFetchTool(() => mockDocsProvider(), createStore());
    const ctx = makeCtx();
    await expect(
      tool.execute("call-1", { libraryId: "/facebook/react", query: "" }, undefined, undefined, ctx),
    ).rejects.toThrow("query");
  });

  it("returns documentation content on success", async () => {
    const content =
      "### useState\n\n```typescript\nconst [s, setS] = useState(0);\n```";
    const onUpdate = vi.fn();
    const tool = createWebDocsFetchTool(
      () => mockDocsProvider(content),
      createStore(),
    );
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-1",
      { libraryId: "/facebook/react", query: "How to use useState" },
      undefined,
      onUpdate,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).toContain("useState");
    expect(text).toContain("```typescript");

    // Verify onUpdate was called for progress
    expect(onUpdate).toHaveBeenCalled();
  });

  it("trims libraryId before calling provider", async () => {
    const provider = mockDocsProvider("docs");
    const tool = createWebDocsFetchTool(() => provider, createStore());
    const ctx = makeCtx();
    await tool.execute(
      "call-1",
      { libraryId: "  /facebook/react  ", query: "hooks" },
      undefined,
      undefined,
      ctx,
    );
    expect(provider.getContext).toHaveBeenCalledWith("/facebook/react", "hooks", undefined);
  });

  it("truncates and stores large content", async () => {
    const largeContent = "x".repeat(20_000);
    const store = createStore();
    const tool = createWebDocsFetchTool(
      () => mockDocsProvider(largeContent),
      store,
    );
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-2",
      { libraryId: "/facebook/react", query: "everything" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    // Should be truncated
    expect(text.length).toBeLessThan(20_000);
    expect(text).toContain("[truncated]");

    // Should have a contentId in details
    expect(result.details?.contentId).toBeDefined();

    // Store should have the full content
    const stored = store.get(result.details!.contentId!);
    expect(stored).toBeDefined();
    expect(stored!.text).toBe(largeContent);
    expect(stored!.source).toBe("web_docs_fetch");
  });

  it("does not store small content", async () => {
    const smallContent = "Short docs";
    const store = createStore();
    const tool = createWebDocsFetchTool(
      () => mockDocsProvider(smallContent),
      store,
    );
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-2b",
      { libraryId: "/facebook/react", query: "hooks" },
      undefined,
      undefined,
      ctx,
    );

    expect(result.details?.contentId).toBeUndefined();
    expect(result.details?.truncated).toBe(false);
  });

  it("returns setup message when provider unavailable", async () => {
    const tool = createWebDocsFetchTool(() => undefined, createStore());
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-3",
      { libraryId: "/facebook/react", query: "hooks" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).toContain("CONTEXT7_API_KEY");
  });

  it("returns friendly message for 202 (processing)", async () => {
    const provider: DocsProvider = {
      name: "context7",
      label: "Context7",
      searchLibrary: vi.fn(),
      getContext: vi
        .fn()
        .mockResolvedValue(
          "Library is being processed. Try again in a few minutes.",
        ),
    };
    const tool = createWebDocsFetchTool(() => provider, createStore());
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-4",
      { libraryId: "/new/lib", query: "anything" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).toContain("being processed");
  });

  it("throws on API errors", async () => {
    const failing: DocsProvider = {
      name: "context7",
      label: "Context7",
      searchLibrary: vi.fn(),
      getContext: vi
        .fn()
        .mockRejectedValue(new Context7Error("Library not found.")),
    };
    const tool = createWebDocsFetchTool(() => failing, createStore());
    const ctx = makeCtx();

    await expect(
      tool.execute(
        "call-5",
        { libraryId: "/nonexistent/lib", query: "anything" },
        undefined,
        undefined,
        ctx,
      ),
    ).rejects.toThrow(Context7Error);
  });

  it("passes signal to provider", async () => {
    const provider = mockDocsProvider("docs");
    const tool = createWebDocsFetchTool(() => provider, createStore());
    const ctx = makeCtx();
    const controller = new AbortController();

    await tool.execute(
      "call-6",
      { libraryId: "/facebook/react", query: "hooks" },
      controller.signal,
      undefined,
      ctx,
    );

    expect(provider.getContext).toHaveBeenCalledWith(
      "/facebook/react",
      "hooks",
      controller.signal,
    );
  });
});
