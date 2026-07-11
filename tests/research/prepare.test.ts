import { describe, expect, it, vi, beforeEach } from "vitest";
import * as fs from "node:fs/promises";
import {
  prepareResearchInput,
  applyResearchMode,
  resolveOutputPath,
  expandSimpleGlob,
} from "../../src/research/prepare.ts";

vi.mock("node:fs/promises");

describe("resolveOutputPath", () => {
  it("resolves relative path against cwd", () => {
    expect(resolveOutputPath("/project", "findings.md")).toMatch(
      /\/project\/findings.md$/,
    );
  });

  it("returns absolute path unchanged", () => {
    expect(resolveOutputPath("/project", "/tmp/out.md")).toBe("/tmp/out.md");
  });

  it("strips leading @ from path", () => {
    expect(resolveOutputPath("/project", "@docs/out.md")).toMatch(
      /\/project\/docs\/out.md$/,
    );
  });
});

describe("applyResearchMode", () => {
  it("returns lite defaults for lite mode", () => {
    const result = applyResearchMode({ researchMode: "lite" });
    expect(result.type).toBe("deep-lite");
    expect(result.numResults).toBe(15);
    expect(result.textMaxCharacters).toBe(10000);
    expect(result.timeoutSeconds).toBe(300);
  });

  it("returns standard defaults for standard mode", () => {
    const result = applyResearchMode({ researchMode: "standard" });
    expect(result.type).toBe("deep-reasoning");
    expect(result.numResults).toBe(50);
    expect(result.outputSchema).toBeDefined();
  });

  it("defaults to standard when researchMode not specified", () => {
    const result = applyResearchMode({});
    expect(result.type).toBe("deep-reasoning");
    expect(result.numResults).toBe(50);
  });

  it("per-call params override mode defaults", () => {
    const result = applyResearchMode({
      researchMode: "standard",
      numResults: 30,
      textMaxCharacters: 8000,
      type: "deep-lite",
    });
    expect(result.type).toBe("deep-lite");
    expect(result.numResults).toBe(30);
    expect(result.textMaxCharacters).toBe(8000);
  });

  it("config modeDefaults override built-in defaults", () => {
    const configDefaults = {
      standard: { numResults: 60, textMaxCharacters: 20000 },
    };
    const result = applyResearchMode(
      { researchMode: "standard" },
      configDefaults,
    );
    expect(result.numResults).toBe(60);
    expect(result.textMaxCharacters).toBe(20000);
  });

  it("per-call params override config modeDefaults", () => {
    const configDefaults = { standard: { numResults: 60 } };
    const result = applyResearchMode(
      { researchMode: "standard", numResults: 25 },
      configDefaults,
    );
    expect(result.numResults).toBe(25);
  });

  it("throws on invalid research mode", () => {
    expect(() => applyResearchMode({ researchMode: "invalid" as any })).toThrow(
      /invalid/i,
    );
  });
});

describe("expandSimpleGlob", () => {
  it("returns single path when no wildcard", async () => {
    const result = await expandSimpleGlob("/project", "docs/file.md");
    expect(result).toEqual(["/project/docs/file.md"]);
  });

  it("expands wildcard in filename", async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: "context-01.md", isFile: () => true },
      { name: "context-02.md", isFile: () => true },
      { name: "other.txt", isFile: () => true },
    ] as any);
    const result = await expandSimpleGlob("/project", "docs/context-*.md");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatch(/context-01\.md$/);
    expect(result[1]).toMatch(/context-02\.md$/);
  });

  it("throws when glob matches exceed limit", async () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      name: `file-${i}.md`,
      isFile: () => true,
    }));
    vi.mocked(fs.readdir).mockResolvedValue(entries as any);
    await expect(
      expandSimpleGlob("/project", "docs/file-*.md"),
    ).rejects.toThrow(/limit/);
  });

  it("throws on multiple wildcards", async () => {
    await expect(expandSimpleGlob("/project", "docs/*/*.md")).rejects.toThrow(
      /one '\*' wildcard in the path/,
    );
  });
});

describe("prepareResearchInput", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses query directly when provided", async () => {
    const result = await prepareResearchInput("/project", {
      query: "What is X?",
    });
    expect(result.query).toBe("What is X?");
  });

  it("reads query from queryFile", async () => {
    vi.mocked(fs.readFile).mockResolvedValue("Question from file");
    const result = await prepareResearchInput("/project", {
      queryFile: "question.txt",
    });
    expect(result.query).toBe("Question from file");
  });

  it("throws when neither query nor queryFile provided", async () => {
    await expect(prepareResearchInput("/project", {})).rejects.toThrow(
      /requires query or queryFile/,
    );
  });

  it("appends context files to system prompt", async () => {
    vi.mocked(fs.readFile).mockImplementation(async (path) => {
      if (String(path).includes("question")) return "My question";
      return "Context content here";
    });
    const result = await prepareResearchInput("/project", {
      query: "test",
      contextFiles: ["context.md"],
    });
    expect(result.systemPrompt).toContain("Context content here");
    expect(result.systemPrompt).toContain("---");
  });

  it("uses default system prompt when no custom one provided", async () => {
    const result = await prepareResearchInput("/project", { query: "test" });
    expect(result.systemPrompt).toContain("evidence-backed");
  });

  it("uses custom system prompt when provided", async () => {
    const result = await prepareResearchInput("/project", {
      query: "test",
      systemPrompt: "Custom instructions",
    });
    expect(result.systemPrompt).toBe("Custom instructions");
  });

  it("throws when queryFile content is empty", async () => {
    vi.mocked(fs.readFile).mockResolvedValue("   ");
    await expect(
      prepareResearchInput("/project", { queryFile: "empty.txt" }),
    ).rejects.toThrow(/requires query or queryFile/);
  });

  it("expands contextGlob and appends to system prompt", async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: "ctx-1.md", isFile: () => true },
      { name: "ctx-2.md", isFile: () => true },
    ] as any);
    vi.mocked(fs.readFile).mockResolvedValue("Glob context content");
    const result = await prepareResearchInput("/project", {
      query: "test",
      contextGlob: "docs/ctx-*.md",
    });
    expect(result.systemPrompt).toContain("Glob context content");
    expect(result.systemPrompt).toContain("---");
  });

  it("deduplicates paths from contextFiles and contextGlob", async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: "shared.md", isFile: () => true },
      { name: "extra.md", isFile: () => true },
    ] as any);
    let readCount = 0;
    vi.mocked(fs.readFile).mockImplementation(async () => {
      readCount++;
      return "content";
    });
    await prepareResearchInput("/project", {
      query: "test",
      contextFiles: ["/project/docs/shared.md"],
      contextGlob: "docs/*.md",
    });
    // shared.md appears in both contextFiles and glob results,
    // but should only be read once (2 unique paths: shared.md + extra.md)
    expect(readCount).toBe(2);
  });
});
