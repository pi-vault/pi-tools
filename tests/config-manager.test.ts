import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PiToolsConfig } from "../src/config.ts";

import { ConfigManager, diffConfig } from "../src/config-manager.ts";
import { ProviderRegistry } from "../src/providers/registry.ts";
import type { ProviderMeta } from "../src/providers/types.ts";

vi.mock("../src/config.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config.ts")>();
  return {
    ...actual,
    loadMergedConfig: vi.fn(),
    resolveApiKey: vi.fn((key: string | undefined) => key),
  };
});

import { loadMergedConfig, resolveApiKey } from "../src/config.ts";

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
    ssrf: { allowRanges: [] },
    combine: { enabled: false, mode: "targeted", targetBackends: 3, k: 60 },
    deepResearch: { enabled: true },
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

// ---------------------------------------------------------------------------
// ConfigManager tests
// ---------------------------------------------------------------------------

const mem = () => new ProviderRegistry({ load: () => ({}), save: () => {} });

function makeMeta(name: string, opts: Partial<ProviderMeta> = {}): ProviderMeta {
  return {
    name,
    tier: 1,
    monthlyQuota: null,
    requiresKey: false,
    create: (_key, _config) => ({
      search: { name, label: name, search: vi.fn().mockResolvedValue([]) },
    }),
    ...opts,
  };
}

describe("ConfigManager", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("loads config on construction and registers providers", () => {
    vi.mocked(loadMergedConfig).mockReturnValue(
      makeConfig({
        providers: {
          brave: { enabled: true, monthlyQuota: 2000 },
          duckduckgo: { enabled: true },
          exa: { enabled: false },
        },
      }),
    );
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const registry = mem();
    const metas = [makeMeta("brave"), makeMeta("duckduckgo"), makeMeta("exa")];
    new ConfigManager("/test/cwd", registry, metas);

    expect(registry.getSearchProviderNames().sort()).toEqual(["brave", "duckduckgo"]);
  });

  it("refresh is a no-op within TTL", () => {
    const config = makeConfig();
    vi.mocked(loadMergedConfig).mockReturnValue(config);
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const registry = mem();
    const manager = new ConfigManager("/test/cwd", registry, [
      makeMeta("brave"),
      makeMeta("duckduckgo"),
    ]);

    expect(vi.mocked(loadMergedConfig)).toHaveBeenCalledTimes(1);

    manager.refresh();

    expect(vi.mocked(loadMergedConfig)).toHaveBeenCalledTimes(1);
  });

  it("refresh reloads config after TTL expires", () => {
    const config = makeConfig();
    vi.mocked(loadMergedConfig).mockReturnValue(config);
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const registry = mem();
    const manager = new ConfigManager("/test/cwd", registry, [
      makeMeta("brave"),
      makeMeta("duckduckgo"),
    ]);

    manager.expireTtlForTest();
    manager.refresh();

    expect(vi.mocked(loadMergedConfig)).toHaveBeenCalledTimes(2);
  });

  it("refresh(force=true) reloads regardless of TTL", () => {
    const config = makeConfig();
    vi.mocked(loadMergedConfig).mockReturnValue(config);
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const registry = mem();
    const manager = new ConfigManager("/test/cwd", registry, [
      makeMeta("brave"),
      makeMeta("duckduckgo"),
    ]);

    manager.refresh(true);

    expect(vi.mocked(loadMergedConfig)).toHaveBeenCalledTimes(2);
  });

  it("adds newly enabled provider on refresh", () => {
    const initialConfig = makeConfig({
      providers: {
        brave: { enabled: true },
        exa: { enabled: false },
      },
    });
    const updatedConfig = makeConfig({
      providers: {
        brave: { enabled: true },
        exa: { enabled: true },
      },
    });

    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(initialConfig)
      .mockReturnValueOnce(updatedConfig);
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const registry = mem();
    const manager = new ConfigManager("/test/cwd", registry, [makeMeta("brave"), makeMeta("exa")]);

    expect(registry.getSearchProviderNames()).toEqual(["brave"]);

    manager.expireTtlForTest();
    manager.refresh();

    expect(registry.getSearchProviderNames().sort()).toEqual(["brave", "exa"]);
  });

  it("removes newly disabled provider on refresh", () => {
    const initialConfig = makeConfig({
      providers: {
        brave: { enabled: true },
        duckduckgo: { enabled: true },
      },
    });
    const updatedConfig = makeConfig({
      providers: {
        brave: { enabled: false },
        duckduckgo: { enabled: true },
      },
    });

    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(initialConfig)
      .mockReturnValueOnce(updatedConfig);
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const registry = mem();
    const manager = new ConfigManager("/test/cwd", registry, [
      makeMeta("brave"),
      makeMeta("duckduckgo"),
    ]);

    expect(registry.getSearchProviderNames().sort()).toEqual(["brave", "duckduckgo"]);

    manager.expireTtlForTest();
    manager.refresh();

    expect(registry.getSearchProviderNames()).toEqual(["duckduckgo"]);
  });

  it("re-registers provider when key changes", () => {
    const initialConfig = makeConfig({
      providers: {
        brave: { enabled: true, apiKey: "OLD_KEY" },
      },
    });
    const updatedConfig = makeConfig({
      providers: {
        brave: { enabled: true, apiKey: "NEW_KEY" },
      },
    });

    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(initialConfig)
      .mockReturnValueOnce(updatedConfig);
    vi.mocked(resolveApiKey).mockImplementation((key) => {
      if (key === "OLD_KEY") return "old-resolved";
      if (key === "NEW_KEY") return "new-resolved";
      return undefined;
    });

    const createFn = vi.fn().mockReturnValue({
      search: { name: "brave", label: "Brave", search: vi.fn() },
    });
    const registry = mem();
    const manager = new ConfigManager("/test/cwd", registry, [
      makeMeta("brave", { create: createFn }),
    ]);

    expect(createFn).toHaveBeenCalledTimes(1);

    manager.expireTtlForTest();
    manager.refresh();

    expect(createFn).toHaveBeenCalledTimes(2);
    expect(createFn).toHaveBeenLastCalledWith("new-resolved", {
      ...updatedConfig.providers.brave,
      ssrfAllowRanges: updatedConfig.ssrf.allowRanges,
    });
  });

  it("preserves previous config when reload throws", () => {
    const validConfig = makeConfig({
      providers: {
        brave: { enabled: true },
      },
    });

    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(validConfig)
      .mockImplementationOnce(() => {
        throw new Error("JSON parse error");
      });
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const registry = mem();
    const manager = new ConfigManager("/test/cwd", registry, [makeMeta("brave")]);

    manager.expireTtlForTest();
    manager.refresh();

    expect(manager.current.providers.brave.enabled).toBe(true);
    expect(registry.getSearchProviderNames()).toEqual(["brave"]);
  });

  it("updates current config when selectionStrategy changes", () => {
    const initialConfig = makeConfig({ selectionStrategy: "auto" });
    const updatedConfig = makeConfig({ selectionStrategy: "best-performing" });

    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(initialConfig)
      .mockReturnValueOnce(updatedConfig);
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const registry = mem();
    const manager = new ConfigManager("/test/cwd", registry, [
      makeMeta("brave"),
      makeMeta("duckduckgo"),
    ]);

    expect(manager.current.selectionStrategy).toBe("auto");

    manager.expireTtlForTest();
    manager.refresh();

    expect(manager.current.selectionStrategy).toBe("best-performing");
  });

  it("skips provider requiring key when key resolves to undefined", () => {
    vi.mocked(loadMergedConfig).mockReturnValue(
      makeConfig({
        providers: {
          brave: { enabled: true, apiKey: "BRAVE_API_KEY" },
        },
      }),
    );
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const registry = mem();
    new ConfigManager("/test/cwd", registry, [makeMeta("brave", { requiresKey: true })]);

    expect(registry.getSearchProviderNames()).toEqual([]);
  });

  it("skips provider when meta.create throws during hot-add", () => {
    const initialConfig = makeConfig({
      providers: {
        brave: { enabled: true },
        exa: { enabled: false },
      },
    });
    const updatedConfig = makeConfig({
      providers: {
        brave: { enabled: true },
        exa: { enabled: true },
      },
    });

    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(initialConfig)
      .mockReturnValueOnce(updatedConfig);
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const throwingCreate = () => {
      throw new Error("provider init failed");
    };

    const registry = mem();
    const manager = new ConfigManager("/test/cwd", registry, [
      makeMeta("brave"),
      makeMeta("exa", { create: throwingCreate }),
    ]);

    expect(registry.getSearchProviderNames()).toEqual(["brave"]);

    manager.expireTtlForTest();
    manager.refresh();

    // exa's create throws — brave still registered, no crash
    expect(registry.getSearchProviderNames()).toEqual(["brave"]);
  });

  it("resolves openai-native config alias to openai-codex provider", () => {
    vi.mocked(loadMergedConfig).mockReturnValue(
      makeConfig({
        providers: {
          "openai-native": { enabled: true, apiKey: "sk-test" },
        },
      }),
    );
    vi.mocked(resolveApiKey).mockReturnValue("sk-test");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = mem();
    const metas = [makeMeta("openai-codex", { requiresKey: true })];
    new ConfigManager("/test/cwd", registry, metas);

    // Provider registered under the resolved name
    expect(registry.getSearchProviderNames()).toContain("openai-codex");
    // Deprecation warning emitted
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("openai-native"),
    );
    warnSpy.mockRestore();
  });

  it("does not warn for non-aliased provider names", () => {
    vi.mocked(loadMergedConfig).mockReturnValue(
      makeConfig({
        providers: {
          "openai-codex": { enabled: true },
        },
      }),
    );
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = mem();
    const metas = [makeMeta("openai-codex")];
    new ConfigManager("/test/cwd", registry, metas);

    expect(registry.getSearchProviderNames()).toContain("openai-codex");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
