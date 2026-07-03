import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, resolveApiKey, findProjectConfigPath, loadMergedConfig } from "../src/config.ts";
import * as path from "node:path";

vi.mock("node:fs");

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
    expect(config.providers.brave.monthlyQuota).toBe(2000);
  });

  it("returns defaults for malformed JSON", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("not json{{{");
    const config = loadConfig();
    expect(config.defaultProvider).toBe("auto");
  });
});

describe("resolveApiKey", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
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

  it("returns path when .pi/pi-tools.json exists in cwd", () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return p === path.join("/projects/my-app", ".pi", "pi-tools.json");
    });
    const result = findProjectConfigPath("/projects/my-app");
    expect(result).toBe(
      path.join("/projects/my-app", ".pi", "pi-tools.json"),
    );
  });

  it("walks up to find .pi/pi-tools.json in ancestor", () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return p === path.join("/projects", ".pi", "pi-tools.json");
    });
    const result = findProjectConfigPath("/projects/my-app/src/deep");
    expect(result).toBe(path.join("/projects", ".pi", "pi-tools.json"));
  });

  it("returns undefined when no .pi/pi-tools.json found", () => {
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
    // Should check at most 10 directories
    expect(calls.length).toBeLessThanOrEqual(10);
  });

  it("stops at filesystem root", () => {
    const calls: string[] = [];
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      calls.push(p as string);
      return false;
    });
    findProjectConfigPath("/a/b");
    // /a/b, /a, / — should stop at root, not go further
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
      if (filePath.includes(path.join(".pi", "agent"))) {
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
      if (filePath.includes(path.join(".pi", "agent"))) {
        return JSON.stringify({
          defaultProvider: "auto",
          providers: {
            brave: { enabled: true, monthlyQuota: 2000 },
            exa: { enabled: true, monthlyQuota: 1000 },
          },
        });
      }
      if (filePath.includes(path.join(".pi", "pi-tools.json"))) {
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
      return (p as string).includes(path.join(".pi", "pi-tools.json"));
    });

    const config = loadMergedConfig("/projects/my-app");
    expect(config.defaultProvider).toBe("brave");
    // exa disabled by project config
    expect(config.providers.exa.enabled).toBe(false);
    // brave untouched — kept from global config
    expect(config.providers.brave.enabled).toBe(true);
    expect(config.providers.brave.monthlyQuota).toBe(2000);
  });

  it("project config overrides built-in defaults when no global config", () => {
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const filePath = typeof p === "string" ? p : p.toString();
      if (filePath.includes(path.join(".pi", "pi-tools.json"))) {
        return JSON.stringify({
          providers: { duckduckgo: { enabled: false } },
        });
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return (p as string).includes(path.join(".pi", "pi-tools.json"));
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
      if (filePath.includes(path.join(".pi", "agent"))) {
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
      if (filePath.includes(path.join(".pi", "agent"))) {
        return JSON.stringify({
          github: { maxRepoSizeMB: 500 },
        });
      }
      if (filePath.includes(path.join(".pi", "pi-tools.json"))) {
        return JSON.stringify({
          github: { enabled: false },
        });
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return (p as string).includes(path.join(".pi", "pi-tools.json"));
    });

    const config = loadMergedConfig("/projects/my-app");
    expect(config.github.enabled).toBe(false); // from project
    expect(config.github.maxRepoSizeMB).toBe(500); // from global
    expect(config.github.cloneTimeoutSeconds).toBe(30); // from defaults
  });

  it("loads only defaults and global config when cwd is undefined", () => {
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const filePath = typeof p === "string" ? p : p.toString();
      if (filePath.includes(path.join(".pi", "agent"))) {
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
});
