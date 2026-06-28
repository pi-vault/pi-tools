import * as fsSync from "node:fs";
import * as os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDuckGoProvider } from "../../src/providers/duckduckgo.ts";
import { stubExec } from "../helpers.ts";

describe("DuckDuckGoProvider", () => {
  let execStub: ReturnType<typeof stubExec>;
  let provider: DuckDuckGoProvider;

  beforeEach(() => {
    execStub = stubExec();
    execStub.setOutput([
      {
        title: "Example Result",
        href: "https://example.com",
        body: "This is a snippet about example",
      },
      {
        title: "Another Result",
        href: "https://another.com",
        body: "More information here",
      },
      {
        title: "Third Result",
        href: "https://third.com",
        body: "Third snippet",
      },
    ]);
    provider = new DuckDuckGoProvider(execStub.fn);
  });

  afterEach(() => {
    execStub.restore();
  });

  it("has correct name and label", () => {
    expect(provider.name).toBe("duckduckgo");
    expect(provider.label).toBe("DuckDuckGo");
  });

  it("returns normalized search results", async () => {
    const results = await provider.search("test query", 5);
    expect(results.length).toBe(3);
    expect(results[0]).toEqual({
      title: "Example Result",
      url: "https://example.com",
      snippet: "This is a snippet about example",
    });
  });

  it("respects maxResults", async () => {
    const results = await provider.search("test", 2);
    expect(results.length).toBe(2);
    // Verify -m flag is passed to ddgs
    const args = execStub.lastArgs();
    expect(args).toContain("-m");
    const mIdx = args?.indexOf("-m") ?? -1;
    expect(args?.[mIdx + 1]).toBe("2");
  });

  it("throws on ddgs CLI failure", async () => {
    execStub.setError({ code: 1, message: "ddgs error" });
    await expect(provider.search("test", 5)).rejects.toThrow();
  });

  it("throws when ddgs not found", async () => {
    execStub.setUnavailable();
    await expect(provider.search("test", 5)).rejects.toThrow(/install/i);
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      provider.search("test", 5, controller.signal),
    ).rejects.toThrow();
  });

  it("cleans up temp file after success", async () => {
    const before = fsSync
      .readdirSync(os.tmpdir())
      .filter((f) => f.startsWith("ddgs-") && f.endsWith(".json"));
    await provider.search("test", 5);
    const after = fsSync
      .readdirSync(os.tmpdir())
      .filter((f) => f.startsWith("ddgs-") && f.endsWith(".json"));
    // No new ddgs temp files should remain
    expect(after.length).toBeLessThanOrEqual(before.length);
  });

  it("includes stderr in error on CLI failure", async () => {
    execStub.setError({ code: 1, message: "rate limited" });
    await expect(provider.search("test", 5)).rejects.toThrow(/rate limited/i);
  });

  it("returns empty array when ddgs has no results", async () => {
    execStub.setOutput([]);
    const results = await provider.search("obscure query", 5);
    expect(results).toEqual([]);
  });

  it("throws contextual error on malformed JSON", async () => {
    execStub.setOutput("not valid json" as unknown);
    await expect(provider.search("test", 5)).rejects.toThrow(
      /failed to parse ddgs output/i,
    );
  });

  it("throws contextual error when output is not an array", async () => {
    execStub.setOutput({ unexpected: "object" });
    await expect(provider.search("test", 5)).rejects.toThrow(
      /failed to parse ddgs output/i,
    );
  });
});
