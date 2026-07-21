import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { PiToolsConfig } from "../config.ts";
import { findProjectConfigPath, getConfigPath } from "../config.ts";
import { activityMonitor } from "../monitor/activity-monitor.ts";
import { renderWidgetLines } from "../monitor/widget.ts";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { ProviderTier } from "../providers/types.ts";
import { fromPiTheme } from "../tui/dashboard-theme.ts";
import {
  type ConfigScope,
  findWritableProjectPath,
  setDefaultProvider,
  setProviderEnabled,
  setProviderKey,
} from "./tools-actions.ts";
import {
  type DashboardAction,
  type DashboardResumeState,
  type DashboardScope,
  ToolsDashboardComponent,
} from "./tools-dashboard.ts";
import {
  parseArgs,
  handleToggle,
  handleKey,
  handleDefault,
  handleTest,
} from "./tools-subcommands.ts";

export interface ToolsCommandDeps {
  getConfig: (scope: ConfigScope) => Pick<PiToolsConfig, "providers" | "defaultProvider">;
  reload: () => void;
}

function formatAmount(value: number, unit: string): string {
  return unit === "usd" ? value.toFixed(6) : value.toLocaleString("en-US");
}

export function buildStatusTable(
  registry: ProviderRegistry,
  tierMap: ReadonlyMap<string, ProviderTier>,
): string {
  const names = registry.getProviderNames();
  if (names.length === 0) return "No providers registered.";

  const rows: string[][] = [];

  for (const name of names) {
    const tier = tierMap.get(name) ?? 3;
    const budget = registry.getBudgetStatus(name);
    const metrics = registry.getMetrics(name);
    let used = "--";
    let limit = "--";
    let unit = "--";
    let period = "--";
    if (budget?.mode === "hard") {
      used = formatAmount(budget.used, budget.unit);
      limit = formatAmount(budget.limit, budget.unit);
      unit = budget.unit;
      period = budget.pool ? `${budget.period} (pool: ${budget.pool})` : budget.period;
    } else if (budget) {
      used = budget.mode;
    }

    const successes = metrics?.successes ?? 0;
    const failures = metrics?.failures ?? 0;
    const sessionStr = `${successes}/${failures}`;

    let latencyStr = "--";
    if (metrics && metrics.latencySamples > 0) {
      const avgMs = Math.round(metrics.avgLatency);
      latencyStr = `${avgMs}ms`;
    }

    rows.push([name, String(tier), used, limit, unit, period, sessionStr, latencyStr]);
  }

  const headers = [
    "Provider",
    "Tier",
    "Used",
    "Limit",
    "Unit",
    "Period",
    "Session (ok/fail)",
    "Avg Latency",
  ];
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column].length)),
  );
  const rightAligned = new Set([2, 3, 6, 7]);
  const render = (row: string[]) =>
    row
      .map((cell, column) =>
        rightAligned.has(column) ? cell.padStart(widths[column]) : cell.padEnd(widths[column]),
      )
      .join("  ");
  const header = render(headers);
  return [header, "-".repeat(header.length), ...rows.map(render)].join("\n");
}

const USAGE = `Usage: /tools [subcommand]

Subcommands:
  (no args)          Open the Providers dashboard
  status             Show provider status table
  reload             Refresh config from disk
  enable <name>      Enable a provider
  disable <name>     Disable a provider
  key <name> <value> Set API key for a provider
  test [name]        Test provider connection
  default <name>     Set default provider
  monitor [on|off]   Toggle activity monitor widget`;

async function applyDashboardAction(
  action: DashboardAction,
  ctx: ExtensionCommandContext,
  scope: DashboardScope,
  config: Pick<PiToolsConfig, "providers" | "defaultProvider">,
  allProviderNames: string[],
  deps: ToolsCommandDeps,
): Promise<void> {
  try {
    const options = {
      scope: scope.kind,
      cwd: ctx.cwd,
      trusted: ctx.isProjectTrusted(),
    } as const;
    if (action.type === "reload") {
      deps.reload();
      return;
    }
    if (action.type === "toggle") {
      setProviderEnabled(options, action.provider, !config.providers[action.provider].enabled);
      deps.reload();
      ctx.ui.notify(`Updated ${action.provider} in ${scope.kind} config`);
      return;
    }
    if (action.type === "set-key") {
      const value = (await ctx.ui.input(`API key for ${action.provider}`))?.trim();
      if (!value) return;
      setProviderKey(options, action.provider, value);
      deps.reload();
      ctx.ui.notify(`Updated ${action.provider} credential in ${scope.kind} config`);
      return;
    }
    if (action.type === "set-default") {
      setDefaultProvider(options, action.provider, new Set(allProviderNames));
      deps.reload();
      ctx.ui.notify(`Updated default provider in ${scope.kind} config`);
    }
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
  }
}

export function createToolsCommand(
  registry: ProviderRegistry,
  tierMap: ReadonlyMap<string, ProviderTier>,
  allProviderNames: string[],
  deps: ToolsCommandDeps,
) {
  let widgetUnsubscribe: (() => void) | undefined;
  let widgetContext: ExtensionCommandContext | undefined;

  const isWidgetEnabled = (): boolean => widgetUnsubscribe !== undefined;

  const clearWidget = (): void => {
    const unsubscribe = widgetUnsubscribe;
    const context = widgetContext;
    widgetUnsubscribe = undefined;
    widgetContext = undefined;
    unsubscribe?.();
    context?.ui.setWidget("pi-tools-activity", undefined);
  };

  const setWidget = (ctx: ExtensionCommandContext, enabled: boolean): void => {
    if (!enabled) {
      clearWidget();
      return;
    }
    if (widgetUnsubscribe) return;

    const repaint = () => {
      ctx.ui.setWidget(
        "pi-tools-activity",
        renderWidgetLines(activityMonitor.getEntries(), ctx.ui.theme),
      );
    };
    widgetContext = ctx;
    widgetUnsubscribe = activityMonitor.onUpdate(repaint);
    repaint();
  };

  return {
    name: "tools",
    description:
      "Manage search/fetch providers. Run with no args for the Providers dashboard, or use subcommands (status, enable, disable, key, test, default, reload, monitor).",

    async handler(args: string, ctx: ExtensionCommandContext) {
      if (args.trim() === "") {
        if (ctx.mode !== "tui") {
          ctx.ui.notify("/tools requires an interactive TUI", "warning");
          return;
        }
        let selectedScope: ConfigScope = "global";
        let resumeState: DashboardResumeState = { activeTab: "providers" };
        while (true) {
          const scope: DashboardScope =
            selectedScope === "global"
              ? { kind: "global", path: getConfigPath(), canWrite: true }
              : {
                  kind: "project",
                  path: findWritableProjectPath(ctx.cwd),
                  canWrite: ctx.isProjectTrusted(),
                };
          const config = deps.getConfig(selectedScope);
          const action = await ctx.ui.custom<DashboardAction>(
            (tui, theme, _keybindings, done) =>
              new ToolsDashboardComponent({
                tui,
                theme: fromPiTheme(theme),
                registry,
                providerNames: allProviderNames,
                tierMap,
                config,
                scope,
                renderStatusTable: () => buildStatusTable(registry, tierMap),
                getActivity: () => activityMonitor.getEntries(),
                subscribeActivity: (listener) => activityMonitor.onUpdate(listener),
                widgetEnabled: isWidgetEnabled(),
                initialTab: resumeState.activeTab,
                initialProvider: resumeState.selectedProvider,
                done,
              }),
            {
              overlay: true,
              overlayOptions: { anchor: "center", maxHeight: "85%", width: "92%" },
            },
          );
          if (!action || action.type === "close") return;
          resumeState = {
            activeTab: action.activeTab,
            selectedProvider: action.selectedProvider,
          };
          if (action.type === "switch-scope") {
            if (selectedScope === "project") {
              selectedScope = "global";
            } else if (ctx.isProjectTrusted() || findProjectConfigPath(ctx.cwd)) {
              selectedScope = "project";
            } else {
              ctx.ui.notify(
                "Project scope requires trust or an existing project config",
                "warning",
              );
            }
            continue;
          }
          if (action.type === "toggle-widget") {
            setWidget(ctx, !isWidgetEnabled());
            continue;
          }
          await applyDashboardAction(action, ctx, scope, config, allProviderNames, deps);
        }
      }

      const { subcommand, rest } = parseArgs(args);

      // Legacy flag support
      if (subcommand === "--status") {
        ctx.ui.notify(buildStatusTable(registry, tierMap));
        return;
      }
      if (subcommand === "--reload") {
        deps.reload();
        ctx.ui.notify(buildStatusTable(registry, tierMap));
        return;
      }

      switch (subcommand) {
        case "status":
          ctx.ui.notify(buildStatusTable(registry, tierMap));
          break;

        case "reload":
          deps.reload();
          ctx.ui.notify(buildStatusTable(registry, tierMap));
          break;

        case "enable":
          handleToggle(ctx, rest[0] ?? "", true, allProviderNames);
          deps.reload();
          break;

        case "disable":
          handleToggle(ctx, rest[0] ?? "", false, allProviderNames);
          deps.reload();
          break;

        case "key":
          handleKey(ctx, rest[0] ?? "", rest[1], allProviderNames);
          deps.reload();
          break;

        case "test":
          await handleTest(ctx, rest[0], registry);
          break;

        case "default":
          handleDefault(ctx, rest[0] ?? "", allProviderNames);
          deps.reload();
          break;

        case "monitor": {
          const action = rest[0];
          if (action === "on") {
            setWidget(ctx, true);
            ctx.ui.notify("Activity monitor enabled");
          } else if (action === "off") {
            setWidget(ctx, false);
            ctx.ui.notify("Activity monitor disabled");
          } else {
            ctx.ui.notify("Usage: /tools monitor [on|off]");
          }
          break;
        }

        default:
          ctx.ui.notify(`Unknown subcommand "${subcommand}".\n\n${USAGE}`);
      }
    },

    /** Called during session lifecycle to clean up monitor state. */
    resetMonitor(): void {
      clearWidget();
      activityMonitor.clear();
    },
  };
}
