import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { deepMerge } from "./utils/deep-merge.ts";

export interface ProviderConfigEntry {
  enabled: boolean;
  monthlyQuota?: number;
  apiKey?: string;
  instanceUrl?: string;
}

export interface GitHubConfig {
  enabled: boolean;
  maxRepoSizeMB: number;
  cloneTimeoutSeconds: number;
}

export type SelectionStrategy = "auto" | "best-performing";

export interface GuidanceOverride {
  promptSnippet?: string;
  promptGuidelines?: string[];
}

export interface PiToolsConfig {
  defaultProvider: string;
  selectionStrategy: SelectionStrategy;
  providers: Record<string, ProviderConfigEntry>;
  github: GitHubConfig;
  guidance?: Record<string, GuidanceOverride>;
}

const ENV_VAR_PATTERN = /^[A-Z][A-Z0-9_]+$/;
const SHELL_CMD_PREFIX = "!";
const SHELL_TIMEOUT_MS = 5000;

const DEFAULT_CONFIG: PiToolsConfig = {
  defaultProvider: "auto",
  selectionStrategy: "auto",
  providers: {
    brave: { enabled: true, monthlyQuota: 2000, apiKey: "BRAVE_API_KEY" },
    exa: { enabled: true, monthlyQuota: 1000, apiKey: "EXA_API_KEY" },
    tavily: { enabled: false, apiKey: "TAVILY_API_KEY" },
    jina: { enabled: true },
    duckduckgo: { enabled: true },
    serper: { enabled: false, apiKey: "SERPER_API_KEY" },
    perplexity: { enabled: true, apiKey: "PERPLEXITY_API_KEY" },
    firecrawl: { enabled: true, apiKey: "FIRECRAWL_API_KEY" },
    "exa-mcp": { enabled: true },
    "openai-native": { enabled: true, apiKey: "OPENAI_API_KEY" },
    parallel: { enabled: false, apiKey: "PARALLEL_API_KEY" },
    searxng: { enabled: false, instanceUrl: "http://localhost:8080" },
    websearchapi: { enabled: false, apiKey: "WEBSEARCHAPI_API_KEY" },
  },
  github: {
    enabled: true,
    maxRepoSizeMB: 350,
    cloneTimeoutSeconds: 30,
  },
};

export function getConfigPath(): string {
  return path.join(os.homedir(), ".pi", "agent", "extensions", "tools.json");
}

function getLegacyConfigPath(): string {
  return path.join(os.homedir(), ".pi", "agent", "extensions", "pi-tools.json");
}

function parseConfigFile(raw: string): PiToolsConfig {
  const parsed = JSON.parse(raw);

  const strategy =
    parsed.selectionStrategy === "auto" || parsed.selectionStrategy === "best-performing"
      ? (parsed.selectionStrategy as SelectionStrategy)
      : DEFAULT_CONFIG.selectionStrategy;

  return {
    defaultProvider: parsed.defaultProvider ?? DEFAULT_CONFIG.defaultProvider,
    selectionStrategy: strategy,
    providers: {
      ...DEFAULT_CONFIG.providers,
      ...parsed.providers,
    },
    github: {
      ...DEFAULT_CONFIG.github,
      ...parsed.github,
    },
    guidance: parsed.guidance,
  };
}

export function loadConfig(configPath?: string): PiToolsConfig {
  const filePath = configPath ?? getConfigPath();
  try {
    return parseConfigFile(fs.readFileSync(filePath, "utf-8"));
  } catch {
    // Fallback: try legacy filename (only when using default path)
    if (!configPath) {
      try {
        return parseConfigFile(fs.readFileSync(getLegacyConfigPath(), "utf-8"));
      } catch {
        // Neither file exists
      }
    }
    return { ...DEFAULT_CONFIG };
  }
}

export function resolveApiKey(apiKey: string | undefined): string | undefined {
  if (!apiKey) return undefined;

  // Shell command: starts with !
  if (apiKey.startsWith(SHELL_CMD_PREFIX)) {
    try {
      const cmd = apiKey.slice(SHELL_CMD_PREFIX.length);
      return execSync(cmd, {
        timeout: SHELL_TIMEOUT_MS,
        encoding: "utf-8",
      }).trim();
    } catch {
      return undefined;
    }
  }

  // Env var name: all uppercase with underscores
  if (ENV_VAR_PATTERN.test(apiKey)) {
    return process.env[apiKey] ?? undefined;
  }

  // Literal key value
  return apiKey;
}

const MAX_WALK_DEPTH = 10;
const PROJECT_CONFIG_RELATIVE = path.join(".pi", "tools.json");
const LEGACY_PROJECT_CONFIG_RELATIVE = path.join(".pi", "pi-tools.json");

/**
 * Walk up from `startDir` looking for `.pi/tools.json` (or legacy `.pi/pi-tools.json`).
 * Returns the absolute path if found, or undefined.
 * Stops at the filesystem root or after MAX_WALK_DEPTH levels.
 */
export function findProjectConfigPath(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    const candidate = path.join(dir, PROJECT_CONFIG_RELATIVE);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    // Fallback: check legacy name at same level
    const legacy = path.join(dir, LEGACY_PROJECT_CONFIG_RELATIVE);
    if (fs.existsSync(legacy)) {
      return legacy;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return undefined;
}

/**
 * Load config with three-layer resolution:
 *   1. Project `.pi/tools.json` (highest priority; falls back to `.pi/pi-tools.json`)
 *   2. Global `~/.pi/agent/extensions/tools.json` (falls back to `pi-tools.json`)
 *   3. Built-in defaults (lowest priority)
 *
 * Layers are deep-merged: nested objects merge recursively,
 * scalars and arrays from higher-priority sources replace lower-priority values.
 */
export function loadMergedConfig(cwd?: string): PiToolsConfig {
  let merged = deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, {});

  // Layer 2: global config
  const globalPath = getConfigPath();
  try {
    const raw = fs.readFileSync(globalPath, "utf-8");
    merged = deepMerge(merged, JSON.parse(raw) as Record<string, unknown>);
  } catch {
    // Fallback: try legacy global path
    try {
      const raw = fs.readFileSync(getLegacyConfigPath(), "utf-8");
      merged = deepMerge(merged, JSON.parse(raw) as Record<string, unknown>);
    } catch {
      // No global config — defaults stand
    }
  }

  // Layer 1: project config (highest priority)
  if (cwd) {
    const projectPath = findProjectConfigPath(cwd);
    if (projectPath) {
      try {
        const raw = fs.readFileSync(projectPath, "utf-8");
        merged = deepMerge(merged, JSON.parse(raw) as Record<string, unknown>);
      } catch {
        // Malformed project config — skip
      }
    }
  }

  return merged as unknown as PiToolsConfig;
}
