import * as fs from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getConfigPath, FALLBACK_ENV_MAP } from "../config.ts";
import { updateConfig, maskKey } from "./tools-subcommands.ts";
import type { ProviderTier } from "../providers/types.ts";

export function buildDiagnosticPreamble(
  allProviderNames: string[],
  tierMap: ReadonlyMap<string, ProviderTier>,
): string {
  const lines: string[] = [];
  lines.push("=== Pi Tools Setup ===\n");

  // Environment keys
  const envKeys = Object.entries(FALLBACK_ENV_MAP);
  const detected: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const [, envVar] of envKeys) {
    if (seen.has(envVar)) continue;
    seen.add(envVar);
    if (process.env[envVar]) {
      detected.push(`  ${envVar}: detected`);
    } else {
      missing.push(`  ${envVar}: not set`);
    }
  }

  if (detected.length > 0) {
    lines.push("Environment keys:");
    lines.push(...detected);
    if (missing.length > 0) lines.push(`  ... and ${missing.length} not set`);
    lines.push("");
  }

  // Config file status
  const configPath = getConfigPath();
  const configExists = fs.existsSync(configPath);
  lines.push(`Config file: ${configExists ? configPath : "not created yet"}`);

  // Provider summary
  const tier1 = allProviderNames.filter((n) => tierMap.get(n) === 1);
  const tier2 = allProviderNames.filter((n) => tierMap.get(n) === 2);
  const tier3 = allProviderNames.filter(
    (n) => tierMap.get(n) === 3 || !tierMap.has(n),
  );
  lines.push(
    `Providers: ${tier1.length} tier-1, ${tier2.length} tier-2, ${tier3.length} tier-3 (${allProviderNames.length} total)`,
  );

  return lines.join("\n");
}

async function runQuickSetup(
  ctx: ExtensionCommandContext,
  allProviderNames: string[],
  tierMap: ReadonlyMap<string, ProviderTier>,
): Promise<void> {
  const tier1Providers = allProviderNames.filter((n) => tierMap.get(n) === 1);
  if (tier1Providers.length === 0) {
    ctx.ui.notify("No tier-1 providers found for quick setup.");
    return;
  }

  const providers: Record<string, { enabled: boolean; apiKey?: string }> = {};
  const enabledNames: string[] = [];

  for (const name of tier1Providers) {
    const envVar = FALLBACK_ENV_MAP[name];
    const hasEnvKey = envVar ? !!process.env[envVar] : false;
    const keyHint = hasEnvKey ? ` (${envVar} detected)` : "";

    const apiKey = await ctx.ui.input(
      `API key for ${name}${keyHint}`,
      hasEnvKey ? "Press Enter to use env var" : "Paste key or leave empty to skip",
    );

    if (apiKey && apiKey.trim().length > 0) {
      providers[name] = { enabled: true, apiKey: apiKey.trim() };
      enabledNames.push(name);
      ctx.ui.notify(`${name}: key set to ${maskKey(apiKey.trim())}`);
    } else if (hasEnvKey) {
      providers[name] = { enabled: true };
      enabledNames.push(name);
    } else {
      providers[name] = { enabled: false };
    }
  }

  // Default provider selection
  const defaultOptions = ["auto", ...enabledNames];
  const defaultProvider =
    (await ctx.ui.select("Default provider:", defaultOptions)) ?? "auto";

  updateConfig((config) => {
    const existingProviders = (config.providers ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    for (const [name, entry] of Object.entries(providers)) {
      existingProviders[name] = { ...existingProviders[name], ...entry };
    }
    return { ...config, defaultProvider, providers: existingProviders };
  });

  ctx.ui.notify(
    `Quick setup complete! ${enabledNames.length} provider${enabledNames.length !== 1 ? "s" : ""} configured.`,
  );
}

async function runFullSetup(
  ctx: ExtensionCommandContext,
  allProviderNames: string[],
): Promise<void> {
  const providers: Record<string, { enabled: boolean; apiKey?: string }> = {};
  const enabledNames: string[] = [];

  for (const name of allProviderNames) {
    const enabled = await ctx.ui.confirm("Provider setup", `Enable ${name}?`);
    providers[name] = { enabled };

    if (enabled) {
      enabledNames.push(name);
      const apiKey = await ctx.ui.input(
        `API key for ${name}`,
        "Leave empty to skip",
      );
      if (apiKey && apiKey.trim().length > 0) {
        providers[name].apiKey = apiKey.trim();
      }
    }
  }

  const defaultOptions = ["auto", ...enabledNames];
  const defaultProvider =
    (await ctx.ui.select("Default provider:", defaultOptions)) ?? "auto";

  updateConfig((config) => {
    const existingProviders = (config.providers ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    for (const [name, entry] of Object.entries(providers)) {
      existingProviders[name] = { ...existingProviders[name], ...entry };
    }
    return { ...config, defaultProvider, providers: existingProviders };
  });

  ctx.ui.notify(
    `Setup complete! ${enabledNames.length} provider${enabledNames.length !== 1 ? "s" : ""} enabled.`,
  );
}

export async function handleEnhancedSetup(
  ctx: ExtensionCommandContext,
  allProviderNames: string[],
  tierMap: ReadonlyMap<string, ProviderTier>,
): Promise<void> {
  if (allProviderNames.length === 0) {
    ctx.ui.notify("No providers available for configuration.");
    return;
  }

  // Show diagnostic preamble
  const preamble = buildDiagnosticPreamble(allProviderNames, tierMap);
  ctx.ui.notify(preamble);

  // Offer setup mode
  const mode = await ctx.ui.select("Setup mode:", [
    "quick",
    "full",
    "status",
  ]);

  if (!mode) return; // User cancelled

  if (mode === "status") {
    ctx.ui.notify("Use /tools status for the provider status table.");
    return;
  }

  if (mode === "quick") {
    await runQuickSetup(ctx, allProviderNames, tierMap);
    return;
  }

  if (mode === "full") {
    await runFullSetup(ctx, allProviderNames);
  }
}
