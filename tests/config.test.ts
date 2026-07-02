import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, resolveApiKey } from "../src/config.ts";

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
