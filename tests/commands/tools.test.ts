import * as fs from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createToolsCommand } from "../../src/commands/tools.ts";
import { getConfigPath } from "../../src/config.ts";
import { ProviderRegistry } from "../../src/providers/registry.ts";
import type { SearchProvider, ProviderTier } from "../../src/providers/types.ts";
import { makeCtx } from "../helpers.ts";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

vi.mock("node:fs");

const mem = () => new ProviderRegistry({ load: () => ({}), save: () => {} });

function mockProvider(name: string, label: string): SearchProvider {
  return {
    name,
    label,
    search: vi.fn().mockResolvedValue([]),
  };
}

describe("tools --status command", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
  });

  it("displays provider status table with metrics", async () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    const exa = mockProvider("exa", "Exa");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
    registry.registerSearch(exa, { tier: 1, monthlyQuota: 1000 });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    // Simulate some usage
    registry.recordUsage("brave");
    registry.recordSuccess("brave", 340);
    registry.recordSuccess("brave", 340);
    registry.recordFailure("brave");
    registry.recordSuccess("exa", 520);

    const tierMap = new Map<string, ProviderTier>([
      ["brave", 1],
      ["exa", 1],
      ["duckduckgo", 3],
    ]);

    const command = createToolsCommand(registry, tierMap);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    // handler receives args as a single string
    await command.handler("--status", ctx);

    expect(ctx.ui.notify).toHaveBeenCalled();
    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;

    // Should contain provider names
    expect(output).toContain("brave");
    expect(output).toContain("exa");
    expect(output).toContain("duckduckgo");
    // Should contain tier info
    expect(output).toContain("1");
    expect(output).toContain("3");
    // Should contain session stats for brave
    expect(output).toContain("2/1"); // 2 successes, 1 failure
    // Should contain remaining for brave (2000 - 1 = 1999)
    expect(output).toContain("1,999");
    // Should show unlimited for ddg
    expect(output).toMatch(/unlimited/i);
  });

  it("shows -- for avg latency when no successful calls", async () => {
    const registry = mem();
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    const tierMap = new Map<string, ProviderTier>([["duckduckgo", 3]]);
    const command = createToolsCommand(registry, tierMap);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("--status", ctx);

    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(output).toContain("--");
  });

  it("handles empty registry gracefully", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>();

    const command = createToolsCommand(registry, tierMap);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("--status", ctx);

    expect(ctx.ui.notify).toHaveBeenCalled();
    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(output).toContain("No providers registered");
  });
});

describe("tools interactive setup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it("prompts to enable each provider via confirm", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>();
    const allProviderNames = ["brave", "duckduckgo"];

    const command = createToolsCommand(registry, tierMap, allProviderNames);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    // Enable brave, skip duckduckgo
    vi.mocked(ctx.ui.confirm)
      .mockResolvedValueOnce(true)   // brave: yes
      .mockResolvedValueOnce(false); // duckduckgo: no
    // API key for brave
    vi.mocked(ctx.ui.input).mockResolvedValueOnce("test-brave-key");
    // Default provider
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("auto");

    await command.handler("", ctx);

    // Should have asked about both providers
    expect(ctx.ui.confirm).toHaveBeenCalledTimes(2);
  });

  it("writes config to global config path", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>();
    const allProviderNames = ["brave", "duckduckgo"];

    const command = createToolsCommand(registry, tierMap, allProviderNames);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    // Enable brave only
    vi.mocked(ctx.ui.confirm)
      .mockResolvedValueOnce(true)   // brave: yes
      .mockResolvedValueOnce(false); // duckduckgo: no
    vi.mocked(ctx.ui.input).mockResolvedValueOnce("test-key-123");
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("auto");

    await command.handler("", ctx);

    // Should write to global config path
    expect(fs.writeFileSync).toHaveBeenCalled();
    const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
    const [writePath, writeContent] = writeCalls[writeCalls.length - 1];
    expect(writePath).toBe(getConfigPath());

    const written = JSON.parse(writeContent as string);
    expect(written.defaultProvider).toBe("auto");
    expect(written.providers.brave.enabled).toBe(true);
    expect(written.providers.brave.apiKey).toBe("test-key-123");
    expect(written.providers.duckduckgo.enabled).toBe(false);
  });

  it("notifies user on successful save", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>();
    const allProviderNames = ["brave"];

    const command = createToolsCommand(registry, tierMap, allProviderNames);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    vi.mocked(ctx.ui.confirm).mockResolvedValueOnce(true);
    vi.mocked(ctx.ui.input).mockResolvedValueOnce("my-key");
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("auto");

    await command.handler("", ctx);

    // Should notify success
    const notifyCalls = vi.mocked(ctx.ui.notify).mock.calls;
    const lastNotify = notifyCalls[notifyCalls.length - 1][0] as string;
    expect(lastNotify.toLowerCase()).toContain("saved");
  });

  it("handles no providers available", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>();

    const command = createToolsCommand(registry, tierMap, []);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("", ctx);

    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(output).toContain("No providers available");
  });

  it("skips API key prompt for providers the user disables", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>();
    const allProviderNames = ["brave", "exa"];

    const command = createToolsCommand(registry, tierMap, allProviderNames);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    // Disable both providers
    vi.mocked(ctx.ui.confirm)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("auto");

    await command.handler("", ctx);

    // Should NOT have asked for any API keys
    expect(ctx.ui.input).not.toHaveBeenCalled();
  });
});
