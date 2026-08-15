import { describe, expect, it, vi, beforeEach } from "vitest";
import createExtension from "../src/index.ts";
import { loadMergedConfig } from "../src/config.ts";
import { createMockPi, makeCtx } from "./helpers.ts";
import { ProviderRegistry } from "../src/providers/registry.ts";

vi.mock("node:fs");

vi.mock("../src/config.ts", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    loadMergedConfig: vi.fn(),
  };
});

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    withFileMutationQueue: async (_path: string, fn: () => Promise<void>) => fn(),
  };
});

// biome-ignore lint/suspicious/noExplicitAny: partial mock config
function mockConfig(overrides: Record<string, unknown> = {}) {
  return {
    defaultProvider: "auto",
    selectionStrategy: "auto",
    providers: {
      exa: {
        enabled: true,
        apiKey: "test-key",
        budget: { mode: "hard", limit: 10, period: "month", unit: "usd", pool: "exa" },
      },
    },
    github: { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
    ssrf: { allowRanges: [] },
    combine: { enabled: false, mode: "targeted", targetBackends: 3, k: 60 },
    deepResearch: { enabled: true },
    ...overrides,
  } as any;
}

describe("web_research registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps unavailable docs and research definitions executable with their existing errors", async () => {
    vi.mocked(loadMergedConfig).mockReturnValue(
      mockConfig({
        providers: { exa: { enabled: true, apiKey: "EXA_API_KEY" } },
      }),
    );
    delete process.env.EXA_API_KEY;
    delete process.env.CONTEXT7_API_KEY;

    const pi = createMockPi();
    createExtension(pi as never);
    const ctx = makeCtx();
    pi.events.get("session_start")?.[0]?.({ type: "session_start", reason: "startup" }, ctx);

    const docs = pi.tools.find((tool) => tool.name === "web_docs_search");
    const research = pi.tools.find((tool) => tool.name === "web_research");
    if (!docs || !research) throw new Error("stable optional tools not registered");

    const docsResult = await docs.execute(
      "docs",
      { libraryName: "react", query: "hooks" },
      undefined,
      undefined,
      ctx,
    );
    expect((docsResult.content[0] as { text: string }).text).toContain("CONTEXT7_API_KEY");
    await expect(research.execute("research", { query: "test" }, undefined, undefined, ctx)).rejects.toThrow(
      "disabled or unavailable",
    );
  });

  it("passes research operation metadata to the registry", async () => {
    vi.mocked(loadMergedConfig).mockReturnValue(mockConfig());
    const consume = vi.spyOn(ProviderRegistry.prototype, "consume");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: [], answer: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const pi = createMockPi();
    createExtension(pi as never);
    const ctx = makeCtx();
    pi.events.get("session_start")?.[0]?.({ type: "session_start", reason: "startup" }, ctx);

    const tool = pi.tools.find((candidate) => candidate.name === "web_research")!;
    await tool.execute(
      "call",
      { query: "test", type: "deep-lite", numResults: 5, summaryQuery: "summary" },
      undefined,
      vi.fn(),
      ctx,
    );

    expect(consume).toHaveBeenCalledWith("exa", {
      capability: "research",
      type: "deep-lite",
      maxResults: 5,
      contentTypes: 3,
    });
  });

  it("blocks research after deep research is disabled on reload", async () => {
    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(mockConfig())
      .mockReturnValue(mockConfig({ deepResearch: { enabled: false } }));
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: [], answer: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const pi = createMockPi();
    createExtension(pi as never);
    const ctx = makeCtx();
    const custom = vi
      .fn()
      .mockResolvedValueOnce({ type: "reload", activeTab: "status" })
      .mockResolvedValueOnce({ type: "close" });
    ctx.ui.custom = custom as unknown as typeof ctx.ui.custom;
    pi.events.get("session_start")?.[0]?.({ type: "session_start", reason: "startup" }, ctx);
    const command = pi.commands.find(({ name }) => name === "tools");
    if (!command) throw new Error("tools command not registered");
    await command.options.handler("", ctx);

    const tool = pi.tools.find(({ name }) => name === "web_research");
    if (!tool) throw new Error("web_research tool not registered");
    await expect(tool.execute("call", { query: "test" }, undefined, vi.fn(), ctx)).rejects.toThrow(
      "disabled",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not use a stale docs provider after it is disabled on reload", async () => {
    const context7 = {
      enabled: true,
      apiKey: "context7-key",
      budget: { mode: "hard", limit: 1000, period: "month", unit: "request" },
    };
    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(
        mockConfig({
          providers: { ...mockConfig().providers, context7 },
        }),
      )
      .mockReturnValue(
        mockConfig({
          providers: { ...mockConfig().providers, context7: { ...context7, enabled: false } },
        }),
      );
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const pi = createMockPi();
    createExtension(pi as never);
    const ctx = makeCtx();
    const custom = vi
      .fn()
      .mockResolvedValueOnce({ type: "reload", activeTab: "status" })
      .mockResolvedValueOnce({ type: "close" });
    ctx.ui.custom = custom as unknown as typeof ctx.ui.custom;
    pi.events.get("session_start")?.[0]?.({ type: "session_start", reason: "startup" }, ctx);
    const command = pi.commands.find(({ name }) => name === "tools");
    if (!command) throw new Error("tools command not registered");
    await command.options.handler("", ctx);

    const tool = pi.tools.find(({ name }) => name === "web_docs_search");
    if (!tool) throw new Error("web_docs_search tool not registered");
    const result = await tool.execute(
      "call",
      { libraryName: "react", query: "hooks" },
      undefined,
      vi.fn(),
      ctx,
    );

    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("CONTEXT7_API_KEY") });
    expect(fetch).not.toHaveBeenCalled();
  });
});
