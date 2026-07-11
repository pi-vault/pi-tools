import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { deepMerge } from "./utils/deep-merge.ts";
import { parseAllowRanges } from "./utils/ssrf.ts";
import type { ResearchMode, ResearchModeDefaults } from "./research/types.ts";

export interface ProviderConfigEntry {
  enabled: boolean;
  monthlyQuota?: number;
  apiKey?: string;
  instanceUrl?: string;
  ssrfAllowRanges?: string[];
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

export interface SsrfConfig {
  allowRanges: string[];
}

export interface CombineConfig {
  enabled: boolean;
  mode: "targeted" | "all";
  targetBackends: number;
  k: number;
}

export interface DeepResearchConfig {
  enabled: boolean;
  modeDefaults?: Partial<Record<ResearchMode, Partial<ResearchModeDefaults>>>;
  outputSchema?: Record<string, unknown> | null;
  guidance?: GuidanceOverride;
}

export interface PiToolsConfig {
  defaultProvider: string;
  selectionStrategy: SelectionStrategy;
  providers: Record<string, ProviderConfigEntry>;
  github: GitHubConfig;
  guidance?: Record<string, GuidanceOverride>;
  ssrf: SsrfConfig;
  combine: CombineConfig;
  deepResearch: DeepResearchConfig;
}

const ENV_VAR_PATTERN = /^[A-Z][A-Z0-9_]+$/;
const SHELL_CMD_PREFIX = "!";
const SHELL_TIMEOUT_MS = 5000;

export const DEFAULT_GITHUB_CONFIG: GitHubConfig = {
  enabled: true,
  maxRepoSizeMB: 350,
  cloneTimeoutSeconds: 30,
};

export const DEFAULT_COMBINE_CONFIG: CombineConfig = {
  enabled: false,
  mode: "targeted",
  targetBackends: 3,
  k: 60,
};

export const DEFAULT_DEEP_RESEARCH_CONFIG: DeepResearchConfig = {
  enabled: true,
};

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
    context7: { enabled: true, apiKey: "CONTEXT7_API_KEY" },
  },
  github: DEFAULT_GITHUB_CONFIG,
  ssrf: { allowRanges: [] },
  combine: DEFAULT_COMBINE_CONFIG,
  deepResearch: DEFAULT_DEEP_RESEARCH_CONFIG,
};

export function getConfigPath(): string {
  return path.join(os.homedir(), ".pi", "agent", "extensions", "tools.json");
}

function getLegacyConfigPath(): string {
  return path.join(os.homedir(), ".pi", "agent", "extensions", "pi-tools.json");
}

function validateSsrfConfig(parsed: unknown): SsrfConfig {
  const ssrf = { ...DEFAULT_CONFIG.ssrf, ...(parsed as Record<string, unknown>) };
  // Eagerly validate so malformed config fails at load time, not on first URL fetch.
  parseAllowRanges(ssrf.allowRanges);
  return ssrf as SsrfConfig;
}

function validateCombineConfig(parsed: unknown): CombineConfig {
  const raw = (parsed ?? {}) as Record<string, unknown>;
  const mode =
    raw.mode === "targeted" || raw.mode === "all"
      ? (raw.mode as CombineConfig["mode"])
      : DEFAULT_COMBINE_CONFIG.mode;

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_COMBINE_CONFIG.enabled,
    mode,
    targetBackends: Math.max(
      1,
      typeof raw.targetBackends === "number" ? raw.targetBackends : DEFAULT_COMBINE_CONFIG.targetBackends,
    ),
    k: Math.max(
      1,
      typeof raw.k === "number" ? raw.k : DEFAULT_COMBINE_CONFIG.k,
    ),
  };
}

function validateDeepResearchConfig(parsed: unknown): DeepResearchConfig {
  if (!parsed || typeof parsed !== "object")
    return { ...DEFAULT_DEEP_RESEARCH_CONFIG };
  const raw = parsed as Record<string, unknown>;
  return {
    enabled:
      typeof raw.enabled === "boolean"
        ? raw.enabled
        : DEFAULT_DEEP_RESEARCH_CONFIG.enabled,
    modeDefaults:
      raw.modeDefaults && typeof raw.modeDefaults === "object"
        ? (raw.modeDefaults as DeepResearchConfig["modeDefaults"])
        : undefined,
    outputSchema:
      raw.outputSchema === null
        ? null
        : raw.outputSchema && typeof raw.outputSchema === "object"
          ? (raw.outputSchema as Record<string, unknown>)
          : undefined,
    guidance:
      raw.guidance && typeof raw.guidance === "object"
        ? (raw.guidance as GuidanceOverride)
        : undefined,
  };
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
    ssrf: validateSsrfConfig(parsed.ssrf),
    combine: validateCombineConfig(parsed.combine),
    deepResearch: validateDeepResearchConfig(parsed.deepResearch),
  };
}

export function loadConfig(configPath?: string): PiToolsConfig {
  const paths = configPath ? [configPath] : [getConfigPath(), getLegacyConfigPath()];
  for (const p of paths) {
    let raw: string;
    try {
      raw = fs.readFileSync(p, "utf-8");
    } catch { continue; }
    try {
      return parseConfigFile(raw);
    } catch (e) {
      // JSON syntax errors → fall through to defaults; validation errors → propagate
      if (e instanceof SyntaxError) continue;
      throw e;
    }
  }
  return { ...DEFAULT_CONFIG };
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

  // Layer 2: global config (try new path, fall back to legacy)
  for (const globalPath of [getConfigPath(), getLegacyConfigPath()]) {
    try {
      merged = deepMerge(merged, JSON.parse(fs.readFileSync(globalPath, "utf-8")) as Record<string, unknown>);
      break;
    } catch { continue; }
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
