import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { ProviderTier } from "../providers/types.ts";
import {
  parseArgs,
  handleToggle,
  handleKey,
  handleDefault,
  handleTest,
} from "./tools-subcommands.ts";
import { handleEnhancedSetup } from "./tools-setup.ts";
import { activityMonitor } from "../monitor/activity-monitor.ts";
import { renderWidgetLines } from "../monitor/widget.ts";

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
  (no args)          Interactive setup wizard
  status             Show provider status table
  reload             Refresh config from disk
  enable <name>      Enable a provider
  disable <name>     Disable a provider
  key <name> <value> Set API key for a provider
  test [name]        Test provider connection
  default <name>     Set default provider
  monitor [on|off]   Toggle activity monitor widget`;

export function createToolsCommand(
  registry: ProviderRegistry,
  tierMap: ReadonlyMap<string, ProviderTier>,
  allProviderNames?: string[],
  onReload?: () => void,
) {
  let monitorUnsubscribe: (() => void) | null = null;

  return {
    name: "tools",
    description:
      "Manage search/fetch providers. Run with no args for setup wizard, or use subcommands (status, enable, disable, key, test, default, reload, monitor).",

    async handler(args: string, ctx: ExtensionCommandContext) {
      const providers = allProviderNames ?? [];
      const { subcommand, rest } = parseArgs(args);

      // Legacy flag support
      if (subcommand === "--status") {
        ctx.ui.notify(buildStatusTable(registry, tierMap));
        return;
      }
      if (subcommand === "--reload") {
        onReload?.();
        ctx.ui.notify(buildStatusTable(registry, tierMap));
        return;
      }

      switch (subcommand) {
        case "":
          await handleEnhancedSetup(ctx, providers, tierMap);
          break;

        case "status":
          ctx.ui.notify(buildStatusTable(registry, tierMap));
          break;

        case "reload":
          onReload?.();
          ctx.ui.notify(buildStatusTable(registry, tierMap));
          break;

        case "enable":
          handleToggle(ctx, rest[0] ?? "", true, providers);
          onReload?.();
          break;

        case "disable":
          handleToggle(ctx, rest[0] ?? "", false, providers);
          onReload?.();
          break;

        case "key":
          handleKey(ctx, rest[0] ?? "", rest[1], providers);
          onReload?.();
          break;

        case "test":
          await handleTest(ctx, rest[0], registry);
          break;

        case "default":
          handleDefault(ctx, rest[0] ?? "", providers);
          onReload?.();
          break;

        case "monitor": {
          const action = rest[0];
          if (action === "on") {
            monitorUnsubscribe?.();
            // Subscribe: re-render widget on every activity update
            monitorUnsubscribe = activityMonitor.onUpdate(() => {
              const lines = renderWidgetLines(activityMonitor.getEntries(), ctx.ui.theme);
              ctx.ui.setWidget("pi-tools-activity", lines);
            });
            // Initial render
            const lines = renderWidgetLines(activityMonitor.getEntries(), ctx.ui.theme);
            ctx.ui.setWidget("pi-tools-activity", lines);
            ctx.ui.notify("Activity monitor enabled");
          } else if (action === "off") {
            monitorUnsubscribe?.();
            monitorUnsubscribe = null;
            ctx.ui.setWidget("pi-tools-activity", undefined);
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
      monitorUnsubscribe?.();
      monitorUnsubscribe = null;
      activityMonitor.clear();
    },
  };
}
