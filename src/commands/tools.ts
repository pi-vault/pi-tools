import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { ProviderTier } from "../providers/types.ts";
import {
  parseArgs,
  handleEnable,
  handleDisable,
  handleKey,
  handleDefault,
  handleTest,
} from "./tools-subcommands.ts";
import { handleEnhancedSetup } from "./tools-setup.ts";
import { activityMonitor } from "../monitor/activity-monitor.ts";
import { renderWidgetLines } from "../monitor/widget.ts";

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "unlimited";
  return n.toLocaleString("en-US");
}

export function buildStatusTable(
  registry: ProviderRegistry,
  tierMap: ReadonlyMap<string, ProviderTier>,
): string {
  const names = registry.getSearchProviderNames();
  if (names.length === 0) return "No providers registered.";

  const rows: Array<{
    name: string;
    tier: string;
    remaining: string;
    session: string;
    latency: string;
  }> = [];

  for (const name of names) {
    const tier = tierMap.get(name) ?? 3;
    const remaining = registry.getRemaining(name);
    const metrics = registry.getMetrics(name);

    const successes = metrics?.successes ?? 0;
    const failures = metrics?.failures ?? 0;
    const sessionStr = `${successes}/${failures}`;

    let latencyStr = "--";
    if (metrics && metrics.latencySamples > 0) {
      const avgMs = Math.round(metrics.avgLatency);
      latencyStr = `${avgMs}ms`;
    }

    rows.push({
      name,
      tier: String(tier),
      remaining: formatNumber(remaining),
      session: sessionStr,
      latency: latencyStr,
    });
  }

  const headers = {
    name: "Provider",
    tier: "Tier",
    remaining: "Remaining",
    session: "Session (ok/fail)",
    latency: "Avg Latency",
  };

  const colWidths = {
    name: Math.max(headers.name.length, ...rows.map((r) => r.name.length)),
    tier: Math.max(headers.tier.length, ...rows.map((r) => r.tier.length)),
    remaining: Math.max(headers.remaining.length, ...rows.map((r) => r.remaining.length)),
    session: Math.max(headers.session.length, ...rows.map((r) => r.session.length)),
    latency: Math.max(headers.latency.length, ...rows.map((r) => r.latency.length)),
  };

  const sep = "  ";
  const headerLine = [
    headers.name.padEnd(colWidths.name),
    headers.tier.padEnd(colWidths.tier),
    headers.remaining.padStart(colWidths.remaining),
    headers.session.padStart(colWidths.session),
    headers.latency.padStart(colWidths.latency),
  ].join(sep);

  const divider = "-".repeat(headerLine.length);

  const dataLines = rows.map((r) =>
    [
      r.name.padEnd(colWidths.name),
      r.tier.padEnd(colWidths.tier),
      r.remaining.padStart(colWidths.remaining),
      r.session.padStart(colWidths.session),
      r.latency.padStart(colWidths.latency),
    ].join(sep),
  );

  return [headerLine, divider, ...dataLines].join("\n");
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
          handleEnable(ctx, rest[0] ?? "", providers);
          onReload?.();
          break;

        case "disable":
          handleDisable(ctx, rest[0] ?? "", providers);
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
          ctx.ui.notify(
            `Unknown subcommand "${subcommand}".\n\n${USAGE}`,
          );
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
