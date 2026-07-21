import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { findProjectConfigPath, getConfigPath } from "../config.ts";

export type ConfigScope = "global" | "project";

export interface ScopeOptions {
  scope: ConfigScope;
  cwd: string;
  trusted: boolean;
}

export type CredentialClass = "env" | "literal" | "shell";

const ENV_NAME = /^[A-Z][A-Z0-9_]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readDocument(filePath: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!isRecord(parsed)) throw new Error("Tools config root must be a JSON object");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function targetPath(options: ScopeOptions): string {
  if (options.scope === "global") return getConfigPath();
  if (!options.trusted) throw new Error("Project config writes require a trusted project");
  return findWritableProjectPath(options.cwd);
}

function providerObjects(
  document: Record<string, unknown>,
  provider: string,
): {
  providers: Record<string, unknown>;
  entry: Record<string, unknown>;
} {
  const rawProviders = document.providers;
  if (rawProviders !== undefined && !isRecord(rawProviders)) {
    throw new Error("Tools config providers must be a JSON object");
  }
  const providers = rawProviders ?? {};
  const rawEntry = providers[provider];
  if (rawEntry !== undefined && !isRecord(rawEntry)) {
    throw new Error(`Tools config provider ${provider} must be a JSON object`);
  }
  return { providers, entry: rawEntry ?? {} };
}

export function classifyCredential(value: string): CredentialClass {
  return value.startsWith("!") ? "shell" : ENV_NAME.test(value) ? "env" : "literal";
}

export function findWritableProjectPath(cwd: string): string {
  return findProjectConfigPath(cwd) ?? path.join(cwd, CONFIG_DIR_NAME, "tools.json");
}

export function updateScopedConfig(
  options: ScopeOptions,
  updater: (document: Record<string, unknown>) => Record<string, unknown>,
): string {
  const filePath = targetPath(options);
  const updated = updater(readDocument(filePath));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(updated, null, 2)}\n`);
  return filePath;
}

export function setProviderEnabled(
  options: ScopeOptions,
  provider: string,
  enabled: boolean,
): string {
  return updateScopedConfig(options, (document) => {
    const { providers, entry } = providerObjects(document, provider);
    return {
      ...document,
      providers: { ...providers, [provider]: { ...entry, enabled } },
    };
  });
}

export function setProviderKey(options: ScopeOptions, provider: string, value: string): string {
  if (options.scope === "project" && classifyCredential(value) !== "env") {
    throw new Error("Project credentials must be an environment-variable name");
  }
  return updateScopedConfig(options, (document) => {
    const { providers, entry } = providerObjects(document, provider);
    return {
      ...document,
      providers: { ...providers, [provider]: { ...entry, apiKey: value } },
    };
  });
}

export function setDefaultProvider(
  options: ScopeOptions,
  provider: string,
  known: ReadonlySet<string>,
): string {
  if (provider !== "auto" && !known.has(provider)) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return updateScopedConfig(options, (document) => ({ ...document, defaultProvider: provider }));
}
