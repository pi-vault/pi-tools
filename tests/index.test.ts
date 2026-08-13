import * as fs from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import createExtension from "../src/index.ts";
import { loadMergedConfig } from "../src/config.ts";
import { allProviders } from "../src/providers/all.ts";
import { ProviderRegistry } from "../src/providers/registry.ts";
import { _resetTrustRegistry } from "../src/utils/trust.ts";
import { createMockPi, makeCtx, type MockPi } from "./helpers.ts";

vi.mock("node:fs");

beforeEach(() => {
  vi.mocked(fs.readFileSync).mockImplementation(() => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  });
  vi.mocked(fs.existsSync).mockReturnValue(false);
});

function startSession(pi: MockPi, ctx = makeCtx()): void {
  const handler = pi.events.get("session_start")?.[0];
  expect(handler).toBeDefined();
  handler?.({ type: "session_start", reason: "startup" }, ctx);
}

describe("tools extension", () => {
  it("exports a function", () => {
    expect(typeof createExtension).toBe("function");
  });

  it("defers config-dependent tools until session_start", () => {
    const pi = createMockPi();
    createExtension(pi as never);

    expect(pi.tools).toEqual([]);

    startSession(pi);

    expect(pi.tools.map((tool) => tool.name)).toEqual([
      "web_search",
      "web_fetch",
      "web_read",
      "code_search",
      "web_docs_search",
      "web_docs_fetch",
      "web_research",
    ]);
  });

  it("replaces tool definitions without duplicates after a /tools refresh", async () => {
    const oldSnippet = "Search with old guidance.";
    const newSnippet = "Search with refreshed guidance.";
    let refreshed = false;
    vi.mocked(fs.readFileSync).mockImplementation(() =>
      JSON.stringify({
        guidance: { web_search: { promptSnippet: refreshed ? newSnippet : oldSnippet } },
      }),
    );

    const pi = createMockPi();
    createExtension(pi as never);
    const ctx = makeCtx();
    ctx.ui.custom = vi
      .fn()
      .mockResolvedValueOnce({ type: "reload", activeTab: "status" })
      .mockResolvedValueOnce({ type: "close" }) as unknown as typeof ctx.ui.custom;
    startSession(pi, ctx);
    const initialWebSearch = pi.tools.find((tool) => tool.name === "web_search");
    expect(initialWebSearch?.promptSnippet).toBe(oldSnippet);

    refreshed = true;
    const command = pi.commands.find(({ name }) => name === "tools");
    if (!command) throw new Error("tools command not registered");
    await command.options.handler("", ctx);

    const names = pi.tools.map((tool) => tool.name);
    expect(names).toEqual([
      "web_search",
      "web_fetch",
      "web_read",
      "code_search",
      "web_docs_search",
      "web_docs_fetch",
      "web_research",
    ]);
    expect(new Set(names).size).toBe(names.length);
    expect(pi.tools.filter((tool) => tool.name === "web_search")).toHaveLength(1);
    const refreshedWebSearch = pi.tools.find((tool) => tool.name === "web_search");
    expect(refreshedWebSearch).not.toBe(initialWebSearch);
    expect(refreshedWebSearch?.promptSnippet).not.toBe(oldSnippet);
    expect(refreshedWebSearch?.promptSnippet).toBe(newSnippet);
  });

  it("keeps optional tools stable while trust gates project credentials until reload", async () => {
    _resetTrustRegistry();
    vi.stubEnv("EXA_API_KEY", "");
    vi.stubEnv("CONTEXT7_API_KEY", "");

    try {
      const cwd = "/projects/trusted";
      const configPath = path.join(cwd, ".pi", "tools.json");
      const duckduckgoConfig = { enabled: true, budget: { mode: "unlimited" } };
      let trusted = false;
      const exa = allProviders.find(({ name }) => name === "exa");
      const context7 = allProviders.find(({ name }) => name === "context7");
      const duckduckgo = allProviders.find(({ name }) => name === "duckduckgo");
      if (!exa || !context7 || !duckduckgo) throw new Error("provider metadata not found");
      const exaCreate = vi.spyOn(exa, "create");
      const context7Create = vi.spyOn(context7, "create");
      const duckduckgoCreate = vi.spyOn(duckduckgo, "create");
      const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith("https://context7.com/api/v2/libs/search")) {
          return new Response(
            JSON.stringify({
              results: [
                {
                  id: "/facebook/react",
                  title: "React",
                  description: "A UI library",
                  totalSnippets: 1,
                  trustScore: 1,
                  benchmarkScore: 1,
                },
              ],
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        if (url === "https://api.exa.ai/search") {
          return new Response(JSON.stringify({ answer: "Trusted research result", results: [] }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("Not Found", { status: 404 });
      });
      vi.mocked(fs.existsSync).mockImplementation((candidate) => candidate === configPath);
      vi.mocked(fs.readFileSync).mockImplementation((candidate) => {
        const filePath = typeof candidate === "string" ? candidate : candidate.toString();
        if (filePath === configPath) {
          return JSON.stringify({
            providers: {
              exa: { enabled: true, apiKey: "literal-exa-key", baseUrl: "https://private.exa" },
              context7: {
                enabled: true,
                apiKey: "literal-context7-key",
                baseUrl: "https://private.context7",
              },
              duckduckgo: { ...duckduckgoConfig, baseUrl: "https://private.duckduckgo" },
            },
            gemini: { allowBrowserCookies: true, baseUrl: "https://private.gemini" },
            ssrf: { allowRanges: ["10.0.0.0/8"] },
            deepResearch: { enabled: true },
          });
        }
        throw new Error("ENOENT");
      });

      const pi = createMockPi();
      createExtension(pi as never);
      const ctx = makeCtx({ cwd, isProjectTrusted: () => trusted });
      ctx.ui.custom = vi
        .fn()
        .mockResolvedValueOnce({ type: "reload", activeTab: "status" })
        .mockResolvedValueOnce({ type: "close" }) as unknown as typeof ctx.ui.custom;
      startSession(pi, ctx);

      const untrustedConfig = loadMergedConfig(cwd);
      expect(untrustedConfig.providers.duckduckgo).toEqual(duckduckgoConfig);
      expect(untrustedConfig.gemini).toEqual({});
      expect(untrustedConfig.ssrf.allowRanges).toEqual([]);
      expect(duckduckgoCreate.mock.calls[0]?.slice(0, 2)).toEqual([
        undefined,
        { ...duckduckgoConfig, ssrfAllowRanges: [] },
      ]);
      expect(exaCreate).toHaveBeenCalledTimes(0);
      expect(context7Create).toHaveBeenCalledTimes(0);

      const docs = pi.tools.find((tool) => tool.name === "web_docs_search");
      const research = pi.tools.find((tool) => tool.name === "web_research");
      if (!docs || !research) throw new Error("stable optional tools not registered");
      const unavailable = await docs.execute(
        "docs-untrusted",
        { libraryName: "react", query: "hooks" },
        undefined,
        undefined,
        ctx,
      );
      expect((unavailable.content[0] as { text: string }).text).toContain("CONTEXT7_API_KEY");
      await expect(
        research.execute("research-untrusted", { query: "hooks" }, undefined, undefined, ctx),
      ).rejects.toThrow("disabled or unavailable");
      expect(fetch).not.toHaveBeenCalled();

      trusted = true;
      pi.events.get("model_select")?.[0]?.({ type: "model_select" }, ctx);
      const command = pi.commands.find(({ name }) => name === "tools");
      if (!command) throw new Error("tools command not registered");
      await command.options.handler("", ctx);

      expect(pi.tools.map((tool) => tool.name)).toEqual([
        "web_search",
        "web_fetch",
        "web_read",
        "code_search",
        "web_docs_search",
        "web_docs_fetch",
        "web_research",
      ]);
      expect(exaCreate).toHaveBeenCalledTimes(1);
      expect(context7Create).toHaveBeenCalledTimes(1);

      const reloadedDocs = pi.tools.find((tool) => tool.name === "web_docs_search");
      const reloadedResearch = pi.tools.find((tool) => tool.name === "web_research");
      if (!reloadedDocs || !reloadedResearch) throw new Error("stable optional tools not registered");
      const docsResult = await reloadedDocs.execute(
        "docs-trusted",
        { libraryName: "react", query: "hooks" },
        undefined,
        undefined,
        ctx,
      );
      expect(docsResult.details).toMatchObject({ provider: "context7", resultCount: 1 });
      const researchResult = await reloadedResearch.execute(
        "research-trusted",
        { query: "hooks" },
        undefined,
        undefined,
        ctx,
      );
      expect((researchResult.content[0] as { text: string }).text).toContain("Trusted research result");
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("context7.com/api/v2/libs/search"),
        expect.objectContaining({ headers: { Authorization: "Bearer literal-context7-key" } }),
      );
      expect(fetch).toHaveBeenCalledWith(
        "https://api.exa.ai/search",
        expect.objectContaining({ headers: expect.objectContaining({ "x-api-key": "literal-exa-key" }) }),
      );
    } finally {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      _resetTrustRegistry();
    }
  });

  it("registers web_search tool", () => {
    const pi = createMockPi();
    // biome-ignore lint/suspicious/noExplicitAny: MockPi satisfies ExtensionAPI at runtime
    createExtension(pi as any);
    startSession(pi);
    expect(pi.tools.some((t) => t.name === "web_search")).toBe(true);
  });

  it("registers web_read tool", () => {
    const pi = createMockPi();
    // biome-ignore lint/suspicious/noExplicitAny: MockPi satisfies ExtensionAPI at runtime
    createExtension(pi as any);
    startSession(pi);
    expect(pi.tools.some((t) => t.name === "web_read")).toBe(true);
  });

  it("registers web_fetch tool", () => {
    const pi = createMockPi();
    // biome-ignore lint/suspicious/noExplicitAny: MockPi satisfies ExtensionAPI at runtime
    createExtension(pi as any);
    startSession(pi);
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
    startSession(pi);
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

    // Handler is the combined handleProviderRequest from session.ts
    const handler = pi.events.get("before_provider_request")?.[0];
    expect(handler).toBeDefined();

    const payload = {
      tools: [{ type: "function", function: { name: "web_search", parameters: {} } }],
      messages: [{ role: "user", content: "hello" }],
    };
    // biome-ignore lint/suspicious/noExplicitAny: partial model mock for test
    const ctx = makeCtx({ model: { provider: "openai" } as any });
    startSession(pi, ctx);

    const result = handler?.({ type: "before_provider_request", payload }, ctx) as typeof payload;

    expect(result?.tools?.[0]).toEqual({ type: "web_search", external_web_access: true });
    expect(result?.messages).toEqual(payload.messages);
  });

  it("does not rewrite for non-OpenAI models", () => {
    const pi = createMockPi();
    // biome-ignore lint/suspicious/noExplicitAny: MockPi satisfies ExtensionAPI at runtime
    createExtension(pi as any);

    const handler = pi.events.get("before_provider_request")?.[0];
    const payload = {
      tools: [{ type: "function", function: { name: "web_search", parameters: {} } }],
    };
    // biome-ignore lint/suspicious/noExplicitAny: partial model mock for test
    const ctx = makeCtx({ model: { provider: "anthropic" } as any });
    startSession(pi, ctx);

    const result = handler?.({ type: "before_provider_request", payload }, ctx);

    // Returns undefined → no rewrite
    expect(result).toBeUndefined();
  });

  it("refreshes config in the handler when openai-web-search is disabled", () => {
    let disabled = false;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T00:00:00Z"));
    vi.mocked(fs.readFileSync).mockImplementation(() =>
      disabled ? JSON.stringify({ providers: { "openai-web-search": { enabled: false } } }) : "{}",
    );

    try {
      const pi = createMockPi();
      createExtension(pi as never);
      const ctx = makeCtx({ model: { provider: "openai" } as never });
      startSession(pi, ctx);
      const handler = pi.events.get("before_provider_request")?.[0];
      const payload = () => ({
        tools: [{ type: "function", function: { name: "web_search", parameters: {} } }],
      });

      expect(handler?.({ type: "before_provider_request", payload: payload() }, ctx)).toMatchObject(
        {
          tools: [{ type: "web_search", external_web_access: true }],
        },
      );

      disabled = true;
      vi.advanceTimersByTime(30_000);

      expect(
        handler?.({ type: "before_provider_request", payload: payload() }, ctx),
      ).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
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

    const handler = pi.events.get("before_provider_request")?.[0];
    const payload = {
      tools: [{ type: "function", function: { name: "web_search", parameters: {} } }],
    };
    // biome-ignore lint/suspicious/noExplicitAny: partial model mock for test
    const ctx = makeCtx({ model: { provider: "openai" } as any });
    startSession(pi, ctx);

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

    const ctx = makeCtx();
    startSession(pi, ctx);
    const webSearch = pi.tools.find((t) => t.name === "web_search")!;
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

    const ctx = makeCtx();
    startSession(pi, ctx);
    const webSearch = pi.tools.find((t) => t.name === "web_search")!;
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
