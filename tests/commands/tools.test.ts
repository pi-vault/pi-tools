import * as fs from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createToolsCommand } from "../../src/commands/tools.ts";
import { getConfigPath } from "../../src/config.ts";
import { ProviderRegistry } from "../../src/providers/registry.ts";
import type { ProviderTier, SearchProvider } from "../../src/providers/types.ts";
import { makeCtx } from "../helpers.ts";

vi.mock("node:fs");

const mem = () => new ProviderRegistry({ load: () => ({}), save: () => {} });

function mockProvider(name: string, label: string): SearchProvider {
  return {
    name,
    label,
    search: vi.fn().mockResolvedValue([]),
  };
}

describe("tools status subcommand", () => {
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

    registry.recordOutcome("brave", { success: true, latencyMs: 340 });
    registry.recordOutcome("brave", { success: true, latencyMs: 340 });
    registry.recordOutcome("brave", { success: false });
    registry.recordOutcome("exa", { success: true, latencyMs: 520 });

    const tierMap = new Map<string, ProviderTier>([
      ["brave", 1],
      ["exa", 1],
      ["duckduckgo", 3],
    ]);

    const command = createToolsCommand(registry, tierMap);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("status", ctx);

    expect(ctx.ui.notify).toHaveBeenCalled();
    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;

    expect(output).toContain("brave");
    expect(output).toContain("exa");
    expect(output).toContain("duckduckgo");
    expect(output).toContain("1");
    expect(output).toContain("3");
    expect(output).toContain("2/1");
    expect(output).toContain("1,997");
    expect(output).toMatch(/unlimited/i);
  });

  it("shows -- for avg latency when no successful calls", async () => {
    const registry = mem();
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    const tierMap = new Map<string, ProviderTier>([["duckduckgo", 3]]);
    const command = createToolsCommand(registry, tierMap);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("status", ctx);

    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(output).toContain("--");
  });

  it("handles empty registry gracefully", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>();

    const command = createToolsCommand(registry, tierMap);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("status", ctx);

    expect(ctx.ui.notify).toHaveBeenCalled();
    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(output).toContain("No providers registered");
  });

  it("also accepts legacy --status flag", async () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

    const tierMap = new Map<string, ProviderTier>([["brave", 1]]);
    const command = createToolsCommand(registry, tierMap);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("--status", ctx);

    expect(ctx.ui.notify).toHaveBeenCalled();
    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(output).toContain("brave");
  });
});

describe("tools reload subcommand", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls onReload callback when reload is passed", async () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

    const tierMap = new Map<string, ProviderTier>([["brave", 1]]);
    const onReload = vi.fn();
    const command = createToolsCommand(registry, tierMap, ["brave"], onReload);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("reload", ctx);

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify).toHaveBeenCalled();
    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(output).toContain("brave");
  });

  it("also accepts legacy --reload flag", async () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

    const tierMap = new Map<string, ProviderTier>([["brave", 1]]);
    const onReload = vi.fn();
    const command = createToolsCommand(registry, tierMap, ["brave"], onReload);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("--reload", ctx);

    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe("tools subcommand dispatch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it("dispatches enable subcommand", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>([["brave", 1]]);
    const command = createToolsCommand(registry, tierMap, ["brave"]);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("enable brave", ctx);

    expect(fs.writeFileSync).toHaveBeenCalled();
    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.providers.brave.enabled).toBe(true);
  });

  it("dispatches disable subcommand", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>([["brave", 1]]);
    const command = createToolsCommand(registry, tierMap, ["brave"]);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("disable brave", ctx);

    expect(fs.writeFileSync).toHaveBeenCalled();
    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.providers.brave.enabled).toBe(false);
  });

  it("dispatches key subcommand", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>([["brave", 1]]);
    const command = createToolsCommand(registry, tierMap, ["brave"]);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("key brave BSA_abc123def456", ctx);

    expect(fs.writeFileSync).toHaveBeenCalled();
    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.providers.brave.apiKey).toBe("BSA_abc123def456");
  });

  it("dispatches default subcommand", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>([["exa", 1]]);
    const command = createToolsCommand(registry, tierMap, ["exa"]);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("default exa", ctx);

    expect(fs.writeFileSync).toHaveBeenCalled();
    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.defaultProvider).toBe("exa");
  });

  it("shows usage for unknown subcommand", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>();
    const command = createToolsCommand(registry, tierMap, []);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("foobar", ctx);

    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg.toLowerCase()).toContain("unknown");
  });

  it("runs enhanced wizard when no args", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>([["brave", 1]]);
    const command = createToolsCommand(registry, tierMap, ["brave"]);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    // User cancels setup mode selection
    vi.mocked(ctx.ui.select).mockResolvedValueOnce(undefined);

    await command.handler("", ctx);

    // Should have shown preamble via notify and prompted via select
    expect(ctx.ui.notify).toHaveBeenCalled();
    expect(ctx.ui.select).toHaveBeenCalled();
  });
});

describe("tools monitor subcommand", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("monitor on subscribes and shows notification", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>();
    const command = createToolsCommand(registry, tierMap);
    // makeCtx() doesn't include setWidget — add it manually
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    (ctx.ui as any).setWidget = vi.fn();
    (ctx.ui as any).theme = { fg: (_c: string, t: string) => t };

    await command.handler("monitor on", ctx);

    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg.toLowerCase()).toContain("enabled");
    expect((ctx.ui as any).setWidget).toHaveBeenCalledWith(
      "pi-tools-activity",
      expect.arrayContaining([expect.any(String)]),
    );
  });

  it("monitor off removes widget and shows notification", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>();
    const command = createToolsCommand(registry, tierMap);
    // makeCtx() doesn't include setWidget — add it manually
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    (ctx.ui as any).setWidget = vi.fn();
    (ctx.ui as any).theme = { fg: (_c: string, t: string) => t };

    // First turn on
    await command.handler("monitor on", ctx);
    // Then turn off
    await command.handler("monitor off", ctx);

    const lastCall = (ctx.ui as any).setWidget.mock.calls.at(-1);
    expect(lastCall[0]).toBe("pi-tools-activity");
    expect(lastCall[1]).toBeUndefined();

    const notifyCalls = vi.mocked(ctx.ui.notify).mock.calls;
    const lastNotify = notifyCalls.at(-1)?.[0] as string;
    expect(lastNotify.toLowerCase()).toContain("disabled");
  });

  it("monitor without on/off shows usage", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>();
    const command = createToolsCommand(registry, tierMap);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("monitor", ctx);

    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg.toLowerCase()).toContain("usage");
  });

  it("resetMonitor clears entries and unsubscribes", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>();
    const command = createToolsCommand(registry, tierMap);
    // makeCtx() doesn't include setWidget — add it manually
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    (ctx.ui as any).setWidget = vi.fn();
    (ctx.ui as any).theme = { fg: (_c: string, t: string) => t };

    // Turn on monitor
    await command.handler("monitor on", ctx);
    // Reset
    command.resetMonitor();

    // Monitor should be disconnected — new events should not trigger setWidget
    const callCountBefore = (ctx.ui as any).setWidget.mock.calls.length;
    const { activityMonitor } = await import("../../src/monitor/activity-monitor.ts");
    activityMonitor.logStart({ type: "api", query: "after-reset" });
    const callCountAfter = (ctx.ui as any).setWidget.mock.calls.length;
    expect(callCountAfter).toBe(callCountBefore);
  });
});
