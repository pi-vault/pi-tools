import * as fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import createExtension from "../src/index.ts";
import { ProviderRegistry } from "../src/providers/registry.ts";
import { createMockPi, makeCtx } from "./helpers.ts";

vi.mock("node:fs");

describe("tools extension", () => {
  it("exports a function", () => {
    expect(typeof createExtension).toBe("function");
  });

  it("registers web_search tool", () => {
    const pi = createMockPi();
    // biome-ignore lint/suspicious/noExplicitAny: MockPi satisfies ExtensionAPI at runtime
    createExtension(pi as any);
    expect(pi.tools.some((t) => t.name === "web_search")).toBe(true);
  });

  it("registers web_read tool", () => {
    const pi = createMockPi();
    // biome-ignore lint/suspicious/noExplicitAny: MockPi satisfies ExtensionAPI at runtime
    createExtension(pi as any);
    expect(pi.tools.some((t) => t.name === "web_read")).toBe(true);
  });

  it("registers web_fetch tool", () => {
    const pi = createMockPi();
    // biome-ignore lint/suspicious/noExplicitAny: MockPi satisfies ExtensionAPI at runtime
    createExtension(pi as any);
    expect(pi.tools.some((t) => t.name === "web_fetch")).toBe(true);
  });

  it("restores content from session on session_start", async () => {
    const pi = createMockPi();
    // biome-ignore lint/suspicious/noExplicitAny: MockPi satisfies ExtensionAPI at runtime
    createExtension(pi as any);

    const handler = pi.events.get("session_start")?.[0];
    expect(handler).toBeDefined();

    const ctx = makeCtx({
      sessionManager: {
        getEntries: () => [
          {
            type: "custom",
            id: "e1",
            parentId: null,
            timestamp: "2026-01-01T00:00:00Z",
            customType: "pi-tools-content",
            data: {
              id: "wc-restored-1",
              url: "https://example.com",
              title: "Example",
              text: "Restored content",
              chars: 16,
              storedAt: "2026-01-01T00:00:00Z",
              source: "web_fetch",
            },
          },
        ],
        // biome-ignore lint/suspicious/noExplicitAny: partial mock for test
      } as any,
    });

    handler?.({ type: "session_start", reason: "resume" }, ctx);

    // Verify restore worked by using web_read tool to retrieve the content
    const webRead = pi.tools.find((t) => t.name === "web_read");
    expect(webRead).toBeDefined();
    if (!webRead) throw new Error("web_read tool not registered");
    const result = await webRead.execute(
      "call-1",
      { contentId: "wc-restored-1" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Restored content");
  });

  it("registers code_search tool", () => {
    const pi = createMockPi();
    // biome-ignore lint/suspicious/noExplicitAny: MockPi satisfies ExtensionAPI at runtime
    createExtension(pi as any);
    expect(pi.tools.some((t) => t.name === "code_search")).toBe(true);
  });

  it("skips invalid entries during session restore", async () => {
    const pi = createMockPi();
    // biome-ignore lint/suspicious/noExplicitAny: MockPi satisfies ExtensionAPI at runtime
    createExtension(pi as any);

    const handler = pi.events.get("session_start")?.[0];
    const ctx = makeCtx({
      sessionManager: {
        getEntries: () => [
          // Valid entry
          {
            type: "custom",
            id: "e1",
            parentId: null,
            timestamp: "2026-01-01T00:00:00Z",
            customType: "pi-tools-content",
            data: {
              id: "wc-valid",
              url: "https://example.com",
              title: "Valid",
              text: "Valid content",
              chars: 13,
              storedAt: "2026-01-01T00:00:00Z",
              source: "web_fetch",
            },
          },
          // Corrupt entry: missing required fields
          {
            type: "custom",
            id: "e2",
            parentId: null,
            timestamp: "2026-01-01T00:00:00Z",
            customType: "pi-tools-content",
            data: { id: "wc-corrupt", garbage: true },
          },
          // Non-matching custom entry
          {
            type: "custom",
            id: "e3",
            parentId: null,
            timestamp: "2026-01-01T00:00:00Z",
            customType: "other-extension",
            data: { foo: "bar" },
          },
        ],
        // biome-ignore lint/suspicious/noExplicitAny: partial mock for test
      } as any,
    });

    // Should not throw despite corrupt data
    expect(() => handler?.({ type: "session_start", reason: "resume" }, ctx)).not.toThrow();

    // Valid entry should be accessible
    const webRead = pi.tools.find((t) => t.name === "web_read");
    expect(webRead).toBeDefined();
    if (!webRead) throw new Error("web_read tool not registered");
    const validResult = await webRead.execute(
      "r1",
      { contentId: "wc-valid" },
      undefined,
      undefined,
      ctx,
    );
    const validText = (validResult.content[0] as { type: "text"; text: string }).text;
    expect(validText).toContain("Valid content");

    // Corrupt entry should NOT be accessible (filtered out by validation)
    const corruptResult = await webRead.execute(
      "r2",
      { contentId: "wc-corrupt" },
      undefined,
      undefined,
      ctx,
    );
    const corruptText = (corruptResult.content[0] as { type: "text"; text: string }).text;
    expect(corruptText.toLowerCase()).toContain("not found");
  });
});

describe("before_provider_request rewrite handler", () => {
  it("rewrites web_search tool to native format for OpenAI models", () => {
    const pi = createMockPi();
    // biome-ignore lint/suspicious/noExplicitAny: MockPi satisfies ExtensionAPI at runtime
    createExtension(pi as any);

    // Second handler is the Layer 1 rewrite (first is trust recorder)
    const handler = pi.events.get("before_provider_request")?.[1];
    expect(handler).toBeDefined();

    const payload = {
      tools: [{ type: "function", function: { name: "web_search", parameters: {} } }],
      messages: [{ role: "user", content: "hello" }],
    };
    const ctx = makeCtx({ model: { provider: "openai" } });

    const result = handler?.({ type: "before_provider_request", payload }, ctx) as typeof payload;

    expect(result?.tools?.[0]).toEqual({ type: "web_search", external_web_access: true });
    expect(result?.messages).toEqual(payload.messages);
  });

  it("does not rewrite for non-OpenAI models", () => {
    const pi = createMockPi();
    // biome-ignore lint/suspicious/noExplicitAny: MockPi satisfies ExtensionAPI at runtime
    createExtension(pi as any);

    const handler = pi.events.get("before_provider_request")?.[1];
    const payload = {
      tools: [{ type: "function", function: { name: "web_search", parameters: {} } }],
    };
    const ctx = makeCtx({ model: { provider: "anthropic" } });

    const result = handler?.({ type: "before_provider_request", payload }, ctx);

    // Returns undefined → no rewrite
    expect(result).toBeUndefined();
  });

  it("does not rewrite when openai-web-search is disabled in config", () => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      if (typeof filePath === "string" && filePath.endsWith("tools.json")) {
        return JSON.stringify({ providers: { "openai-web-search": { enabled: false } } });
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const pi = createMockPi();
    // biome-ignore lint/suspicious/noExplicitAny: MockPi satisfies ExtensionAPI at runtime
    createExtension(pi as any);

    const handler = pi.events.get("before_provider_request")?.[1];
    const payload = {
      tools: [{ type: "function", function: { name: "web_search", parameters: {} } }],
    };
    const ctx = makeCtx({ model: { provider: "openai" } });

    const result = handler?.({ type: "before_provider_request", payload }, ctx);

    expect(result).toBeUndefined();
  });
});

describe("defaultProvider wiring", () => {
  it("passes configured defaultProvider to selector when web_search call omits provider", async () => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      if (typeof filePath === "string" && filePath.endsWith("tools.json")) {
        return JSON.stringify({ defaultProvider: "exa" });
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const selectCandidatesSpy = vi
      .spyOn(ProviderRegistry.prototype, "selectSearchCandidates")
      .mockReturnValue([]);

    const pi = createMockPi();
    createExtension(pi as any); // biome-ignore lint/suspicious/noExplicitAny: MockPi satisfies ExtensionAPI at runtime

    const webSearch = pi.tools.find((t) => t.name === "web_search")!;
    const ctx = makeCtx();
    await webSearch.execute(
      "call-default-provider",
      { query: "test query" },
      undefined,
      undefined,
      ctx,
    );

    expect(selectCandidatesSpy).toHaveBeenCalledWith("exa");
  });

  it("prefers explicit provider over configured defaultProvider", async () => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      if (typeof filePath === "string" && filePath.endsWith("tools.json")) {
        return JSON.stringify({ defaultProvider: "exa" });
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const selectCandidatesSpy = vi
      .spyOn(ProviderRegistry.prototype, "selectSearchCandidates")
      .mockReturnValue([]);

    const pi = createMockPi();
    createExtension(pi as any); // biome-ignore lint/suspicious/noExplicitAny: MockPi satisfies ExtensionAPI at runtime

    const webSearch = pi.tools.find((t) => t.name === "web_search")!;
    const ctx = makeCtx();
    await webSearch.execute(
      "call-explicit-provider",
      { query: "test query", provider: "duckduckgo" },
      undefined,
      undefined,
      ctx,
    );

    expect(selectCandidatesSpy).toHaveBeenCalledWith("duckduckgo");
  });
});
