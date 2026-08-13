import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigManager, diffConfig } from "../src/config-manager.ts";
import type { PiToolsConfig, ProviderBudget } from "../src/config.ts";
import { ProviderRegistry } from "../src/providers/registry.ts";
import type { ProviderMeta } from "../src/providers/types.ts";
import { UNSUPPORTED_SEARCH_FILTERS } from "../src/providers/types.ts";

vi.mock("../src/config.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config.ts")>();
  return {
    ...actual,
    loadMergedConfig: vi.fn(),
    resolveApiKey: vi.fn((key: string | undefined) => key),
  };
});

import { loadMergedConfig, resolveApiKey } from "../src/config.ts";
import { providerMeta as tinyfishMeta } from "../src/providers/tinyfish.ts";
import { stubFetch } from "./helpers.ts";

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
      search: {
        name,
        label: name,
        filterSupport: UNSUPPORTED_SEARCH_FILTERS,
        search: vi.fn().mockResolvedValue([]),
      },
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
      search: {
        name: "all",
        label: "all",
        filterSupport: UNSUPPORTED_SEARCH_FILTERS,
        search: vi.fn().mockResolvedValue([]),
      },
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

  it("notifies after provider changes update the registry", () => {
    const next = makeConfig({ brave: entry(managed) });
    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(makeConfig({ brave: entry(hard) }))
      .mockReturnValueOnce(next);
    const registry = memory();
    let manager: ConfigManager;
    const listener = vi.fn((config: PiToolsConfig) => {
      expect(config).toBe(next);
      expect(manager.current).toBe(next);
      expect(registry.getBudgetStatus("brave")).toEqual({ mode: "managed" });
    });

    manager = new ConfigManager("/cwd", registry, [meta("brave")], undefined, listener);
    manager.expireTtlForTest();
    manager.refresh();

    expect(listener).toHaveBeenCalledOnce();
  });

  it("notifies for non-provider config changes", () => {
    const next = {
      ...makeConfig({ brave: entry() }),
      defaultProvider: "brave",
      selectionStrategy: "best-performing" as const,
      guidance: { search: { promptSnippet: "prefer primary sources" } },
      combine: { enabled: true, mode: "all" as const, targetBackends: 4, k: 20 },
      deepResearch: { enabled: false },
    };
    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(makeConfig({ brave: entry() }))
      .mockReturnValueOnce(next);
    const listener = vi.fn();
    const manager = new ConfigManager("/cwd", memory(), [meta("brave")], undefined, listener);

    manager.expireTtlForTest();
    manager.refresh();

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(next);
  });

  it("notifies and re-registers when an environment-backed key changes", () => {
    const config = makeConfig({ brave: entry(managed, { apiKey: "BRAVE_API_KEY" }) });
    vi.mocked(loadMergedConfig).mockReturnValueOnce(config).mockReturnValueOnce({ ...config });
    vi.mocked(resolveApiKey).mockReturnValueOnce("old-key").mockReturnValue("new-key");
    const registry = memory();
    const register = vi.spyOn(registry, "registerProvider");
    const listener = vi.fn();
    const manager = new ConfigManager("/cwd", registry, [meta("brave")], undefined, listener);

    manager.expireTtlForTest();
    manager.refresh();

    expect(register).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("does not notify or re-register when api key representations resolve equally", () => {
    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(makeConfig({ brave: entry(managed, { apiKey: "OLD" }) }))
      .mockReturnValueOnce(makeConfig({ brave: entry(managed, { apiKey: "NEW" }) }));
    vi.mocked(resolveApiKey).mockReturnValue("same-key");
    const registry = memory();
    const register = vi.spyOn(registry, "registerProvider");
    const listener = vi.fn();
    const manager = new ConfigManager("/cwd", registry, [meta("brave")], undefined, listener);

    manager.expireTtlForTest();
    manager.refresh();

    expect(register).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies when a disabled provider's configuration changes", () => {
    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(makeConfig({ brave: { ...entry(managed), enabled: false, depth: "standard" } }))
      .mockReturnValueOnce(makeConfig({ brave: { ...entry(managed), enabled: false, depth: "deep" } }));
    const listener = vi.fn();
    const manager = new ConfigManager("/cwd", memory(), [meta("brave")], undefined, listener);

    manager.expireTtlForTest();
    manager.refresh();

    expect(listener).toHaveBeenCalledOnce();
  });

  it("ignores reordered equal provider entries", () => {
    const reordered: ProviderBudget = { unit: "usd", period: "month", limit: 5, mode: "hard" };
    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(makeConfig({ brave: entry(hard) }))
      .mockReturnValueOnce(makeConfig({ brave: entry(reordered) }));
    const registry = memory();
    const register = vi.spyOn(registry, "registerProvider");
    const listener = vi.fn();
    const manager = new ConfigManager("/cwd", registry, [meta("brave")], undefined, listener);

    manager.expireTtlForTest();
    manager.refresh();

    expect(register).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not notify for identical reloads or TTL hits", () => {
    const config = makeConfig({ brave: entry() });
    vi.mocked(loadMergedConfig).mockReturnValue(config);
    const listener = vi.fn();
    const manager = new ConfigManager("/cwd", memory(), [meta("brave")], undefined, listener);

    manager.refresh();
    manager.refresh(true);

    expect(loadMergedConfig).toHaveBeenCalledTimes(2);
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps the previous config when reload parsing fails", () => {
    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(makeConfig({ brave: entry(hard) }))
      .mockImplementationOnce(() => {
        throw new Error("invalid config");
      });
    const registry = memory();
    const unregister = vi.spyOn(registry, "unregisterAll");
    const listener = vi.fn();
    const manager = new ConfigManager("/cwd", registry, [meta("brave")], undefined, listener);

    manager.expireTtlForTest();
    manager.refresh();

    expect(manager.current.providers.brave.budget).toEqual(hard);
    expect(registry.getBudgetStatus("brave")).toEqual(expect.objectContaining(hard));
    expect(unregister).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(loadMergedConfig).toHaveBeenLastCalledWith("/cwd", true);
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

  it("registers tinyfish with the real metadata, tier-2 policy, and both capabilities", () => {
    vi.mocked(loadMergedConfig).mockReturnValue(
      makeConfig({
        tinyfish: entry({ mode: "unlimited" }, { apiKey: "TINYFISH_API_KEY" }),
      }),
    );
    vi.mocked(resolveApiKey).mockImplementation((key) =>
      key === "TINYFISH_API_KEY" ? "resolved-tiny-key" : key,
    );

    const registry = memory();
    const register = vi.spyOn(registry, "registerProvider");

    new ConfigManager("/cwd", registry, [tinyfishMeta]);

    expect(register).toHaveBeenCalledOnce();
    const [instances, options] = register.mock.calls[0];
    expect(options.name).toBe("tinyfish");
    expect(options.tier).toBe(2);
    expect(options.budget).toEqual({ mode: "unlimited" });
    expect(instances.search).toBeDefined();
    expect(instances.fetch).toBeDefined();
    expect(registry.getSearchProviderNames()).toEqual(["tinyfish"]);
    expect(registry.getBudgetStatus("tinyfish")).toEqual({ mode: "unlimited" });
  });

  it("injects the resolved searxng key into the factory", async () => {
    vi.mocked(loadMergedConfig).mockReturnValue(
      makeConfig({
        searxng: {
          enabled: true,
          budget: { mode: "unlimited" },
          instanceUrl: "http://my-searx.local:9090",
          apiKey: "SEARXNG_API_KEY",
        },
      }),
    );
    vi.mocked(resolveApiKey).mockImplementation((key) =>
      key === "SEARXNG_API_KEY" ? "resolved-searxng-key" : key,
    );

    const searxngModule = await import("../src/providers/searxng.ts");
    const searxngMeta = searxngModule.providerMeta;
    const fetchStub = stubFetch();
    try {
      fetchStub.addResponse("my-searx.local:9090", { body: { results: [] } });

      const registry = memory();
      new ConfigManager("/cwd", registry, [searxngMeta]);
      const candidates = registry.selectSearchCandidates("searxng");
      await candidates[0].search("test", 5);

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const headers = fetchCall[1]?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer resolved-searxng-key");
    } finally {
      fetchStub.restore();
    }
  });
});
