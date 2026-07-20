import * as fs from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createToolsCommand } from "../../src/commands/tools.ts";
import { activityMonitor } from "../../src/monitor/activity-monitor.ts";
import { getConfigPath, type ProviderBudget } from "../../src/config.ts";
import { ProviderRegistry } from "../../src/providers/registry.ts";
import type { ProviderTier, SearchProvider } from "../../src/providers/types.ts";
import { makeCtx } from "../helpers.ts";

vi.mock("node:fs");

const mem = () =>
  new ProviderRegistry({ load: () => ({ version: 2, counters: {} }), save: () => {} });

const trackedCommands = new Set<ReturnType<typeof createToolsCommand>>();

function trackedToolsCommand(...args: Parameters<typeof createToolsCommand>) {
  const command = createToolsCommand(...args);
  trackedCommands.add(command);
  return command;
}

afterEach(() => {
  for (const command of trackedCommands) command.resetMonitor();
  trackedCommands.clear();
  activityMonitor.clear();
});

function widgetCtx() {
  const ctx = makeCtx() as unknown as ExtensionCommandContext;
  (ctx.ui as any).custom = vi.fn();
  (ctx.ui as any).setWidget = vi.fn();
  (ctx.ui as any).theme = { fg: (_color: string, text: string) => text };
  return ctx;
}

function mockProvider(name: string, label: string): SearchProvider {
  return {
    name,
    label,
    search: vi.fn().mockResolvedValue([]),
  };
}

function registerSearch(
  registry: ProviderRegistry,
  name: string,
  budget: ProviderBudget,
  tier: ProviderTier,
  usageCost?: () => number,
): void {
  registry.registerProvider(
    { search: mockProvider(name, name) },
    {
      name,
      tier,
      budget,
      config: { enabled: true, budget },
      usageCost,
    },
  );
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

  it("displays hard, managed, unlimited, and docs-only budgets with metrics", async () => {
    const registry = mem();
    registerSearch(
      registry,
      "brave",
      { mode: "hard", limit: 5, period: "month", unit: "usd", pool: "brave" },
      1,
      () => 0.005,
    );
    registerSearch(registry, "exa", { mode: "managed" }, 1);
    registerSearch(registry, "duckduckgo", { mode: "unlimited" }, 3);
    const docsBudget: ProviderBudget = {
      mode: "hard",
      limit: 1000,
      period: "month",
      unit: "request",
    };
    registry.registerProvider(
      {
        docs: {
          name: "context7",
          label: "Context7",
          searchLibrary: vi.fn(),
          getContext: vi.fn(),
        },
      },
      {
        name: "context7",
        tier: 1,
        budget: docsBudget,
        config: { enabled: true, budget: docsBudget },
      },
    );

    registry.consume("brave", { capability: "search", maxResults: 10 });

    registry.recordOutcome("brave", { success: true, latencyMs: 340 });
    registry.recordOutcome("brave", { success: true, latencyMs: 340 });
    registry.recordOutcome("brave", { success: false });
    registry.recordOutcome("exa", { success: true, latencyMs: 520 });

    const tierMap = new Map<string, ProviderTier>([
      ["brave", 1],
      ["exa", 1],
      ["duckduckgo", 3],
      ["context7", 1],
    ]);

    const command = createToolsCommand(registry, tierMap);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("status", ctx);

    expect(ctx.ui.notify).toHaveBeenCalled();
    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;

    expect(output).toContain("brave");
    expect(output).toContain("exa");
    expect(output).toContain("duckduckgo");
    expect(output).toContain("context7");
    expect(output).toContain("1");
    expect(output).toContain("3");
    expect(output).toContain("2/1");
    expect(output).toContain("0.005000");
    expect(output).toContain("5.000000");
    expect(output).toContain("managed");
    expect(output).toMatch(/unlimited/i);
    expect(output).toContain("request");
    expect(output).toContain("month");
    expect(output).toContain("pool: brave");
  });

  it("shows one shared-pool counter for both providers", async () => {
    const registry = mem();
    const budget: ProviderBudget = {
      mode: "hard",
      limit: 5,
      period: "month",
      unit: "usd",
      pool: "brave",
    };
    registerSearch(registry, "brave", budget, 1, () => 0.005);
    registerSearch(registry, "brave-llm", budget, 1, () => 0.005);
    registry.consume("brave", { capability: "search", maxResults: 10 });

    const command = createToolsCommand(
      registry,
      new Map<string, ProviderTier>([
        ["brave", 1],
        ["brave-llm", 1],
      ]),
    );
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    await command.handler("status", ctx);

    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(output.match(/0\.005000/g)).toHaveLength(2);
  });

  it("shows -- for avg latency when no successful calls", async () => {
    const registry = mem();
    registerSearch(registry, "duckduckgo", { mode: "unlimited" }, 3);

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
    registerSearch(registry, "brave", { mode: "managed" }, 1);

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
    registerSearch(registry, "brave", { mode: "managed" }, 1);

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
    registerSearch(registry, "brave", { mode: "managed" }, 1);

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

  it("opens the Status overlay for an empty argument string", async () => {
    const registry = mem();
    const command = createToolsCommand(registry, new Map());
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const custom = vi.fn().mockResolvedValue({ type: "close" });
    (ctx.ui as any).custom = custom;

    await command.handler("", ctx);

    expect(custom).toHaveBeenCalledWith(expect.any(Function), {
      overlay: true,
      overlayOptions: { anchor: "center", maxHeight: "85%", width: "92%" },
    });
    expect(ctx.ui.select).not.toHaveBeenCalled();
  });

  it("reloads and reopens the Status overlay", async () => {
    const reload = vi.fn();
    const command = createToolsCommand(mem(), new Map(), [], reload);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const custom = vi
      .fn()
      .mockResolvedValueOnce({ type: "reload", activeTab: "status" })
      .mockResolvedValueOnce({ type: "close" });
    (ctx.ui as any).custom = custom;

    await command.handler("", ctx);

    expect(reload).toHaveBeenCalledOnce();
    expect(custom).toHaveBeenCalledTimes(2);
  });

  it("warns instead of opening the overlay outside TUI mode", async () => {
    const command = createToolsCommand(mem(), new Map());
    const ctx = makeCtx({
      mode: "rpc",
      hasUI: true,
    }) as unknown as ExtensionCommandContext;
    (ctx.ui as any).custom = vi.fn();

    await command.handler("", ctx);

    expect((ctx.ui as any).custom).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("interactive TUI"),
      "warning",
    );
  });

  it("keeps typed provider tests available outside TUI mode", async () => {
    const registry = mem();
    const provider = mockProvider("brave", "Brave");
    registry.registerProvider(
      { search: provider },
      {
        name: "brave",
        tier: 1,
        budget: { mode: "managed" },
        config: { enabled: true, budget: { mode: "managed" } },
      },
    );
    const command = createToolsCommand(registry, new Map(), ["brave"]);
    const ctx = makeCtx({ mode: "rpc" }) as unknown as ExtensionCommandContext;
    (ctx.ui as any).custom = vi.fn();

    await command.handler("test brave", ctx);

    expect(vi.mocked(provider.search).mock.calls[0]?.slice(0, 2)).toEqual(["test", 1]);
    expect((ctx.ui as any).custom).not.toHaveBeenCalled();
  });

  it("calls onReload after config-modifying subcommands", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>([["brave", 1]]);
    const onReload = vi.fn();
    const command = createToolsCommand(registry, tierMap, ["brave"], onReload);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("enable brave", ctx);
    expect(onReload).toHaveBeenCalledTimes(1);

    await command.handler("disable brave", ctx);
    expect(onReload).toHaveBeenCalledTimes(2);
  });
});

describe("tools monitor subcommand", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("monitor on subscribes and shows notification", async () => {
    const command = trackedToolsCommand(mem(), new Map());
    const ctx = widgetCtx();

    await command.handler("monitor on", ctx);

    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg.toLowerCase()).toContain("enabled");
    expect((ctx.ui as any).setWidget).toHaveBeenCalledWith(
      "pi-tools-activity",
      expect.arrayContaining([expect.any(String)]),
    );
  });

  it("monitor off removes widget and shows notification", async () => {
    const command = trackedToolsCommand(mem(), new Map());
    const ctx = widgetCtx();

    await command.handler("monitor on", ctx);
    await command.handler("monitor off", ctx);

    const lastCall = (ctx.ui as any).setWidget.mock.calls.at(-1);
    expect(lastCall[0]).toBe("pi-tools-activity");
    expect(lastCall[1]).toBeUndefined();

    const notifyCalls = vi.mocked(ctx.ui.notify).mock.calls;
    const lastNotify = notifyCalls.at(-1)?.[0] as string;
    expect(lastNotify.toLowerCase()).toContain("disabled");
  });

  it("monitor without on/off shows usage", async () => {
    const command = trackedToolsCommand(mem(), new Map());
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("monitor", ctx);

    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg.toLowerCase()).toContain("usage");
  });

  it("monitor on twice keeps one subscription and one initial render", async () => {
    const onUpdate = vi.spyOn(activityMonitor, "onUpdate");
    const command = trackedToolsCommand(mem(), new Map());
    const ctx = widgetCtx();

    await command.handler("monitor on", ctx);
    const renders = (ctx.ui as any).setWidget.mock.calls.length;
    await command.handler("monitor on", ctx);

    expect(onUpdate).toHaveBeenCalledOnce();
    expect((ctx.ui as any).setWidget).toHaveBeenCalledTimes(renders);
  });
});

describe("tools dashboard widget lifecycle", () => {
  it("keeps a dashboard-enabled widget after overlay close", async () => {
    const ctx = widgetCtx();
    (ctx.ui as any).custom
      .mockResolvedValueOnce({ type: "toggle-widget", activeTab: "activity" })
      .mockResolvedValueOnce({ type: "close" });
    const command = trackedToolsCommand(mem(), new Map());

    await command.handler("", ctx);

    expect((ctx.ui as any).setWidget.mock.calls.at(-1)?.[1]).toEqual(expect.any(Array));
  });

  it("uses one persistent subscription across overlay reopen", async () => {
    const onUpdate = vi.spyOn(activityMonitor, "onUpdate");
    const ctx = widgetCtx();
    (ctx.ui as any).custom
      .mockResolvedValueOnce({ type: "toggle-widget", activeTab: "activity" })
      .mockResolvedValueOnce({ type: "close" });
    const command = trackedToolsCommand(mem(), new Map());

    await command.handler("", ctx);
    expect(onUpdate).toHaveBeenCalledOnce();

    const before = (ctx.ui as any).setWidget.mock.calls.length;
    activityMonitor.logStart({ type: "api", query: "one" });
    expect((ctx.ui as any).setWidget).toHaveBeenCalledTimes(before + 1);
  });

  it("resetMonitor unsubscribes, removes the widget, and clears entries", async () => {
    const ctx = widgetCtx();
    (ctx.ui as any).custom
      .mockResolvedValueOnce({ type: "toggle-widget", activeTab: "activity" })
      .mockResolvedValueOnce({ type: "close" });
    const command = trackedToolsCommand(mem(), new Map());

    await command.handler("", ctx);
    activityMonitor.logStart({ type: "api", query: "before-reset" });
    command.resetMonitor();

    expect((ctx.ui as any).setWidget).toHaveBeenLastCalledWith("pi-tools-activity", undefined);
    expect(activityMonitor.getEntries()).toEqual([]);

    const callsAfterReset = (ctx.ui as any).setWidget.mock.calls.length;
    activityMonitor.logStart({ type: "api", query: "after-reset" });
    expect((ctx.ui as any).setWidget).toHaveBeenCalledTimes(callsAfterReset);
  });
});
