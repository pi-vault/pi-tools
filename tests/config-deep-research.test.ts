import * as fs from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, loadMergedConfig } from "../src/config.ts";

vi.mock("node:fs");

describe("DeepResearchConfig — loadConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns default deepResearch config when not in file", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));
    const config = loadConfig();
    expect(config.deepResearch).toEqual({ enabled: true });
  });

  it("parses deepResearch.enabled = false", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ deepResearch: { enabled: false } }),
    );
    const config = loadConfig();
    expect(config.deepResearch.enabled).toBe(false);
  });

  it("parses modeDefaults overrides", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        deepResearch: {
          enabled: true,
          modeDefaults: {
            standard: { numResults: 60, textMaxCharacters: 20000 },
          },
        },
      }),
    );
    const config = loadConfig();
    expect(config.deepResearch.modeDefaults?.standard?.numResults).toBe(60);
    expect(config.deepResearch.modeDefaults?.standard?.textMaxCharacters).toBe(
      20000,
    );
  });

  it("parses outputSchema override", () => {
    const schema = {
      type: "object",
      properties: { summary: { type: "string" } },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ deepResearch: { outputSchema: schema } }),
    );
    const config = loadConfig();
    expect(config.deepResearch.outputSchema).toEqual(schema);
  });

  it("preserves outputSchema: null to disable global schema", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ deepResearch: { outputSchema: null } }),
    );
    const config = loadConfig();
    expect(config.deepResearch.outputSchema).toBe(null);
  });

  it("parses guidance override", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        deepResearch: { guidance: { promptSnippet: "Custom snippet" } },
      }),
    );
    const config = loadConfig();
    expect(config.deepResearch.guidance?.promptSnippet).toBe("Custom snippet");
  });

  it("ignores non-boolean enabled values and falls back to default", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ deepResearch: { enabled: "yes" } }),
    );
    const config = loadConfig();
    expect(config.deepResearch.enabled).toBe(true);
  });

  it("returns default when deepResearch is not an object", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ deepResearch: "invalid" }),
    );
    const config = loadConfig();
    expect(config.deepResearch).toEqual({ enabled: true });
  });
});

describe("DeepResearchConfig — loadMergedConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves deepResearch defaults when no config files exist", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const config = loadMergedConfig("/projects/my-app");
    expect(config.deepResearch).toBeDefined();
    expect(config.deepResearch.enabled).toBe(true);
  });

  it("deep-merges deepResearch overrides from global config", () => {
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const filePath = typeof p === "string" ? p : p.toString();
      if (filePath.includes(path.join(".pi", "agent"))) {
        return JSON.stringify({
          deepResearch: {
            enabled: true,
            modeDefaults: { lite: { numResults: 25 } },
          },
        });
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const config = loadMergedConfig("/projects/my-app");
    expect(config.deepResearch.enabled).toBe(true);
    expect(config.deepResearch.modeDefaults?.lite?.numResults).toBe(25);
  });

  it("project config overrides global deepResearch settings", () => {
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const filePath = typeof p === "string" ? p : p.toString();
      if (filePath.includes(path.join(".pi", "agent"))) {
        return JSON.stringify({
          deepResearch: { enabled: true },
        });
      }
      if (filePath.includes(path.join(".pi", "tools.json"))) {
        return JSON.stringify({
          deepResearch: { enabled: false },
        });
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return (p as string).includes(path.join(".pi", "tools.json"));
    });

    const config = loadMergedConfig("/projects/my-app");
    expect(config.deepResearch.enabled).toBe(false);
  });
});
