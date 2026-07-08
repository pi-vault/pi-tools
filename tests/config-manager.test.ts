import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PiToolsConfig } from "../src/config.ts";

import { diffConfig } from "../src/config-manager.ts";

function makeConfig(overrides: Partial<PiToolsConfig> = {}): PiToolsConfig {
  return {
    defaultProvider: "auto",
    selectionStrategy: "auto",
    providers: {
      brave: { enabled: true, monthlyQuota: 2000, apiKey: "BRAVE_API_KEY" },
      duckduckgo: { enabled: true },
      exa: { enabled: false, apiKey: "EXA_API_KEY" },
    },
    github: { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
    ...overrides,
  };
}

describe("diffConfig", () => {
  it("detects no changes when configs are identical", () => {
    const config = makeConfig();
    const result = diffConfig(config, config, (key) => key);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.keyChanged).toEqual([]);
    expect(result.configChanged).toBe(false);
  });

  it("detects added provider (disabled → enabled)", () => {
    const prev = makeConfig();
    const next = makeConfig({
      providers: {
        ...prev.providers,
        exa: { enabled: true, apiKey: "EXA_API_KEY" },
      },
    });
    const result = diffConfig(prev, next, (key) => key);
    expect(result.added).toEqual(["exa"]);
    expect(result.removed).toEqual([]);
  });

  it("detects removed provider (enabled → disabled)", () => {
    const prev = makeConfig();
    const next = makeConfig({
      providers: {
        ...prev.providers,
        brave: { enabled: false, apiKey: "BRAVE_API_KEY" },
      },
    });
    const result = diffConfig(prev, next, (key) => key);
    expect(result.removed).toEqual(["brave"]);
    expect(result.added).toEqual([]);
  });

  it("detects key changed for enabled provider", () => {
    const prev = makeConfig();
    const next = makeConfig({
      providers: {
        ...prev.providers,
        brave: { enabled: true, monthlyQuota: 2000, apiKey: "NEW_KEY" },
      },
    });
    const resolveKey = (key: string | undefined) => {
      if (key === "BRAVE_API_KEY") return "old-resolved";
      if (key === "NEW_KEY") return "new-resolved";
      return key;
    };
    const result = diffConfig(prev, next, resolveKey);
    expect(result.keyChanged).toEqual(["brave"]);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it("does not report key change when resolved values are the same", () => {
    const prev = makeConfig();
    const next = makeConfig({
      providers: {
        ...prev.providers,
        brave: { enabled: true, monthlyQuota: 2000, apiKey: "DIFFERENT_VAR" },
      },
    });
    const resolveKey = () => "same-value";
    const result = diffConfig(prev, next, resolveKey);
    expect(result.keyChanged).toEqual([]);
  });

  it("detects configChanged when selectionStrategy differs", () => {
    const prev = makeConfig();
    const next = makeConfig({ selectionStrategy: "best-performing" });
    const result = diffConfig(prev, next, (key) => key);
    expect(result.configChanged).toBe(true);
  });

  it("detects configChanged when defaultProvider differs", () => {
    const prev = makeConfig();
    const next = makeConfig({ defaultProvider: "brave" });
    const result = diffConfig(prev, next, (key) => key);
    expect(result.configChanged).toBe(true);
  });

  it("detects configChanged when guidance differs", () => {
    const prev = makeConfig();
    const next = makeConfig({
      guidance: { web_search: { promptSnippet: "Be concise" } },
    });
    const result = diffConfig(prev, next, (key) => key);
    expect(result.configChanged).toBe(true);
  });

  it("does not flag disabled providers as key-changed", () => {
    const prev = makeConfig();
    const next = makeConfig({
      providers: {
        ...prev.providers,
        exa: { enabled: false, apiKey: "CHANGED_KEY" },
      },
    });
    const resolveKey = (key: string | undefined) => key;
    const result = diffConfig(prev, next, resolveKey);
    expect(result.keyChanged).toEqual([]);
  });

  it("handles provider appearing in next but not in prev", () => {
    const prev = makeConfig();
    const next = makeConfig({
      providers: {
        ...prev.providers,
        tavily: { enabled: true, apiKey: "TAVILY_API_KEY" },
      },
    });
    const result = diffConfig(prev, next, (key) => key);
    expect(result.added).toEqual(["tavily"]);
  });

  it("handles provider disappearing from next config", () => {
    const prev = makeConfig();
    const { brave, ...rest } = prev.providers;
    const next = makeConfig({ providers: rest });
    const result = diffConfig(prev, next, (key) => key);
    expect(result.removed).toEqual(["brave"]);
  });
});
