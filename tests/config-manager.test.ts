import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigManager, diffConfig } from "../src/config-manager.ts";
import type { PiToolsConfig, ProviderBudget } from "../src/config.ts";
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

const managed: ProviderBudget = { mode: "managed" };
const hard: ProviderBudget = { mode: "hard", limit: 5, period: "month", unit: "usd" };

function makeConfig(providers: PiToolsConfig["providers"] = {}): PiToolsConfig {
  return {
    defaultProvider: "auto",
    selectionStrategy: "auto",
    providers,
    github: { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
    ssrf: { allowRanges: [] },
    combine: { enabled: false, mode: "targeted", targetBackends: 3, k: 60 },
    deepResearch: { enabled: true },
  };
}

function entry(budget: ProviderBudget = managed, extra = {}) {
  return { enabled: true, budget, ...extra };
}

function meta(name: string, overrides: Partial<ProviderMeta> = {}): ProviderMeta {
  return {
    name,
    tier: 1,
    requiresKey: false,
    create: () => ({
      search: { name, label: name, search: vi.fn().mockResolvedValue([]) },
    }),
    ...overrides,
  };
}

function memory(): ProviderRegistry {
  return new ProviderRegistry({
    load: () => ({ version: 2, counters: {} }),
    save: () => {},
  });
}

describe("diffConfig", () => {
  it("returns no changes for identical configs", () => {
    const config = makeConfig({ brave: entry(hard) });
    expect(diffConfig(config, config, (key) => key)).toEqual({
      added: [],
      removed: [],
      changed: [],
    });
  });

  it("detects enable and disable changes", () => {
    const prev = makeConfig({
      brave: entry(hard),
      exa: { ...entry(hard), enabled: false },
    });
    const next = makeConfig({
      brave: { ...entry(hard), enabled: false },
      exa: entry(hard),
    });
    expect(diffConfig(prev, next, (key) => key)).toEqual({
      added: ["exa"],
      removed: ["brave"],
      changed: [],
    });
  });

  it("detects structural provider-entry changes", () => {
    const prev = makeConfig({ brave: entry(hard, { depth: "standard" }) });
    const next = makeConfig({ brave: entry(managed, { depth: "deep" }) });
    expect(diffConfig(prev, next, (key) => key).changed).toEqual(["brave"]);
  });

  it("detects resolved key changes but ignores equivalent resolutions", () => {
    const prev = makeConfig({ brave: entry(hard, { apiKey: "OLD" }) });
    const next = makeConfig({ brave: entry(hard, { apiKey: "NEW" }) });
    expect(diffConfig(prev, next, (key) => key).changed).toEqual(["brave"]);
    expect(diffConfig(prev, next, () => "same").changed).toEqual([]);
  });
});

describe("ConfigManager", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveApiKey).mockImplementation((key) => key);
  });

  it("registers every capability once with its policy and config", () => {
    const providers = { all: entry(hard) };
    vi.mocked(loadMergedConfig).mockReturnValue(makeConfig(providers));
    const instances = {
      search: { name: "all", label: "all", search: vi.fn().mockResolvedValue([]) },
      fetch: { name: "all", fetch: vi.fn().mockResolvedValue({ text: "ok" }) },
      codeSearch: { name: "all", codeSearch: vi.fn().mockResolvedValue([]) },
      docs: {
        name: "all",
        label: "all",
        searchLibrary: vi.fn().mockResolvedValue([]),
        getContext: vi.fn().mockResolvedValue("ok"),
      },
    };
    const registry = memory();
    const register = vi.spyOn(registry, "registerProvider");
    const usageCost = vi.fn(() => 0.5);

    new ConfigManager("/cwd", registry, [meta("all", { create: () => instances, usageCost })]);

    expect(register).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledWith(instances, {
      name: "all",
      tier: 1,
      budget: hard,
      config: expect.objectContaining({ ...providers.all, ssrfAllowRanges: [] }),
      usageCost,
    });
  });

  it("passes the active model registry to the provider factory", () => {
    vi.mocked(loadMergedConfig).mockReturnValue(makeConfig({ brave: entry() }));
    const create = vi.fn().mockReturnValue({});
    const modelRegistry = {} as ModelRegistry;
    new ConfigManager("/cwd", memory(), [meta("brave", { create })], modelRegistry);
    expect(create).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ ssrfAllowRanges: [] }),
      modelRegistry,
    );
  });

  it("re-registers a provider after a structural config change", () => {
    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(makeConfig({ brave: entry(hard) }))
      .mockReturnValueOnce(makeConfig({ brave: entry(managed) }));
    const registry = memory();
    const register = vi.spyOn(registry, "registerProvider");
    const manager = new ConfigManager("/cwd", registry, [meta("brave")]);

    manager.expireTtlForTest();
    manager.refresh();

    expect(register).toHaveBeenCalledTimes(2);
    expect(registry.getBudgetStatus("brave")).toEqual({ mode: "managed" });
  });

  it("keeps the previous config when reload parsing fails", () => {
    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(makeConfig({ brave: entry(hard) }))
      .mockImplementationOnce(() => {
        throw new Error("invalid config");
      });
    const manager = new ConfigManager("/cwd", memory(), [meta("brave")]);

    manager.expireTtlForTest();
    manager.refresh();

    expect(manager.current.providers.brave.budget).toEqual(hard);
  });

  it("skips disabled, unkeyed, and failing providers without affecting siblings", () => {
    vi.mocked(loadMergedConfig).mockReturnValue(
      makeConfig({
        enabled: entry(),
        disabled: { ...entry(), enabled: false },
        unkeyed: entry(managed, { apiKey: "MISSING" }),
        broken: entry(),
      }),
    );
    vi.mocked(resolveApiKey).mockImplementation((key) => (key === "MISSING" ? undefined : key));
    const registry = memory();
    new ConfigManager("/cwd", registry, [
      meta("enabled"),
      meta("disabled"),
      meta("unkeyed", { requiresKey: true }),
      meta("broken", {
        create: () => {
          throw new Error("broken");
        },
      }),
    ]);
    expect(registry.getSearchProviderNames()).toEqual(["enabled"]);
  });
});
