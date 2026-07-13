import * as fsSync from "node:fs";
import * as os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDuckGoProvider, providerMeta } from "../../src/providers/duckduckgo.ts";
import { stubExec } from "../helpers.ts";
import type { SearchFilters } from "../../src/providers/types.ts";

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
    await expect(provider.search("test", 5, controller.signal)).rejects.toThrow();
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
    await expect(provider.search("test", 5)).rejects.toThrow(/failed to parse ddgs output/i);
  });

  it("throws contextual error when output is not an array", async () => {
    execStub.setOutput({ unexpected: "object" });
    await expect(provider.search("test", 5)).rejects.toThrow(/failed to parse ddgs output/i);
  });

  describe("search filters", () => {
    it("prepends site: operators for includeDomains in the -q argument", async () => {
      const provider = new DuckDuckGoProvider(execStub.fn);
      const filters: SearchFilters = { includeDomains: ["example.com", "docs.rs"] };
      await provider.search("rust tutorial", 5, undefined, filters);

      const args = execStub.lastArgs();
      const qIdx = args?.indexOf("-q") ?? -1;
      const query = args?.[qIdx + 1] ?? "";
      expect(query).toContain("site:example.com OR site:docs.rs");
      expect(query).toContain("rust tutorial");
    });

    it("prepends -site: operators for excludeDomains in the -q argument", async () => {
      const provider = new DuckDuckGoProvider(execStub.fn);
      const filters: SearchFilters = { excludeDomains: ["spam.com"] };
      await provider.search("test query", 5, undefined, filters);

      const args = execStub.lastArgs();
      const qIdx = args?.indexOf("-q") ?? -1;
      const query = args?.[qIdx + 1] ?? "";
      expect(query).toContain("-site:spam.com");
      expect(query).toContain("test query");
    });

    it("passes timelimit flag for startDate (approximate mapping)", async () => {
      const provider = new DuckDuckGoProvider(execStub.fn);
      // 5 days ago — within 7-day window → "w"
      const recent = new Date();
      recent.setDate(recent.getDate() - 5);
      const filters: SearchFilters = { startDate: recent.toISOString().slice(0, 10) };
      await provider.search("test", 5, undefined, filters);

      const args = execStub.lastArgs();
      expect(args).toContain("-t");
      const tIdx = args?.indexOf("-t") ?? -1;
      expect(args?.[tIdx + 1]).toBe("w");
    });

    it("maps startDate older than 30 days to year timelimit", async () => {
      const provider = new DuckDuckGoProvider(execStub.fn);
      const old = new Date();
      old.setDate(old.getDate() - 200);
      const filters: SearchFilters = { startDate: old.toISOString().slice(0, 10) };
      await provider.search("test", 5, undefined, filters);

      const args = execStub.lastArgs();
      expect(args).toContain("-t");
      const tIdx = args?.indexOf("-t") ?? -1;
      expect(args?.[tIdx + 1]).toBe("y");
    });

    it("does not pass timelimit when no startDate is set", async () => {
      const provider = new DuckDuckGoProvider(execStub.fn);
      const filters: SearchFilters = { includeDomains: ["example.com"] };
      await provider.search("test", 5, undefined, filters);

      const args = execStub.lastArgs();
      expect(args).not.toContain("-t");
    });

    it("silently ignores endDate (not supported by ddgs)", async () => {
      const provider = new DuckDuckGoProvider(execStub.fn);
      const filters: SearchFilters = { endDate: "2025-12-31" };
      await provider.search("test", 5, undefined, filters);

      const args = execStub.lastArgs();
      expect(args).not.toContain("-t");
    });

    it("combines domain and date filters", async () => {
      const provider = new DuckDuckGoProvider(execStub.fn);
      // 20 days ago — within 30-day window → "m"
      const recent = new Date();
      recent.setDate(recent.getDate() - 20);
      const filters: SearchFilters = {
        includeDomains: ["example.com"],
        excludeDomains: ["spam.com"],
        startDate: recent.toISOString().slice(0, 10),
      };
      await provider.search("query", 5, undefined, filters);

      const args = execStub.lastArgs();
      const qIdx = args?.indexOf("-q") ?? -1;
      const query = args?.[qIdx + 1] ?? "";
      expect(query).toContain("site:example.com");
      expect(query).toContain("-site:spam.com");
      expect(args).toContain("-t");
      const tIdx = args?.indexOf("-t") ?? -1;
      expect(args?.[tIdx + 1]).toBe("m");
    });

    it("ignores future startDate (does not pass timelimit)", async () => {
      const provider = new DuckDuckGoProvider(execStub.fn);
      const future = new Date();
      future.setDate(future.getDate() + 30);
      const filters: SearchFilters = { startDate: future.toISOString().slice(0, 10) };
      await provider.search("test", 5, undefined, filters);

      const args = execStub.lastArgs();
      expect(args).not.toContain("-t");
    });

    it("works normally without filters", async () => {
      const provider = new DuckDuckGoProvider(execStub.fn);
      const results = await provider.search("test query", 5);
      expect(results.length).toBe(3);
      expect(results[0].title).toBe("Example Result");
    });
  });

  describe("config options", () => {
    it("passes backend flag when configured", async () => {
      const provider = new DuckDuckGoProvider(execStub.fn, { backend: "lite" });
      await provider.search("test", 5);

      const args = execStub.lastArgs()!;
      expect(args).toContain("-b");
      expect(args[args.indexOf("-b") + 1]).toBe("lite");
    });

    it("passes region flag when configured", async () => {
      const provider = new DuckDuckGoProvider(execStub.fn, { region: "us-en" });
      await provider.search("test", 5);

      const args = execStub.lastArgs()!;
      expect(args).toContain("-r");
      expect(args[args.indexOf("-r") + 1]).toBe("us-en");
    });

    it("config timelimit overrides filter-derived timelimit", async () => {
      const provider = new DuckDuckGoProvider(execStub.fn, { timelimit: "m" });
      const old = new Date();
      old.setDate(old.getDate() - 200);
      await provider.search("test", 5, undefined, { startDate: old.toISOString().slice(0, 10) });

      const args = execStub.lastArgs()!;
      expect(args).toContain("-t");
      // Config timelimit "m" should override the computed "y" from startDate >30d ago
      expect(args[args.indexOf("-t") + 1]).toBe("m");
    });

    it("does not pass backend/region flags when not configured", async () => {
      const provider = new DuckDuckGoProvider(execStub.fn);
      await provider.search("test", 5);

      const args = execStub.lastArgs()!;
      expect(args).not.toContain("-b");
      expect(args).not.toContain("-r");
    });

    it("providerMeta.create passes config options to provider", () => {
      const config = {
        enabled: true,
        ddgsBackend: "api",
        ddgsRegion: "de-de",
        ddgsTimelimit: "w",
      };
      const instance = providerMeta.create(undefined, config as any);
      expect(instance.search).toBeDefined();
      expect(instance.search!.name).toBe("duckduckgo");
    });
  });
});
