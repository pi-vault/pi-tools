import * as fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  handleEnable,
  handleDisable,
  handleKey,
  handleDefault,
  handleTest,
  maskKey,
  updateConfig,
  parseArgs,
} from "../../src/commands/tools-subcommands.ts";
import { getConfigPath } from "../../src/config.ts";
import { makeCtx } from "../helpers.ts";

vi.mock("node:fs");

describe("parseArgs", () => {
  it("parses subcommand with no args", () => {
    const result = parseArgs("status");
    expect(result).toEqual({ subcommand: "status", rest: [] });
  });

  it("parses subcommand with one arg", () => {
    const result = parseArgs("enable brave");
    expect(result).toEqual({ subcommand: "enable", rest: ["brave"] });
  });

  it("parses subcommand with multiple args", () => {
    const result = parseArgs("key brave BSA_abc123def");
    expect(result).toEqual({
      subcommand: "key",
      rest: ["brave", "BSA_abc123def"],
    });
  });

  it("returns empty subcommand for empty string", () => {
    const result = parseArgs("");
    expect(result).toEqual({ subcommand: "", rest: [] });
  });

  it("handles extra whitespace", () => {
    const result = parseArgs("  enable   brave  ");
    expect(result).toEqual({ subcommand: "enable", rest: ["brave"] });
  });
});

describe("maskKey", () => {
  it("masks a long key", () => {
    expect(maskKey("BSA_abcdefghij7x2f")).toBe("BSA_...7x2f");
  });

  it("returns short keys unchanged", () => {
    expect(maskKey("abc")).toBe("abc");
  });

  it("masks key with exactly 8 characters", () => {
    expect(maskKey("12345678")).toBe("1234...5678");
  });
});

describe("updateConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
  });

  it("reads existing config, applies updater, writes back", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ defaultProvider: "auto", providers: { brave: { enabled: true } } }),
    );

    updateConfig((config) => ({
      ...config,
      defaultProvider: "exa",
    }));

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [writePath, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(writePath).toBe(getConfigPath());
    const written = JSON.parse(writeContent as string);
    expect(written.defaultProvider).toBe("exa");
    expect(written.providers.brave.enabled).toBe(true);
  });

  it("creates new config when file does not exist", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    updateConfig((config) => ({
      ...config,
      providers: { brave: { enabled: true } },
    }));

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.providers.brave.enabled).toBe(true);
  });
});

describe("handleEnable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ providers: { brave: { enabled: false } } }),
    );
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
  });

  it("enables a provider in config", () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const allProviderNames = ["brave", "exa", "duckduckgo"];

    handleEnable(ctx, "brave", allProviderNames);

    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.providers.brave.enabled).toBe(true);
    expect(ctx.ui.notify).toHaveBeenCalled();
  });

  it("notifies on unknown provider name", () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const allProviderNames = ["brave", "exa"];

    handleEnable(ctx, "nonexistent", allProviderNames);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg.toLowerCase()).toContain("unknown");
  });
});

describe("handleDisable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ providers: { brave: { enabled: true } } }),
    );
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
  });

  it("disables a provider in config", () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const allProviderNames = ["brave", "exa"];

    handleDisable(ctx, "brave", allProviderNames);

    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.providers.brave.enabled).toBe(false);
  });
});

describe("handleKey", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ providers: { brave: { enabled: true } } }),
    );
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
  });

  it("sets API key for a provider", () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const allProviderNames = ["brave", "exa"];

    handleKey(ctx, "brave", "BSA_newkey12345678", allProviderNames);

    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.providers.brave.apiKey).toBe("BSA_newkey12345678");
    // Should display masked key in notification
    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg).toContain("BSA_...5678");
  });

  it("notifies when value is missing", () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const allProviderNames = ["brave"];

    handleKey(ctx, "brave", undefined, allProviderNames);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg.toLowerCase()).toContain("usage");
  });
});

describe("handleDefault", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ defaultProvider: "auto" }),
    );
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
  });

  it("sets default provider", () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const allProviderNames = ["brave", "exa"];

    handleDefault(ctx, "exa", allProviderNames);

    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.defaultProvider).toBe("exa");
  });

  it("accepts 'auto' as default", () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const allProviderNames = ["brave", "exa"];

    handleDefault(ctx, "auto", allProviderNames);

    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.defaultProvider).toBe("auto");
  });

  it("rejects unknown provider name", () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const allProviderNames = ["brave", "exa"];

    handleDefault(ctx, "nonexistent", allProviderNames);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});

describe("handleTest", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("tests a specific provider by making a search call", async () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const mockSearch = vi.fn().mockResolvedValue([
      { title: "Test", url: "https://test.com", snippet: "test" },
    ]);
    const registry = {
      getSearchProviderNames: () => ["brave"],
      selectSearchCandidates: (name: string) =>
        name === "brave" ? [{ name: "brave", label: "Brave", search: mockSearch }] : [],
    };

    await handleTest(ctx, "brave", registry as any);

    expect(mockSearch).toHaveBeenCalled();
    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg.toLowerCase()).toContain("brave");
  });

  it("reports failure when provider is not found", async () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const registry = {
      getSearchProviderNames: () => [],
      selectSearchCandidates: () => [],
    };

    await handleTest(ctx, "nonexistent", registry as any);

    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg.toLowerCase()).toContain("not found");
  });

  it("tests all providers when name is undefined", async () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const mockBraveSearch = vi.fn().mockResolvedValue([{ title: "t", url: "u", snippet: "s" }]);
    const mockExaSearch = vi.fn().mockResolvedValue([]);
    const registry = {
      getSearchProviderNames: () => ["brave", "exa"],
      selectSearchCandidates: (name: string) => {
        if (name === "brave") return [{ name: "brave", label: "Brave", search: mockBraveSearch }];
        if (name === "exa") return [{ name: "exa", label: "Exa", search: mockExaSearch }];
        return [];
      },
    };

    await handleTest(ctx, undefined, registry as any);

    // Both providers should have been tested
    expect(mockBraveSearch).toHaveBeenCalled();
    expect(mockExaSearch).toHaveBeenCalled();
    // Output should mention both
    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg).toContain("brave");
    expect(msg).toContain("exa");
  });
});
