import * as fs from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import createExtension from "../src/index.ts";
import { ProviderRegistry } from "../src/providers/registry.ts";
import { createMockPi, makeCtx, stubFetch } from "./helpers.ts";

vi.mock("node:fs");

describe("selectionStrategy routing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.stubEnv("EXA_API_KEY", "exa-test-key");
    vi.stubEnv("CONTEXT7_API_KEY", "context7-test-key");
  });

  it("uses selectSearchByPerformance when selectionStrategy is best-performing", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ selectionStrategy: "best-performing" }),
    );

    const byPerformanceSpy = vi
      .spyOn(ProviderRegistry.prototype, "selectSearchByPerformance")
      .mockReturnValue(undefined);
    const candidatesSpy = vi.spyOn(ProviderRegistry.prototype, "selectSearchCandidates");

    const pi = createMockPi();
    createExtension(pi as unknown as ExtensionAPI);
    const ctx = makeCtx();
    pi.events.get("session_start")?.[0]?.({ type: "session_start", reason: "startup" }, ctx);

    const webSearch = pi.tools.find((t) => t.name === "web_search");
    expect(webSearch).toBeDefined();
    if (!webSearch) throw new Error("web_search tool not registered");
    await webSearch.execute("id", { query: "test" }, undefined, undefined, ctx);

    expect(byPerformanceSpy).toHaveBeenCalled();
    expect(candidatesSpy).not.toHaveBeenCalled();
  });

  it("uses selectSearchCandidates when selectionStrategy is auto", async () => {
    const byPerformanceSpy = vi.spyOn(ProviderRegistry.prototype, "selectSearchByPerformance");
    const candidatesSpy = vi
      .spyOn(ProviderRegistry.prototype, "selectSearchCandidates")
      .mockReturnValue([]);

    const pi = createMockPi();
    createExtension(pi as unknown as ExtensionAPI);
    const ctx = makeCtx();
    pi.events.get("session_start")?.[0]?.({ type: "session_start", reason: "startup" }, ctx);

    const webSearch = pi.tools.find((t) => t.name === "web_search");
    expect(webSearch).toBeDefined();
    if (!webSearch) throw new Error("web_search tool not registered");
    await webSearch.execute("id", { query: "test" }, undefined, undefined, ctx);

    expect(byPerformanceSpy).not.toHaveBeenCalled();
    expect(candidatesSpy).toHaveBeenCalled();
  });

  it("uses reloaded performance fusion settings while preserving explicit search overrides", async () => {
    let reloaded = false;
    const rankOneUrl = "https://rank-one.test";
    const sharedUrl = "https://shared-rank.test";
    const rankedResults = (provider: string) =>
      Array.from({ length: 31 }, (_, rank) => ({
        title: `${provider} ${rank}`,
        url:
          rank === 30
            ? sharedUrl
            : provider === "brave" && rank === 0
              ? rankOneUrl
              : `https://${provider}-${rank}.test`,
        snippet: `${provider} result ${rank}`,
      }));
    vi.stubEnv("BRAVE_API_KEY", "brave-test-key");
    vi.mocked(fs.readFileSync).mockImplementation(() =>
      JSON.stringify({
        providers: {
          "brave-llm": { enabled: false },
          duckduckgo: { enabled: false },
          exa: { enabled: true, apiKey: "exa-test-key" },
          brave: { enabled: true, apiKey: "brave-test-key" },
          searxng: { enabled: true, instanceUrl: "https://searxng.test" },
        },
        selectionStrategy: reloaded ? "best-performing" : "auto",
        combine: reloaded
          ? { enabled: true, mode: "targeted", targetBackends: 2, k: 23 }
          : { enabled: false, mode: "targeted", targetBackends: 3, k: 60 },
      }),
    );
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("api.exa.ai/search")) {
        const request = JSON.parse(String(init?.body));
        expect(request.numResults).toBe(request.query === "fused" ? 31 : 5);
        return new Response(
          JSON.stringify({
            results: rankedResults("exa").map(({ title, url: resultUrl, snippet }) => ({
              title,
              url: resultUrl,
              text: snippet,
            })),
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("api.search.brave.com")) {
        expect(url).toContain(`count=${reloaded ? 31 : 5}`);
        return new Response(
          JSON.stringify({
            web: {
              results: rankedResults("brave").map(({ title, url: resultUrl, snippet }) => ({
                title,
                url: resultUrl,
                description: snippet,
              })),
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("searxng.test")) {
        return new Response(
          JSON.stringify({
            results: rankedResults("searxng").map(({ title, url: resultUrl, snippet }) => ({
              title,
              url: resultUrl,
              content: snippet,
            })),
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return new Response("Not Found", { status: 404 });
    });
    const performance = vi.spyOn(ProviderRegistry.prototype, "selectSearchByPerformanceAll");

    const pi = createMockPi();
    createExtension(pi as unknown as ExtensionAPI);
    const ctx = makeCtx();
    ctx.ui.custom = vi
      .fn()
      .mockResolvedValueOnce({ type: "reload", activeTab: "status" })
      .mockResolvedValueOnce({ type: "close" }) as unknown as typeof ctx.ui.custom;
    pi.events.get("session_start")?.[0]?.({ type: "session_start", reason: "startup" }, ctx);

    const initial = pi.tools.find((tool) => tool.name === "web_search");
    if (!initial) throw new Error("web_search tool not registered");
    expect(
      (await initial.execute("initial", { query: "initial" }, undefined, undefined, ctx)).details,
    ).not.toHaveProperty("fusionMeta");

    reloaded = true;
    const command = pi.commands.find(({ name }) => name === "tools");
    if (!command) throw new Error("tools command not registered");
    await command.options.handler("", ctx);
    fetch.mockClear();

    const current = pi.tools.find((tool) => tool.name === "web_search");
    if (!current) throw new Error("web_search tool not registered");
    const fused = await current.execute(
      "fused",
      { query: "fused", numResults: 62 },
      undefined,
      undefined,
      ctx,
    );
    expect(performance).toHaveBeenCalled();
    const fusionCandidates = performance.mock.results.at(-1)?.value as
      | Array<{ name: string }>
      | undefined;
    expect(fusionCandidates?.map((provider) => provider.name)).toEqual(
      expect.arrayContaining(["brave", "exa", "searxng"]),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    const requestedUrls = fetch.mock.calls.map(([input]) => String(input));
    expect(requestedUrls).toEqual(
      expect.arrayContaining([
        expect.stringContaining("api.search.brave.com"),
        expect.stringContaining("api.exa.ai/search"),
      ]),
    );
    expect(requestedUrls.join("\n")).not.toContain("searxng.test");
    expect(fused.details).toMatchObject({
      provider: "fusion",
      fusionMeta: { providersUsed: ["brave", "exa"] },
    });
    const fusionDetails = fused.details as {
      fusionMeta?: { results: Array<{ url: string }> };
    };
    expect(fusionDetails.fusionMeta?.results[0]?.url).toBe(rankOneUrl);

    const explicit = await current.execute(
      "explicit",
      { query: "explicit", provider: "exa", combine: false },
      undefined,
      undefined,
      ctx,
    );
    expect(explicit.details).toMatchObject({ provider: "exa" });
    expect(explicit.details).not.toHaveProperty("fusionMeta");
    expect(fetch).toHaveBeenCalled();
  });

  it("passes the configured strategy to fetch, code-search, and docs without resolving research", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ selectionStrategy: "best-performing" }),
    );

    const fetchStub = stubFetch();
    fetchStub.addResponse("example.com/broken", {
      status: 500,
      body: "Internal Server Error",
      headers: { "content-type": "text/html" },
    });

    const fetchSpy = vi
      .spyOn(ProviderRegistry.prototype, "selectFetchCandidates")
      .mockReturnValue([]);
    const codeSpy = vi
      .spyOn(ProviderRegistry.prototype, "selectCodeSearch")
      .mockReturnValue(undefined);
    const docsSpy = vi
      .spyOn(ProviderRegistry.prototype, "selectDocsByStrategy")
      .mockReturnValue(undefined);
    const researchSpy = vi
      .spyOn(ProviderRegistry.prototype, "selectResearchCandidates")
      .mockReturnValue([]);

    const pi = createMockPi();
    createExtension(pi as unknown as ExtensionAPI);
    const ctx = makeCtx();
    pi.events.get("session_start")?.[0]?.({ type: "session_start", reason: "startup" }, ctx);

    const fetchTool = pi.tools.find((t) => t.name === "web_fetch");
    expect(fetchTool).toBeDefined();
    if (fetchTool) {
      await fetchTool.execute(
        "id",
        { url: "https://example.com/broken" },
        undefined,
        undefined,
        ctx,
      );
    }
    const codeTool = pi.tools.find((t) => t.name === "code_search");
    expect(codeTool).toBeDefined();
    if (codeTool) {
      await codeTool.execute("id", { query: "test" }, undefined, undefined, ctx);
    }
    const docsSearch = pi.tools.find((t) => t.name === "web_docs_search");
    expect(docsSearch).toBeDefined();
    if (docsSearch) {
      await docsSearch.execute(
        "id",
        { libraryName: "react", query: "hooks" },
        undefined,
        undefined,
        ctx,
      );
    }
    const research = pi.tools.find((t) => t.name === "web_research");

    expect(fetchSpy).toHaveBeenCalledWith("best-performing");
    expect(codeSpy).toHaveBeenCalledWith("best-performing");
    expect(docsSpy).toHaveBeenCalledWith("best-performing");
    expect(research).toBeDefined();
    expect(researchSpy).not.toHaveBeenCalled();

    fetchStub.restore();
  });

  it("routes fetch, code-search, and docs to auto without resolving research", async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const fetchStub = stubFetch();
    fetchStub.addResponse("example.com/broken", {
      status: 500,
      body: "Internal Server Error",
      headers: { "content-type": "text/html" },
    });

    const fetchSpy = vi
      .spyOn(ProviderRegistry.prototype, "selectFetchCandidates")
      .mockReturnValue([]);
    const codeSpy = vi
      .spyOn(ProviderRegistry.prototype, "selectCodeSearch")
      .mockReturnValue(undefined);
    const docsSpy = vi
      .spyOn(ProviderRegistry.prototype, "selectDocsByStrategy")
      .mockReturnValue(undefined);
    const researchSpy = vi
      .spyOn(ProviderRegistry.prototype, "selectResearchCandidates")
      .mockReturnValue([]);

    const pi = createMockPi();
    createExtension(pi as unknown as ExtensionAPI);
    const ctx = makeCtx();
    pi.events.get("session_start")?.[0]?.({ type: "session_start", reason: "startup" }, ctx);

    const fetchTool = pi.tools.find((t) => t.name === "web_fetch");
    if (fetchTool) {
      await fetchTool.execute(
        "id",
        { url: "https://example.com/broken" },
        undefined,
        undefined,
        ctx,
      );
    }
    const codeTool = pi.tools.find((t) => t.name === "code_search");
    if (codeTool) {
      await codeTool.execute("id", { query: "test" }, undefined, undefined, ctx);
    }
    const docsSearch = pi.tools.find((t) => t.name === "web_docs_search");
    if (docsSearch) {
      await docsSearch.execute(
        "id",
        { libraryName: "react", query: "hooks" },
        undefined,
        undefined,
        ctx,
      );
    }

    expect(fetchSpy).toHaveBeenCalledWith("auto");
    expect(codeSpy).toHaveBeenCalledWith("auto");
    expect(docsSpy).toHaveBeenCalledWith("auto");
    expect(pi.tools.find((tool) => tool.name === "web_research")).toBeDefined();
    expect(researchSpy).not.toHaveBeenCalled();

    fetchStub.restore();
  });

  it("records one outcome for a successful indexed code search", async () => {
    const fetchStub = stubFetch();
    fetchStub.addResponse("api.exa.ai/search", {
      body: {
        results: [{ title: "Result", url: "https://example.com", text: "snippet" }],
      },
    });
    const outcomeSpy = vi.spyOn(ProviderRegistry.prototype, "recordOutcome");

    try {
      const pi = createMockPi();
      createExtension(pi as unknown as ExtensionAPI);
      const ctx = makeCtx();
      pi.events.get("session_start")?.[0]?.({ type: "session_start", reason: "startup" }, ctx);

      const codeSearch = pi.tools.find((tool) => tool.name === "code_search");
      expect(codeSearch).toBeDefined();
      await codeSearch?.execute("id", { query: "test" }, undefined, undefined, ctx);

      expect(outcomeSpy).toHaveBeenCalledTimes(1);
      expect(outcomeSpy).toHaveBeenCalledWith("exa", {
        success: true,
        latencyMs: expect.any(Number),
      });
    } finally {
      fetchStub.restore();
    }
  });
});
