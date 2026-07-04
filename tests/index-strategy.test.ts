import * as fs from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import createExtension from "../src/index.ts";
import { ProviderRegistry } from "../src/providers/registry.ts";
import { createMockPi, makeCtx } from "./helpers.ts";

vi.mock("node:fs");

describe("selectionStrategy routing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Default: no files found — loadMergedConfig falls back to built-in defaults
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it("uses selectSearchByPerformance when selectionStrategy is best-performing", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ selectionStrategy: "best-performing" }),
    );

    const byPerformanceSpy = vi
      .spyOn(ProviderRegistry.prototype, "selectSearchByPerformance")
      .mockReturnValue(undefined);
    const candidatesSpy = vi.spyOn(
      ProviderRegistry.prototype,
      "selectSearchCandidates",
    );

    const pi = createMockPi();
    createExtension(pi as unknown as ExtensionAPI);

    const webSearch = pi.tools.find((t) => t.name === "web_search");
    expect(webSearch).toBeDefined();
    if (!webSearch) throw new Error("web_search tool not registered");
    const ctx = makeCtx();
    await webSearch.execute("id", { query: "test" }, undefined, undefined, ctx);

    expect(byPerformanceSpy).toHaveBeenCalled();
    expect(candidatesSpy).not.toHaveBeenCalled();
  });

  it("uses selectSearchCandidates when selectionStrategy is auto", async () => {
    // Default config (no file) uses selectionStrategy: "auto"
    const byPerformanceSpy = vi.spyOn(
      ProviderRegistry.prototype,
      "selectSearchByPerformance",
    );
    const candidatesSpy = vi
      .spyOn(ProviderRegistry.prototype, "selectSearchCandidates")
      .mockReturnValue([]);

    const pi = createMockPi();
    createExtension(pi as unknown as ExtensionAPI);

    const webSearch = pi.tools.find((t) => t.name === "web_search");
    expect(webSearch).toBeDefined();
    if (!webSearch) throw new Error("web_search tool not registered");
    const ctx = makeCtx();
    await webSearch.execute("id", { query: "test" }, undefined, undefined, ctx);

    expect(byPerformanceSpy).not.toHaveBeenCalled();
    expect(candidatesSpy).toHaveBeenCalled();
  });
});
