import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getConfigPath } from "../config.ts";
import type { ProviderRegistry } from "../providers/registry.ts";

export function parseArgs(argsStr: string): {
  subcommand: string;
  rest: string[];
} {
  const parts = argsStr.trim().split(/\s+/).filter(Boolean);
  return { subcommand: parts[0] ?? "", rest: parts.slice(1) };
}

export function maskKey(key: string): string {
  if (key.length < 8) return key;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export function updateConfig(
  updater: (
    config: Record<string, unknown>,
  ) => Record<string, unknown>,
): string {
  const configPath = getConfigPath();
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    // No existing config — start fresh
  }
  const updated = updater(existing);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));
  return configPath;
}

export function handleToggle(
  ctx: ExtensionCommandContext,
  name: string,
  enabled: boolean,
  allProviderNames: string[],
): void {
  if (!allProviderNames.includes(name)) {
    ctx.ui.notify(`Unknown provider "${name}". Available: ${allProviderNames.join(", ")}`);
    return;
  }
  const configPath = updateConfig((config) => {
    const providers = (config.providers ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    providers[name] = { ...providers[name], enabled };
    return { ...config, providers };
  });
  ctx.ui.notify(`${enabled ? "Enabled" : "Disabled"} ${name}. Config saved to ${configPath}`);
}

export function handleKey(
  ctx: ExtensionCommandContext,
  name: string,
  value: string | undefined,
  allProviderNames: string[],
): void {
  if (!value) {
    ctx.ui.notify("Usage: /tools key <provider> <api-key>");
    return;
  }
  if (!allProviderNames.includes(name)) {
    ctx.ui.notify(`Unknown provider "${name}". Available: ${allProviderNames.join(", ")}`);
    return;
  }
  updateConfig((config) => {
    const providers = (config.providers ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    providers[name] = { ...providers[name], apiKey: value };
    return { ...config, providers };
  });
  ctx.ui.notify(`API key for ${name} set to ${maskKey(value)}`);
}

export function handleDefault(
  ctx: ExtensionCommandContext,
  name: string,
  allProviderNames: string[],
): void {
  if (name !== "auto" && !allProviderNames.includes(name)) {
    ctx.ui.notify(`Unknown provider "${name}". Use "auto" or one of: ${allProviderNames.join(", ")}`);
    return;
  }
  updateConfig((config) => ({
    ...config,
    defaultProvider: name,
  }));
  ctx.ui.notify(`Default provider set to "${name}"`);
}

export async function handleTest(
  ctx: ExtensionCommandContext,
  name: string | undefined,
  registry: ProviderRegistry,
): Promise<void> {
  const providerNames = name ? [name] : registry.getSearchProviderNames();

  if (providerNames.length === 0) {
    ctx.ui.notify("No providers to test.");
    return;
  }

  const results: string[] = [];

  for (const providerName of providerNames) {
    const candidates = registry.selectSearchCandidates(providerName);
    if (candidates.length === 0) {
      results.push(`${providerName}: not found or not enabled`);
      continue;
    }

    const provider = candidates[0];
    const startMs = Date.now();
    try {
      const searchResults = await provider.search("test", 1);
      const elapsed = Date.now() - startMs;
      results.push(
        `${providerName}: OK (${elapsed}ms, ${searchResults.length} result${searchResults.length !== 1 ? "s" : ""})`,
      );
    } catch (err) {
      const elapsed = Date.now() - startMs;
      const msg = err instanceof Error ? err.message : String(err);
      results.push(`${providerName}: FAIL (${elapsed}ms) — ${msg}`);
    }
  }

  ctx.ui.notify(results.join("\n"));
}
