import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigScope } from "../../src/commands/tools-actions.ts";
import type { DashboardOptions } from "../../src/commands/tools-dashboard.ts";
import { createToolsCommand } from "../../src/commands/tools.ts";
import { activityMonitor } from "../../src/monitor/activity-monitor.ts";
import { getConfigPath, type ProviderBudget } from "../../src/config.ts";
import { ProviderRegistry } from "../../src/providers/registry.ts";
import type { ProviderTier, SearchProvider } from "../../src/providers/types.ts";
import { makeCtx } from "../helpers.ts";

vi.mock("node:fs");

const providerState = {
  providers: {
    brave: {
      enabled: true,
      apiKey: "BRAVE_API_KEY",
      budget: { mode: "managed" as const },
    },
    duckduckgo: {
      enabled: false,
      budget: { mode: "unlimited" as const },
    },
  },
  defaultProvider: "brave",
};
const globalProviderState = {
  ...providerState,
  providers: {
    ...providerState.providers,
    brave: { ...providerState.providers.brave, enabled: true },
  },
};
const projectProviderState = {
  ...providerState,
  providers: {
    ...providerState.providers,
    brave: { ...providerState.providers.brave, enabled: false },
  },
};

function commandDeps() {
  return {
    getConfig: vi.fn((scope: ConfigScope) =>
      scope === "global" ? globalProviderState : projectProviderState,
    ),
    reload: vi.fn(),
  };
}

const testTheme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  inverse: (text: string) => text,
};

function dashboardActions(
  ctx: ExtensionCommandContext,
  actions: unknown[],
  captures: DashboardOptions[] = [],
): void {
  type DashboardFactory = Parameters<ExtensionCommandContext["ui"]["custom"]>[0];
  const custom = vi.fn(async (factory: DashboardFactory) => {
    const component = factory(
      { requestRender: vi.fn() } as never,
      testTheme as never,
      {} as never,
      vi.fn(),
    ) as unknown as { options: DashboardOptions };
    captures.push(component.options);
    return actions.shift();
  });
  ctx.ui.custom = custom as unknown as typeof ctx.ui.custom;
}

const mem = () =>
  new ProviderRegistry({ load: () => ({ version: 2, counters: {} }), save: () => {} });

const trackedCommands = new Set<ReturnType<typeof createToolsCommand>>();

function testToolsCommand(
  registry: ProviderRegistry,
  tierMap: ReadonlyMap<string, ProviderTier>,
  allProviderNames: string[] = [],
  reload = vi.fn(),
) {
  return createToolsCommand(registry, tierMap, allProviderNames, {
    getConfig: () => providerState,
    reload,
  });
}

function trackedToolsCommand(...args: Parameters<typeof testToolsCommand>) {
  const command = testToolsCommand(...args);
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

    const command = testToolsCommand(registry, tierMap);
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

    const command = testToolsCommand(
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
    const command = testToolsCommand(registry, tierMap);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("status", ctx);

    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(output).toContain("--");
  });

  it("handles empty registry gracefully", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>();

    const command = testToolsCommand(registry, tierMap);
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
    const command = testToolsCommand(registry, tierMap);
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
    const command = testToolsCommand(registry, tierMap, ["brave"], onReload);
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
    const command = testToolsCommand(registry, tierMap, ["brave"], onReload);
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
    const command = testToolsCommand(registry, tierMap, ["brave"]);
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
    const command = testToolsCommand(registry, tierMap, ["brave"]);
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
    const command = testToolsCommand(registry, tierMap, ["brave"]);
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
    const command = testToolsCommand(registry, tierMap, ["exa"]);
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
    const command = testToolsCommand(registry, tierMap, []);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("foobar", ctx);

    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg.toLowerCase()).toContain("unknown");
  });

  it("opens the Providers overlay for an empty argument string", async () => {
    const registry = mem();
    const command = testToolsCommand(registry, new Map());
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
    const command = testToolsCommand(mem(), new Map(), [], reload);
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
    const command = testToolsCommand(mem(), new Map());
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
    const command = testToolsCommand(registry, new Map(), ["brave"]);
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
    const command = testToolsCommand(registry, tierMap, ["brave"], onReload);
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

describe("tools provider dashboard actions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
  });

  it("loads scope-effective config for Global and Project dashboards", async () => {
    const deps = commandDeps();
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const captures: DashboardOptions[] = [];
    dashboardActions(
      ctx,
      [
        { type: "switch-scope", activeTab: "providers", selectedProvider: "brave" },
        { type: "close" },
      ],
      captures,
    );
    const registry = mem();
    const command = createToolsCommand(
      registry,
      new Map([["brave", 1]]),
      ["brave", "duckduckgo"],
      deps,
    );

    await command.handler("", ctx);

    expect(captures[0].registry).toBe(registry);
    expect(deps.getConfig.mock.calls.map(([scope]) => scope)).toEqual(["global", "project"]);
    expect(captures[0].config).toBe(globalProviderState);
    expect(captures[0].scope.kind).toBe("global");
    expect(captures[1].config).toBe(projectProviderState);
    expect(captures[1].scope.kind).toBe("project");
  });

  it("toggles the value displayed in Global scope, not the Project override", async () => {
    const deps = commandDeps();
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    dashboardActions(ctx, [
      { type: "toggle", provider: "brave", activeTab: "providers", selectedProvider: "brave" },
      { type: "close" },
    ]);
    const command = createToolsCommand(mem(), new Map(), ["brave", "duckduckgo"], deps);

    await command.handler("", ctx);

    const written = JSON.parse(String(vi.mocked(fs.writeFileSync).mock.calls[0][1]));
    expect(written.providers.brave.enabled).toBe(false);
    expect(deps.reload).toHaveBeenCalledOnce();
    expect(vi.mocked(ctx.ui.custom)).toHaveBeenCalledTimes(2);
  });

  it.each(["duckduckgo", "auto"])("sets default provider %s and reloads", async (provider) => {
    const deps = commandDeps();
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    dashboardActions(ctx, [
      { type: "set-default", provider, activeTab: "providers", selectedProvider: "brave" },
      { type: "close" },
    ]);
    const command = createToolsCommand(mem(), new Map(), ["brave", "duckduckgo"], deps);

    await command.handler("", ctx);

    const written = JSON.parse(String(vi.mocked(fs.writeFileSync).mock.calls[0][1]));
    expect(written.defaultProvider).toBe(provider);
    expect(deps.reload).toHaveBeenCalledOnce();
  });

  it("trims a prompted key, writes it, and reloads without exposing it", async () => {
    const deps = commandDeps();
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    vi.mocked(ctx.ui.input).mockResolvedValue("  NEW_BRAVE_API_KEY  ");
    dashboardActions(ctx, [
      { type: "set-key", provider: "brave", activeTab: "providers", selectedProvider: "brave" },
      { type: "close" },
    ]);
    const command = createToolsCommand(mem(), new Map(), ["brave"], deps);

    await command.handler("", ctx);

    const written = JSON.parse(String(vi.mocked(fs.writeFileSync).mock.calls[0][1]));
    expect(written.providers.brave.apiKey).toBe("NEW_BRAVE_API_KEY");
    expect(deps.reload).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(ctx.ui.notify).mock.calls)).not.toContain("NEW_BRAVE_API_KEY");
  });

  it.each([undefined, "", "   "])(
    "cancels key input %j before filesystem access",
    async (value) => {
      const deps = commandDeps();
      const ctx = makeCtx() as unknown as ExtensionCommandContext;
      vi.mocked(ctx.ui.input).mockResolvedValue(value);
      dashboardActions(ctx, [
        { type: "set-key", provider: "brave", activeTab: "providers", selectedProvider: "brave" },
        { type: "close" },
      ]);
      const command = createToolsCommand(mem(), new Map(), ["brave"], deps);

      await command.handler("", ctx);

      expect(fs.readFileSync).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(deps.reload).not.toHaveBeenCalled();
    },
  );

  it("warns and does not write a literal key in Project scope", async () => {
    const deps = commandDeps();
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    vi.mocked(ctx.ui.input).mockResolvedValue("literal-secret");
    dashboardActions(ctx, [
      { type: "switch-scope", activeTab: "providers", selectedProvider: "brave" },
      { type: "set-key", provider: "brave", activeTab: "providers", selectedProvider: "brave" },
      { type: "close" },
    ]);
    const command = createToolsCommand(mem(), new Map(), ["brave"], deps);

    await command.handler("", ctx);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(deps.reload).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringMatching(/environment-variable/i),
      "warning",
    );
  });

  it("warns and preserves malformed config", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue("{ malformed");
    const deps = commandDeps();
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    dashboardActions(ctx, [
      { type: "toggle", provider: "brave", activeTab: "providers", selectedProvider: "brave" },
      { type: "close" },
    ]);
    const command = createToolsCommand(mem(), new Map(), ["brave"], deps);

    await command.handler("", ctx);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(deps.reload).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.any(String), "warning");
  });

  it.each([
    {
      existing: path.join("/repo", CONFIG_DIR_NAME, "tools.json"),
      expected: path.join("/repo", CONFIG_DIR_NAME, "tools.json"),
    },
    {
      existing: undefined,
      expected: path.join("/repo/packages/app", CONFIG_DIR_NAME, "tools.json"),
    },
  ])("uses the Project target path %#", async ({ existing, expected }) => {
    vi.mocked(fs.existsSync).mockImplementation((candidate) => candidate === existing);
    const deps = commandDeps();
    const ctx = makeCtx({ cwd: "/repo/packages/app" }) as unknown as ExtensionCommandContext;
    const captures: DashboardOptions[] = [];
    dashboardActions(
      ctx,
      [
        { type: "switch-scope", activeTab: "providers", selectedProvider: "brave" },
        { type: "close" },
      ],
      captures,
    );
    const command = createToolsCommand(mem(), new Map(), ["brave"], deps);

    await command.handler("", ctx);

    expect(captures[1].scope).toEqual({ kind: "project", path: expected, canWrite: true });
    expect(captures[1].config).toBe(projectProviderState);
  });

  it("preserves tab and provider resume state when reopening", async () => {
    const deps = commandDeps();
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const captures: DashboardOptions[] = [];
    dashboardActions(
      ctx,
      [
        {
          type: "reload",
          activeTab: "activity",
          selectedProvider: "duckduckgo",
        },
        { type: "close" },
      ],
      captures,
    );
    const command = createToolsCommand(mem(), new Map(), ["brave", "duckduckgo"], deps);

    await command.handler("", ctx);

    expect(captures[1].initialTab).toBe("activity");
    expect(captures[1].initialProvider).toBe("duckduckgo");
    expect(deps.reload).toHaveBeenCalledOnce();
  });

  it("shows an existing untrusted Project config as read-only and rejects forged writes", async () => {
    const existing = path.join("/repo", CONFIG_DIR_NAME, "tools.json");
    vi.mocked(fs.existsSync).mockImplementation((candidate) => candidate === existing);
    const deps = commandDeps();
    const ctx = makeCtx({
      cwd: "/repo",
      isProjectTrusted: () => false,
    }) as unknown as ExtensionCommandContext;
    const captures: DashboardOptions[] = [];
    dashboardActions(
      ctx,
      [
        { type: "switch-scope", activeTab: "providers", selectedProvider: "brave" },
        { type: "toggle", provider: "brave", activeTab: "providers", selectedProvider: "brave" },
        { type: "close" },
      ],
      captures,
    );
    const command = createToolsCommand(mem(), new Map(), ["brave"], deps);

    await command.handler("", ctx);

    expect(captures[1].scope).toEqual({ kind: "project", path: existing, canWrite: false });
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(deps.reload).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringMatching(/trusted/i), "warning");
  });

  it("keeps untrusted projects without config in Global scope", async () => {
    const deps = commandDeps();
    const ctx = makeCtx({
      cwd: "/repo",
      isProjectTrusted: () => false,
    }) as unknown as ExtensionCommandContext;
    const captures: DashboardOptions[] = [];
    dashboardActions(
      ctx,
      [
        { type: "switch-scope", activeTab: "providers", selectedProvider: "brave" },
        { type: "close" },
      ],
      captures,
    );
    const command = createToolsCommand(mem(), new Map(), ["brave"], deps);

    await command.handler("", ctx);

    expect(captures[1].scope.kind).toBe("global");
    expect(deps.getConfig).toHaveBeenNthCalledWith(2, "global");
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringMatching(/trust|existing/i), "warning");
  });
});
