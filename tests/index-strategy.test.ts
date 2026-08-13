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

  it("passes the configured strategy to fetch, code-search, docs, and research selectors", async () => {
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
    if (research) {
      expect(researchSpy).toHaveBeenCalledWith("best-performing");
    }

    fetchStub.restore();
  });

  it("routes fetch, code-search, docs, and research to auto strategy by default", async () => {
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
    expect(researchSpy).toHaveBeenCalled();

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
