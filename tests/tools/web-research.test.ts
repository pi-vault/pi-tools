import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebResearchTool } from "../../src/tools/web-research.ts";
import type { ResearchProvider } from "../../src/providers/types.ts";
import { stubFetch } from "../helpers.ts";
import { makeCtx } from "../helpers.ts";
import * as fsPromises from "node:fs/promises";

vi.mock("node:fs/promises");
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    withFileMutationQueue: async (_path: string, fn: () => Promise<void>) => fn(),
  };
});

function makeClient(): ResearchProvider {
  return {
    name: "exa",
    label: "Exa",
    deepResearch: vi.fn().mockImplementation(async (params) => ({
      answer: "Answer",
      results: params.numResults ? [{ title: "Source", url: "https://example.com", text: "x" }] : [],
      raw: {},
      metadata: { request: {} },
    })),
  };
}

describe("createWebResearchTool", () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  const appendEntry = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchStub = stubFetch();
    vi.mocked(fsPromises.readFile).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);
  });
  afterEach(() => {
    fetchStub.restore();
    vi.restoreAllMocks();
  });

  function makeTool(opts: { enableCandidates?: boolean } = {}) {
    return createWebResearchTool(
      () => (opts.enableCandidates === false ? [] : [makeClient()]),
      { enabled: true },
      appendEntry,
     undefined,
      { onSuccess: vi.fn(), onFailure: vi.fn() },
    );
  }

  it("has correct name and description", () => {
    const tool = makeTool();
    expect(tool.name).toBe("web_research");
    expect(tool.label).toBe("Web Research");
  });

  it("executes research and returns inline report when no outputPath", async () => {
    const tool = makeTool();
    const result = await tool.execute("call-1", { query: "What is X?" }, undefined, vi.fn(), makeCtx());
    const text = result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
    expect(text).toContain("Findings:");
    expect(text).toContain("Answer");
  });

  it("writes report to outputPath when specified", async () => {
    const tool = makeTool();
    await tool.execute("call-2", { query: "test", outputPath: "findings.md" }, undefined, vi.fn(), makeCtx());

    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalled();
    const writeCall = vi.mocked(fsPromises.writeFile).mock.calls[0];
    expect(String(writeCall[0])).toContain("findings.md");
  });

  it("writes raw sidecar for findings format", async () => {
    const tool = makeTool();
    await tool.execute(
      "call-3",
      { query: "test", outputPath: "findings.md", reportFormat: "findings" },
      undefined,
      vi.fn(),
      makeCtx(),
    );

    const writeCalls = vi.mocked(fsPromises.writeFile).mock.calls;
    expect(writeCalls.length).toBe(2);
    const sidecarPath = String(writeCalls[1][0]);
    expect(sidecarPath).toContain("findings.raw.json");
  });

  it("does not write raw sidecar for json format", async () => {
    const tool = makeTool();
    await tool.execute(
      "call-4",
      { query: "test", outputPath: "out.json", reportFormat: "json" },
      undefined,
      vi.fn(),
      makeCtx(),
    );

    const writeCalls = vi.mocked(fsPromises.writeFile).mock.calls;
    expect(writeCalls.length).toBe(1);
  });

  it("calls appendEntry with research metadata", async () => {
    const tool = makeTool();
    await tool.execute("call-5", { query: "test" }, undefined, vi.fn(), makeCtx());

    expect(appendEntry).toHaveBeenCalledWith(
      "pi-tools-research",
      expect.objectContaining({
        query: "test",
        sourceCount: 1,
      }),
    );
  });

  it("deduplicates results across multiple queries in full mode", async () => {
    const client = makeClient();
    let callCount = 0;
    vi.mocked(client.deepResearch).mockImplementation(async () => {
      callCount++;
      const body =
        callCount === 1
          ? {
              results: [
                { title: "Shared", url: "https://shared.com", text: "shared content" },
                { title: "Only Q1", url: "https://q1.com", text: "q1 content" },
              ],
              answer: "Answer from query 1.",
            }
          : {
              results: [
                { title: "Shared", url: "https://shared.com", text: "shared content again" },
                { title: "Only Q2", url: "https://q2.com", text: "q2 content" },
              ],
              answer: "Answer from query 2.",
            };
      return { answer: body.answer, results: body.results, raw: body, metadata: {} };
    });
    const tool = createWebResearchTool(
      () => [client],
      { enabled: true },
      appendEntry,
      undefined,
      { onSuccess: vi.fn(), onFailure: vi.fn() },
    );

    const result = await tool.execute(
      "call-full",
      {
        query: "main question",
        researchMode: "full",
        additionalQueries: ["follow-up question"],
      },
      undefined,
      vi.fn(),
      makeCtx(),
    );

    expect(callCount).toBe(2);
    expect(appendEntry).toHaveBeenCalledWith(
      "pi-tools-research",
      expect.objectContaining({ sourceCount: 3 }),
    );
    const text = result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
    expect(text).toContain("Answer from query 1.");
    expect(text).toContain("Answer from query 2.");
  });

  it("falls back between registered candidates through shared hooks", async () => {
    const failing: ResearchProvider = {
      name: "first",
      label: "First",
      deepResearch: vi.fn().mockRejectedValue(new Error("first failed")),
    };
    const working = makeClient();
    const hooks = { onSuccess: vi.fn(), onFailure: vi.fn() };
    const tool = createWebResearchTool(
      () => [failing, working],
      { enabled: true },
      appendEntry,
      undefined,
      hooks,
    );

    await tool.execute("call-fallback", { query: "test" }, undefined, vi.fn(), makeCtx());

    expect(hooks.onFailure).toHaveBeenCalledWith("first");
    expect(hooks.onSuccess).toHaveBeenCalledWith("exa", expect.any(Number));
  });

  it("collapses duplicate queries in full mode", async () => {
    const client = makeClient();
    const tool = createWebResearchTool(
      () => [client],
      { enabled: true },
      appendEntry,
      undefined,
      { onSuccess: vi.fn(), onFailure: vi.fn() },
    );
    await tool.execute(
      "call-dedup-queries",
      {
        query: "same question",
        researchMode: "full",
        additionalQueries: ["same question"],
      },
      undefined,
      vi.fn(),
      makeCtx(),
    );

    expect(vi.mocked(client.deepResearch)).toHaveBeenCalledTimes(1);
  });

  it("throws when deepResearch is disabled", async () => {
    const tool = createWebResearchTool(
      () => [makeClient()],
      { enabled: false },
      appendEntry,
    );
    await expect(
      tool.execute("call-6", { query: "test" }, undefined, vi.fn(), makeCtx()),
    ).rejects.toThrow(/disabled/);
  });

  it("throws when no research candidates are registered", async () => {
    const tool = createWebResearchTool(
      () => [],
      { enabled: true },
      appendEntry,
    );
    await expect(
      tool.execute("call-no-candidate", { query: "test" }, undefined, vi.fn(), makeCtx()),
    ).rejects.toThrow(/disabled|unavailable/i);
  });

  it("throws when query is missing", async () => {
    const tool = makeTool();
    await expect(tool.execute("call-7", {}, undefined, vi.fn(), makeCtx())).rejects.toThrow(
      /requires query/,
    );
  });

  it("propagates cancellation through the registered client", async () => {
    const client = makeClient();
    vi.mocked(client.deepResearch).mockImplementation(async (_params, signal) => {
      signal?.throwIfAborted();
      throw new Error("aborted");
    });
    const tool = createWebResearchTool(
      () => [client],
      { enabled: true },
      appendEntry,
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      tool.execute("call-abort", { query: "test" }, controller.signal, vi.fn(), makeCtx()),
    ).rejects.toThrow(/aborted/);
  });
});
