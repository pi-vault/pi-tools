import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadConfig,
  resolveApiKey,
  clearCredentialCache,
  resolveProviderKey,
  FALLBACK_ENV_MAP,
  findProjectConfigPath,
  getConfigPath,
  loadMergedConfig,
} from "../src/config.ts";
import * as path from "node:path";

vi.mock("node:fs");

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn(actual.execSync),
  };
});

import { execSync } from "node:child_process";

describe("loadConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns defaults when config file is missing", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.defaultProvider).toBe("auto");
    expect(config.providers.duckduckgo.enabled).toBe(true);
    expect(config.providers.jina.enabled).toBe(true);
    expect(config.providers["openai-codex"]).toEqual({
      enabled: true,
      budget: { mode: "managed" },
    });
  });

  it("provides budgets for every built-in provider", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(
      Object.fromEntries(
        Object.entries(loadConfig().providers).map(([name, entry]) => [name, entry.budget]),
      ),
    ).toEqual({
      brave: { mode: "hard", limit: 5, period: "month", unit: "usd", pool: "brave" },
      "brave-llm": { mode: "hard", limit: 5, period: "month", unit: "usd", pool: "brave" },
      exa: { mode: "hard", limit: 10, period: "month", unit: "usd", pool: "exa" },
      tavily: { mode: "hard", limit: 1000, period: "month", unit: "credit" },
      firecrawl: { mode: "hard", limit: 1000, period: "month", unit: "credit" },
      serper: { mode: "hard", limit: 2500, period: "lifetime", unit: "request" },
      websearchapi: { mode: "hard", limit: 2000, period: "month", unit: "credit" },
      context7: { mode: "hard", limit: 1000, period: "month", unit: "request" },
      fastcrw: { mode: "hard", limit: 500, period: "lifetime", unit: "credit" },
      langsearch: { mode: "hard", limit: 1000, period: "day", unit: "request" },
      linkup: { mode: "hard", limit: 20, period: "month", unit: "usd" },
      youcom: { mode: "hard", limit: 100, period: "lifetime", unit: "usd" },
      duckduckgo: { mode: "unlimited" },
      ollama: { mode: "unlimited" },
      searxng: { mode: "unlimited" },
      jina: { mode: "managed" },
      marginalia: { mode: "managed" },
      "openai-codex": { mode: "managed" },
      "openai-web-search": { mode: "managed" },
      parallel: { mode: "managed" },
      perplexity: { mode: "managed" },
      sofya: { mode: "managed" },
    });
  });

  it("parses valid config file", () => {
    const configData = {
      defaultProvider: "brave",
      providers: {
        brave: { enabled: true, monthlyQuota: 2000, apiKey: "BRAVE_API_KEY" },
        exa: { enabled: false },
        tavily: { enabled: false },
        jina: { enabled: true },
        duckduckgo: { enabled: true },
        serper: { enabled: false },
        perplexity: { enabled: false },
        firecrawl: { enabled: false },
      },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(configData));
    const config = loadConfig();
    expect(config.defaultProvider).toBe("brave");
    expect(config.providers.brave.enabled).toBe(true);
    expect(config.providers.brave).not.toHaveProperty("monthlyQuota");
    expect(config.providers.brave.budget).toEqual({
      mode: "hard",
      limit: 5,
      period: "month",
      unit: "usd",
      pool: "brave",
    });
  });

  it("replaces a budget mode atomically", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        providers: { exa: { budget: { mode: "managed" } } },
      }),
    );

    expect(loadConfig().providers.exa.budget).toEqual({ mode: "managed" });
  });

  it.each([
    { mode: "hard", limit: 0, period: "month", unit: "usd" },
    { mode: "hard", limit: Number.NaN, period: "month", unit: "usd" },
    { mode: "hard", limit: 1, period: "week", unit: "usd" },
    { mode: "hard", limit: 1, period: "month", unit: "token" },
    { mode: "hard", limit: 1, period: "month", unit: "usd", pool: "" },
    { mode: "unknown" },
  ])("ignores invalid budget override %#", (budget) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        providers: { exa: { budget } },
      }),
    );

    expect(loadConfig().providers.exa.budget).toEqual({
      mode: "hard",
      limit: 10,
      period: "month",
      unit: "usd",
      pool: "exa",
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns once for multiple invalid budgets in one layer", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        providers: {
          exa: { budget: { mode: "hard", limit: -1, period: "month", unit: "usd" } },
          tavily: { budget: { mode: "invalid" } },
        },
      }),
    );

    loadConfig();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("restores conflicting shared-pool budgets as a group", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        providers: {
          brave: {
            budget: { mode: "hard", limit: 8, period: "month", unit: "usd", pool: "brave" },
          },
        },
      }),
    );

    const providers = loadConfig().providers;
    expect(providers.brave.budget).toEqual(providers["brave-llm"].budget);
    expect(providers.brave.budget).toMatchObject({ limit: 5, pool: "brave" });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("accepts matching shared-pool budget overrides", () => {
    const budget = { mode: "hard", limit: 8, period: "month", unit: "usd", pool: "brave" };
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        providers: { brave: { budget }, "brave-llm": { budget } },
      }),
    );

    expect(loadConfig().providers.brave.budget).toEqual(budget);
    expect(loadConfig().providers["brave-llm"].budget).toEqual(budget);
  });

  it("returns defaults for malformed JSON", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("not json{{{");
    const config = loadConfig();
    expect(config.defaultProvider).toBe("auto");
  });

  it("reads from tools.json path", () => {
    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      const p = typeof filePath === "string" ? filePath : filePath.toString();
      if (p.endsWith("tools.json")) {
        return JSON.stringify({ defaultProvider: "brave" });
      }
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.defaultProvider).toBe("brave");
  });

  it("resolves the global path from Pi's agent directory", () => {
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = "/custom/pi-agent";
    try {
      expect(getConfigPath()).toBe(path.join("/custom/pi-agent", "extensions", "tools.json"));
      loadConfig();
      expect(fs.readFileSync).toHaveBeenCalledWith(
        path.join("/custom/pi-agent", "extensions", "tools.json"),
        "utf-8",
      );
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
    }
  });

  it("does not read a second global config path", () => {
    const currentPath = getConfigPath();
    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      const resolved = typeof filePath === "string" ? filePath : filePath.toString();
      if (resolved === currentPath) throw new Error("ENOENT");
      return JSON.stringify({ defaultProvider: "unexpected" });
    });

    expect(loadConfig().defaultProvider).toBe("auto");
    expect(fs.readFileSync).toHaveBeenCalledTimes(1);
  });

  it("does not fall back to legacy when custom path is provided", () => {
    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      throw new Error("ENOENT");
    });
    const config = loadConfig("/custom/path.json");
    expect(config.defaultProvider).toBe("auto");
  });
});

describe("resolveApiKey", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    clearCredentialCache();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns undefined when no apiKey configured", () => {
    expect(resolveApiKey(undefined)).toBeUndefined();
  });

  it("resolves env var name (all-caps pattern)", () => {
    process.env.MY_API_KEY = "resolved-value";
    expect(resolveApiKey("MY_API_KEY")).toBe("resolved-value");
  });

  it("returns undefined when env var name does not resolve", () => {
    delete process.env.MISSING_KEY;
    expect(resolveApiKey("MISSING_KEY")).toBeUndefined();
  });

  it("treats non-env-var strings as literal keys", () => {
    expect(resolveApiKey("sk-literal-key-value")).toBe("sk-literal-key-value");
  });

  it("resolves shell commands prefixed with !", () => {
    const result = resolveApiKey("!echo test-key");
    expect(result).toBe("test-key");
  });
});

describe("GitHub config", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("provides default GitHub config when config file is missing", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.github).toBeDefined();
    expect(config.github.enabled).toBe(true);
    expect(config.github.maxRepoSizeMB).toBe(350);
    expect(config.github.cloneTimeoutSeconds).toBe(30);
  });

  it("merges user GitHub config with defaults", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        github: {
          maxRepoSizeMB: 500,
        },
      }),
    );
    const config = loadConfig();
    expect(config.github.enabled).toBe(true); // from defaults
    expect(config.github.maxRepoSizeMB).toBe(500); // from user
    expect(config.github.cloneTimeoutSeconds).toBe(30); // from defaults
  });

  it("allows disabling GitHub interception", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        github: {
          enabled: false,
        },
      }),
    );
    const config = loadConfig();
    expect(config.github.enabled).toBe(false);
  });

  it("preserves provider defaults alongside github config", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        github: { maxRepoSizeMB: 200 },
      }),
    );
    const config = loadConfig();
    // Provider defaults still present
    expect(config.providers.duckduckgo.enabled).toBe(true);
    // GitHub merged
    expect(config.github.maxRepoSizeMB).toBe(200);
    expect(config.github.enabled).toBe(true);
  });
});

describe("findProjectConfigPath", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns path when .pi/tools.json exists in cwd", () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return p === path.join("/projects/my-app", ".pi", "tools.json");
    });
    const result = findProjectConfigPath("/projects/my-app");
    expect(result).toBe(path.join("/projects/my-app", ".pi", "tools.json"));
  });

  it("walks up to find .pi/tools.json in ancestor", () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return p === path.join("/projects", ".pi", "tools.json");
    });
    const result = findProjectConfigPath("/projects/my-app/src/deep");
    expect(result).toBe(path.join("/projects", ".pi", "tools.json"));
  });

  it("returns undefined when no .pi/tools.json found", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const result = findProjectConfigPath("/projects/my-app");
    expect(result).toBeUndefined();
  });

  it("stops after 10 levels", () => {
    const calls: string[] = [];
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      calls.push(p as string);
      return false;
    });
    findProjectConfigPath("/a/b/c/d/e/f/g/h/i/j/k/l/m/n");
    expect(calls.length).toBeLessThanOrEqual(10);
  });

  it("stops at filesystem root", () => {
    const calls: string[] = [];
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      calls.push(p as string);
      return false;
    });
    findProjectConfigPath("/a/b");
    expect(calls.length).toBe(3);
  });
});

describe("loadMergedConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns global config when no project config exists", () => {
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const filePath = typeof p === "string" ? p : p.toString();
      if (filePath === getConfigPath()) {
        return JSON.stringify({
          defaultProvider: "brave",
          providers: { brave: { enabled: true, monthlyQuota: 2000 } },
        });
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const config = loadMergedConfig("/projects/my-app");
    expect(config.defaultProvider).toBe("brave");
  });

  it("deep-merges project config over global config", () => {
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const filePath = typeof p === "string" ? p : p.toString();
      if (filePath === getConfigPath()) {
        return JSON.stringify({
          defaultProvider: "auto",
          providers: {
            brave: { enabled: true, monthlyQuota: 2000 },
            exa: { enabled: true, monthlyQuota: 1000 },
          },
        });
      }
      if (filePath.includes(path.join(".pi", "tools.json"))) {
        return JSON.stringify({
          defaultProvider: "brave",
          providers: {
            exa: { enabled: false },
          },
        });
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return (p as string).includes(path.join(".pi", "tools.json"));
    });

    const config = loadMergedConfig("/projects/my-app");
    expect(config.defaultProvider).toBe("brave");
    // exa disabled by project config
    expect(config.providers.exa.enabled).toBe(false);
    // brave untouched — kept from global config
    expect(config.providers.brave.enabled).toBe(true);
    expect(config.providers.brave).not.toHaveProperty("monthlyQuota");
  });

  it("project config overrides built-in defaults when no global config", () => {
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const filePath = typeof p === "string" ? p : p.toString();
      if (filePath.includes(path.join(".pi", "tools.json"))) {
        return JSON.stringify({
          providers: { duckduckgo: { enabled: false } },
        });
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return (p as string).includes(path.join(".pi", "tools.json"));
    });

    const config = loadMergedConfig("/projects/my-app");
    // duckduckgo overridden by project config
    expect(config.providers.duckduckgo.enabled).toBe(false);
    // Other defaults preserved
    expect(config.providers.brave.enabled).toBe(true);
  });

  it("preserves github defaults when neither global nor project config includes them", () => {
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const filePath = typeof p === "string" ? p : p.toString();
      if (filePath === getConfigPath()) {
        return JSON.stringify({
          defaultProvider: "brave",
          providers: { brave: { enabled: true } },
        });
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const config = loadMergedConfig("/projects/my-app");
    expect(config.github).toBeDefined();
    expect(config.github.enabled).toBe(true);
    expect(config.github.maxRepoSizeMB).toBe(350);
    expect(config.github.cloneTimeoutSeconds).toBe(30);
  });

  it("deep-merges github config from project over global", () => {
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const filePath = typeof p === "string" ? p : p.toString();
      if (filePath === getConfigPath()) {
        return JSON.stringify({
          github: { maxRepoSizeMB: 500 },
        });
      }
      if (filePath.includes(path.join(".pi", "tools.json"))) {
        return JSON.stringify({
          github: { enabled: false },
        });
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return (p as string).includes(path.join(".pi", "tools.json"));
    });

    const config = loadMergedConfig("/projects/my-app");
    expect(config.github.enabled).toBe(false); // from project
    expect(config.github.maxRepoSizeMB).toBe(500); // from global
    expect(config.github.cloneTimeoutSeconds).toBe(30); // from defaults
  });

  it("loads only defaults and global config when cwd is undefined", () => {
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const filePath = typeof p === "string" ? p : p.toString();
      if (filePath === getConfigPath()) {
        return JSON.stringify({
          defaultProvider: "brave",
        });
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const config = loadMergedConfig();
    expect(config.defaultProvider).toBe("brave");
    // github defaults preserved
    expect(config.github.enabled).toBe(true);
  });

  it("does not read a second global config path", () => {
    const currentPath = getConfigPath();
    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      const resolved = typeof filePath === "string" ? filePath : filePath.toString();
      if (resolved === currentPath) throw new Error("ENOENT");
      return JSON.stringify({ defaultProvider: "unexpected" });
    });

    expect(loadMergedConfig().defaultProvider).toBe("auto");
    expect(fs.readFileSync).toHaveBeenCalledTimes(1);
  });
});

describe("config types — selectionStrategy and guidance", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads selectionStrategy from config file", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        defaultProvider: "auto",
        selectionStrategy: "best-performing",
        providers: {},
      }),
    );
    const config = loadConfig();
    expect(config.selectionStrategy).toBe("best-performing");
  });

  it("defaults selectionStrategy to auto when not specified", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.selectionStrategy).toBe("auto");
  });

  it("loads guidance overrides from config file", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        defaultProvider: "auto",
        providers: {},
        guidance: {
          web_search: {
            promptSnippet: "Custom search snippet",
            promptGuidelines: ["Guideline A", "Guideline B"],
          },
        },
      }),
    );
    const config = loadConfig();
    expect(config.guidance?.web_search?.promptSnippet).toBe("Custom search snippet");
    expect(config.guidance?.web_search?.promptGuidelines).toEqual(["Guideline A", "Guideline B"]);
  });

  it("defaults guidance to undefined when not specified", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.guidance).toBeUndefined();
  });

  it("rejects invalid selectionStrategy values", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        defaultProvider: "auto",
        selectionStrategy: "invalid-strategy",
        providers: {},
      }),
    );
    const config = loadConfig();
    // Invalid value should fall back to default
    expect(config.selectionStrategy).toBe("auto");
  });
});

describe("CombineConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("provides default combine config when config file is missing", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.combine).toEqual({
      enabled: false,
      mode: "targeted",
      targetBackends: 3,
      k: 60,
    });
  });

  it("provides default combine config when combine not in config file", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ defaultProvider: "brave" }));
    const config = loadConfig();
    expect(config.combine).toEqual({
      enabled: false,
      mode: "targeted",
      targetBackends: 3,
      k: 60,
    });
  });

  it("merges partial combine config with defaults", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ combine: { enabled: true, targetBackends: 5 } }),
    );
    const config = loadConfig();
    expect(config.combine.enabled).toBe(true);
    expect(config.combine.mode).toBe("targeted"); // default preserved
    expect(config.combine.targetBackends).toBe(5);
    expect(config.combine.k).toBe(60); // default preserved
  });

  it("validates combine.mode and falls back to default for unknown values", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ combine: { mode: "invalid" } }));
    expect(loadConfig().combine.mode).toBe("targeted");

    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ combine: { mode: "all" } }));
    expect(loadConfig().combine.mode).toBe("all");
  });

  it("clamps combine.targetBackends and k to minimum of 1", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ combine: { targetBackends: 0, k: -5 } }),
    );
    const config = loadConfig();
    expect(config.combine.targetBackends).toBe(1);
    expect(config.combine.k).toBe(1);
  });

  it("ignores non-boolean enabled values", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ combine: { enabled: "yes" } }));
    const config = loadConfig();
    expect(config.combine.enabled).toBe(false); // default
  });
});

// --- Phase 1: Credential caching, safety checks, resolveProviderKey ---

describe("resolveApiKey — shell command caching", () => {
  beforeEach(() => {
    vi.mocked(execSync).mockClear();
    vi.mocked(execSync).mockReturnValue("cached-secret\n");
    clearCredentialCache();
  });

  afterEach(() => {
    vi.mocked(execSync).mockRestore();
  });

  it("caches shell command results (execSync called only once for same command)", () => {
    const result1 = resolveApiKey("!echo cached-secret");
    const result2 = resolveApiKey("!echo cached-secret");
    expect(result1).toBe("cached-secret");
    expect(result2).toBe("cached-secret");
    expect(vi.mocked(execSync)).toHaveBeenCalledTimes(1);
  });

  it("clearCredentialCache causes re-execution on next call", () => {
    resolveApiKey("!echo cached-secret");
    expect(vi.mocked(execSync)).toHaveBeenCalledTimes(1);

    clearCredentialCache();
    resolveApiKey("!echo cached-secret");
    expect(vi.mocked(execSync)).toHaveBeenCalledTimes(2);
  });

  it("caches errors — does not retry failed commands", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("command failed");
    });
    const result1 = resolveApiKey("!bad-command");
    const result2 = resolveApiKey("!bad-command");
    expect(result1).toBeUndefined();
    expect(result2).toBeUndefined();
    expect(vi.mocked(execSync)).toHaveBeenCalledTimes(1);
  });
});

describe("resolveApiKey — safety checks", () => {
  it('returns undefined for "null"', () => {
    expect(resolveApiKey("null")).toBeUndefined();
  });

  it('returns undefined for "undefined"', () => {
    expect(resolveApiKey("undefined")).toBeUndefined();
  });

  it('returns undefined for "none"', () => {
    expect(resolveApiKey("none")).toBeUndefined();
  });

  it('returns undefined for "NONE" (case-insensitive)', () => {
    expect(resolveApiKey("NONE")).toBeUndefined();
  });
});

describe("resolveApiKey — env var warning", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.mocked(console.warn).mockRestore();
  });

  it("logs warning when ALL_CAPS env var is not set", () => {
    delete process.env.MISSING_PROVIDER_KEY;
    resolveApiKey("MISSING_PROVIDER_KEY");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("MISSING_PROVIDER_KEY"));
  });

  it("does not warn when env var is set", () => {
    process.env.BRAVE_API_KEY = "some-value";
    resolveApiKey("BRAVE_API_KEY");
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe("resolveProviderKey", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    clearCredentialCache();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("resolves config key when provided and valid", () => {
    process.env.MY_CUSTOM_KEY = "custom-value";
    const result = resolveProviderKey("brave", "MY_CUSTOM_KEY");
    expect(result).toBe("custom-value");
  });

  it("config key takes priority over fallback env", () => {
    process.env.MY_CUSTOM_KEY = "custom-value";
    process.env.BRAVE_API_KEY = "fallback-value";
    const result = resolveProviderKey("brave", "MY_CUSTOM_KEY");
    expect(result).toBe("custom-value");
  });

  it("falls back to FALLBACK_ENV_MAP when config key is undefined", () => {
    process.env.BRAVE_API_KEY = "fallback-value";
    const result = resolveProviderKey("brave", undefined);
    expect(result).toBe("fallback-value");
  });

  it("falls back to FALLBACK_ENV_MAP when config key does not resolve", () => {
    delete process.env.NONEXISTENT_KEY;
    process.env.EXA_API_KEY = "exa-fallback";
    const result = resolveProviderKey("exa", "NONEXISTENT_KEY");
    expect(result).toBe("exa-fallback");
  });

  it("returns undefined when neither config key nor fallback resolves", () => {
    delete process.env.BRAVE_API_KEY;
    const result = resolveProviderKey("brave", undefined);
    expect(result).toBeUndefined();
  });

  it("returns undefined for unknown provider with no config key", () => {
    const result = resolveProviderKey("unknown-provider", undefined);
    expect(result).toBeUndefined();
  });

  it("ignores empty/whitespace fallback env values", () => {
    process.env.BRAVE_API_KEY = "   ";
    const result = resolveProviderKey("brave", undefined);
    expect(result).toBeUndefined();
  });
});

describe("FALLBACK_ENV_MAP", () => {
  it("contains expected provider mappings", () => {
    expect(FALLBACK_ENV_MAP.brave).toBe("BRAVE_API_KEY");
    expect(FALLBACK_ENV_MAP.exa).toBe("EXA_API_KEY");
    expect(FALLBACK_ENV_MAP.tavily).toBe("TAVILY_API_KEY");
  });

  it("keeps API-key fallback only for OpenAI web search", () => {
    expect(FALLBACK_ENV_MAP["openai-codex"]).toBeUndefined();
    expect(FALLBACK_ENV_MAP["openai-web-search"]).toBe("OPENAI_API_KEY");
  });

  it("maps all expected providers", () => {
    const expected = [
      "brave",
      "exa",
      "jina",
      "tavily",
      "serper",
      "firecrawl",
      "perplexity",
      "langsearch",
      "linkup",
      "youcom",
      "fastcrw",
      "sofya",
      "websearchapi",
      "marginalia",
      "context7",
      "parallel",
    ];
    for (const name of expected) {
      expect(FALLBACK_ENV_MAP[name]).toBeDefined();
    }
  });
});
