import { describe, expect, it } from "vitest";
import { createWebReadTool } from "../../src/tools/web-read.ts";
import { ContentStore } from "../../src/storage.ts";
import { makeCtx } from "../helpers.ts";

describe("web_read tool", () => {
  it("has correct tool metadata", () => {
    const store = new ContentStore(() => {});
    const tool = createWebReadTool(store);
    expect(tool.name).toBe("web_read");
    expect(tool.label).toBe("Web Read");
  });

  it("retrieves stored content by ID", async () => {
    const store = new ContentStore(() => {});
    const id = store.store({
      url: "https://example.com",
      title: "Example",
      text: "Full content here",
      source: "web_fetch",
    });

    const tool = createWebReadTool(store);
    const ctx = makeCtx();
    const result = await tool.execute("call-1", { contentId: id }, undefined, undefined, ctx);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Full content here");
  });

  it("falls back to URL when title is missing", async () => {
    const store = new ContentStore(() => {});
    const id = store.store({
      url: "https://example.com/no-title",
      text: "Content without title",
      source: "web_fetch",
    });

    const tool = createWebReadTool(store);
    const ctx = makeCtx();
    const result = await tool.execute("call-1", { contentId: id }, undefined, undefined, ctx);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/^# https:\/\/example\.com\/no-title/);
  });

  it("returns error for unknown content ID", async () => {
    const store = new ContentStore(() => {});
    const tool = createWebReadTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-2",
      { contentId: "wc-nonexistent" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("not found");
  });
});
