import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { ProviderTier } from "../providers/types.ts";
import { getConfigPath } from "../config.ts";

export interface ToolsCommand {
  name: string;
  description: string;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "unlimited";
  return n.toLocaleString("en-US");
}

function padRight(str: string, len: number): string {
  return str + " ".repeat(Math.max(0, len - str.length));
}

function padLeft(str: string, len: number): string {
  return " ".repeat(Math.max(0, len - str.length)) + str;
}

function buildStatusTable(
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
    if (metrics && metrics.successes > 0) {
      const avgMs = Math.round(metrics.totalLatencyMs / metrics.successes);
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
    padRight(headers.name, colWidths.name),
    padRight(headers.tier, colWidths.tier),
    padLeft(headers.remaining, colWidths.remaining),
    padLeft(headers.session, colWidths.session),
    padLeft(headers.latency, colWidths.latency),
  ].join(sep);

  const divider = "-".repeat(headerLine.length);

  const dataLines = rows.map((r) =>
    [
      padRight(r.name, colWidths.name),
      padRight(r.tier, colWidths.tier),
      padLeft(r.remaining, colWidths.remaining),
      padLeft(r.session, colWidths.session),
      padLeft(r.latency, colWidths.latency),
    ].join(sep),
  );

  return [headerLine, divider, ...dataLines].join("\n");
}

async function handleInteractiveSetup(
  ctx: ExtensionCommandContext,
  allProviderNames: string[],
): Promise<void> {
  if (allProviderNames.length === 0) {
    ctx.ui.notify("No providers available for configuration.");
    return;
  }

  // Step 1: Ask about each provider
  const providers: Record<string, { enabled: boolean; apiKey?: string }> = {};
  const enabledNames: string[] = [];

  for (const name of allProviderNames) {
    const enabled = await ctx.ui.confirm("Provider setup", `Enable ${name}?`);
    providers[name] = { enabled };

    if (enabled) {
      enabledNames.push(name);
      const apiKey = await ctx.ui.input(`API key for ${name}`, "Leave empty to skip");
      if (apiKey && apiKey.trim().length > 0) {
        providers[name].apiKey = apiKey.trim();
      }
    }
  }

  // Step 2: Select default provider
  const defaultOptions = ["auto", ...enabledNames];
  const defaultProvider = (await ctx.ui.select("Default provider:", defaultOptions)) ?? "auto";

  // Step 3: Build and write config
  const config = {
    defaultProvider,
    providers,
  };

  const configPath = getConfigPath();
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    ctx.ui.notify(`Configuration saved to ${configPath}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Failed to save configuration: ${msg}`);
  }
}

export function createToolsCommand(
  registry: ProviderRegistry,
  tierMap: ReadonlyMap<string, ProviderTier>,
  allProviderNames?: string[],
): ToolsCommand {
  return {
    name: "tools",
    description: "Manage search/fetch providers. Use --status to see provider status.",
    async handler(args, ctx) {
      if (args.includes("--status")) {
        const table = buildStatusTable(registry, tierMap);
        ctx.ui.notify(table);
        return;
      }

      await handleInteractiveSetup(ctx, allProviderNames ?? []);
    },
  };
}
