import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebResearchTool } from "../../src/tools/web-research.ts";
import { stubFetch } from "../helpers.ts";
import { makeCtx } from "../helpers.ts";
import * as fsPromises from "node:fs/promises";

vi.mock("node:fs/promises");
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    withFileMutationQueue: async (_path: string, fn: () => Promise<void>) =>
      fn(),
  };
});

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

  function makeTool() {
    return createWebResearchTool(
      "test-exa-key",
      { enabled: true },
      appendEntry,
    );
  }

  it("has correct name and description", () => {
    const tool = makeTool();
    expect(tool.name).toBe("web_research");
    expect(tool.label).toBe("Web Research");
  });

  it("executes research and returns inline report when no outputPath", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: {
        results: [
          { title: "Source", url: "https://example.com", text: "content" },
        ],
        answer: "The answer is X.",
      },
    });

    const tool = makeTool();
    const result = await tool.execute(
      "call-1",
      { query: "What is X?" },
      undefined,
      vi.fn(),
      makeCtx(),
    );
    const text =
      result.content[0] && "text" in result.content[0]
        ? result.content[0].text
        : "";
    expect(text).toContain("Findings:");
    expect(text).toContain("The answer is X.");
  });

  it("writes report to outputPath when specified", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [], answer: "Answer" },
    });

    const tool = makeTool();
    await tool.execute(
      "call-2",
      { query: "test", outputPath: "findings.md" },
      undefined,
      vi.fn(),
      makeCtx(),
    );

    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalled();
    const writeCall = vi.mocked(fsPromises.writeFile).mock.calls[0];
    expect(String(writeCall[0])).toContain("findings.md");
  });

  it("writes raw sidecar for findings format", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [], answer: "Answer" },
    });

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
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [], answer: "Answer" },
    });

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
    fetchStub.addResponse("api.exa.ai/search", {
      body: {
        results: [{ title: "A", url: "https://a.com", text: "text" }],
        answer: "Answer",
      },
    });

    const tool = makeTool();
    await tool.execute(
      "call-5",
      { query: "test" },
      undefined,
      vi.fn(),
      makeCtx(),
    );

    expect(appendEntry).toHaveBeenCalledWith(
      "pi-tools-research",
      expect.objectContaining({
        query: "test",
        sourceCount: 1,
      }),
    );
  });

  it("throws when deepResearch is disabled", async () => {
    const tool = createWebResearchTool("key", { enabled: false }, appendEntry);
    await expect(
      tool.execute("call-6", { query: "test" }, undefined, vi.fn(), makeCtx()),
    ).rejects.toThrow(/disabled/);
  });

  it("throws when query is missing", async () => {
    const tool = makeTool();
    await expect(
      tool.execute("call-7", {}, undefined, vi.fn(), makeCtx()),
    ).rejects.toThrow(/requires query/);
  });
});
