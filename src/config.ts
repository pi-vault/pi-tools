import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { deepMerge } from "./utils/deep-merge.ts";
import { parseAllowRanges } from "./utils/ssrf.ts";
import type { ResearchMode, ResearchModeDefaults } from "./research/types.ts";
import { isProjectTrustedCached } from "./utils/trust.ts";

export type BudgetPeriod = "day" | "month" | "lifetime";
export type BudgetUnit = "request" | "credit" | "usd";
export type ProviderBudget =
  | {
      mode: "hard";
      limit: number;
      period: BudgetPeriod;
      unit: BudgetUnit;
      pool?: string;
    }
  | { mode: "managed" }
  | { mode: "unlimited" };

export interface ProviderConfigEntry {
  enabled: boolean;
  budget: ProviderBudget;
  apiKey?: string;
  instanceUrl?: string;
  ssrfAllowRanges?: string[];
  tokenBudget?: number;
  depth?: "standard" | "deep";
  baseUrl?: string;
  searchDepth?: "snippets" | "basic";
  topic?: "general" | "news";
  ddgsBackend?: string;
  ddgsRegion?: string;
  ddgsTimelimit?: string;
  model?: string;
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

export interface GeminiConfig {
  apiKey?: string;
  baseUrl?: string;
  cloudflareApiKey?: string;
  allowBrowserCookies?: boolean;
  chromeProfile?: string;
}

export interface YouTubeConfig {
  enabled?: boolean;
  preferredModel?: string;
}

export interface VideoConfig {
  enabled?: boolean;
  preferredModel?: string;
  maxSizeMB?: number;
}

export interface PdfConfig {
  ocrEnabled?: boolean;
  ocrMaxPages?: number;
  ocrDpi?: number;
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
  gemini?: GeminiConfig;
  youtube?: YouTubeConfig;
  video?: VideoConfig;
  pdf?: PdfConfig;
}

const ENV_VAR_PATTERN = /^[A-Z][A-Z0-9_]+$/;
const SHELL_CMD_PREFIX = "!";
const SHELL_TIMEOUT_MS = 5000;

const SENTINEL_VALUES = new Set(["null", "undefined", "none"]);

const commandValueCache = new Map<string, { value?: string; errorMessage?: string }>();

export function clearCredentialCache(): void {
  commandValueCache.clear();
}

export const FALLBACK_ENV_MAP: Record<string, string> = {
  brave: "BRAVE_API_KEY",
  "brave-llm": "BRAVE_API_KEY",
  exa: "EXA_API_KEY",
  jina: "JINA_API_KEY",
  tavily: "TAVILY_API_KEY",
  serper: "SERPER_API_KEY",
  firecrawl: "FIRECRAWL_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  langsearch: "LANGSEARCH_API_KEY",
  linkup: "LINKUP_API_KEY",
  youcom: "YOUCOM_API_KEY",
  fastcrw: "FASTCRW_API_KEY",
  sofya: "SOFYA_API_KEY",
  websearchapi: "WEBSEARCHAPI_API_KEY",
  marginalia: "MARGINALIA_API_KEY",
  context7: "CONTEXT7_API_KEY",
  parallel: "PARALLEL_API_KEY",
  ollama: "OLLAMA_API_KEY",
  "openai-web-search": "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

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

export const DEFAULT_GEMINI_CONFIG: Required<
  Pick<GeminiConfig, "baseUrl" | "allowBrowserCookies" | "chromeProfile">
> = {
  baseUrl: "https://generativelanguage.googleapis.com",
  allowBrowserCookies: false,
  chromeProfile: "Default",
};

export const DEFAULT_YOUTUBE_CONFIG: Required<YouTubeConfig> = {
  enabled: true,
  preferredModel: "gemini-3-flash-preview",
};

export const DEFAULT_VIDEO_CONFIG: Required<VideoConfig> = {
  enabled: true,
  preferredModel: "gemini-3-flash-preview",
  maxSizeMB: 50,
};

const DEFAULT_CONFIG: PiToolsConfig = {
  defaultProvider: "auto",
  selectionStrategy: "auto",
  providers: {
    brave: {
      enabled: true,
      budget: { mode: "hard", limit: 5, period: "month", unit: "usd", pool: "brave" },
      apiKey: "BRAVE_API_KEY",
    },
    "brave-llm": {
      enabled: true,
      budget: { mode: "hard", limit: 5, period: "month", unit: "usd", pool: "brave" },
      apiKey: "BRAVE_API_KEY",
    },
    context7: {
      enabled: true,
      budget: { mode: "hard", limit: 1000, period: "month", unit: "request" },
      apiKey: "CONTEXT7_API_KEY",
    },
    duckduckgo: { enabled: true, budget: { mode: "unlimited" } },
    exa: {
      enabled: true,
      budget: { mode: "hard", limit: 10, period: "month", unit: "usd", pool: "exa" },
      apiKey: "EXA_API_KEY",
    },
    fastcrw: {
      enabled: false,
      budget: { mode: "hard", limit: 500, period: "lifetime", unit: "credit" },
      apiKey: "FASTCRW_API_KEY",
    },
    firecrawl: {
      enabled: true,
      budget: { mode: "hard", limit: 1000, period: "month", unit: "credit" },
      apiKey: "FIRECRAWL_API_KEY",
    },
    jina: { enabled: true, budget: { mode: "managed" } },
    langsearch: {
      enabled: false,
      budget: { mode: "hard", limit: 1000, period: "day", unit: "request" },
      apiKey: "LANGSEARCH_API_KEY",
    },
    linkup: {
      enabled: false,
      budget: { mode: "hard", limit: 20, period: "month", unit: "usd" },
      apiKey: "LINKUP_API_KEY",
    },
    marginalia: { enabled: false, budget: { mode: "managed" } },
    ollama: {
      enabled: false,
      budget: { mode: "unlimited" },
      apiKey: "OLLAMA_API_KEY",
    },
    "openai-codex": { enabled: true, budget: { mode: "managed" } },
    "openai-web-search": {
      enabled: true,
      budget: { mode: "managed" },
      apiKey: "OPENAI_API_KEY",
    },
    parallel: {
      enabled: false,
      budget: { mode: "managed" },
      apiKey: "PARALLEL_API_KEY",
    },
    perplexity: {
      enabled: true,
      budget: { mode: "managed" },
      apiKey: "PERPLEXITY_API_KEY",
    },
    searxng: {
      enabled: false,
      budget: { mode: "unlimited" },
      instanceUrl: "http://localhost:8080",
    },
    serper: {
      enabled: false,
      budget: { mode: "hard", limit: 2500, period: "lifetime", unit: "request" },
      apiKey: "SERPER_API_KEY",
    },
    sofya: {
      enabled: false,
      budget: { mode: "managed" },
      apiKey: "SOFYA_API_KEY",
    },
    tavily: {
      enabled: false,
      budget: { mode: "hard", limit: 1000, period: "month", unit: "credit" },
      apiKey: "TAVILY_API_KEY",
    },
    websearchapi: {
      enabled: false,
      budget: { mode: "hard", limit: 2000, period: "month", unit: "credit" },
      apiKey: "WEBSEARCHAPI_API_KEY",
    },
    youcom: {
      enabled: false,
      budget: { mode: "hard", limit: 100, period: "lifetime", unit: "usd" },
      apiKey: "YOUCOM_API_KEY",
    },
  },
  github: DEFAULT_GITHUB_CONFIG,
  ssrf: { allowRanges: [] },
  combine: DEFAULT_COMBINE_CONFIG,
  deepResearch: DEFAULT_DEEP_RESEARCH_CONFIG,
};

export function getConfigPath(): string {
  return path.join(getAgentDir(), "extensions", "tools.json");
}

function isProviderBudget(value: unknown): value is ProviderBudget {
  if (!value || typeof value !== "object") return false;
  const budget = value as Record<string, unknown>;
  if (budget.mode === "managed" || budget.mode === "unlimited") return true;
  return (
    budget.mode === "hard" &&
    typeof budget.limit === "number" &&
    Number.isFinite(budget.limit) &&
    budget.limit > 0 &&
    (budget.period === "day" || budget.period === "month" || budget.period === "lifetime") &&
    (budget.unit === "request" || budget.unit === "credit" || budget.unit === "usd") &&
    (budget.pool === undefined ||
      (typeof budget.pool === "string" && budget.pool.trim().length > 0))
  );
}

function sameHardBudget(a: ProviderBudget, b: ProviderBudget): boolean {
  return (
    a.mode === "hard" &&
    b.mode === "hard" &&
    a.limit === b.limit &&
    a.period === b.period &&
    a.unit === b.unit &&
    a.pool === b.pool
  );
}

function mergeConfigLayer(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const layer = deepMerge(override, {});
  const providers = layer.providers as Record<string, Record<string, unknown>> | undefined;
  let invalid = false;

  if (providers && typeof providers === "object") {
    for (const entry of Object.values(providers)) {
      delete entry.monthlyQuota;
      if (entry.budget !== undefined && !isProviderBudget(entry.budget)) {
        delete entry.budget;
        invalid = true;
      }
    }
  }

  const merged = deepMerge(base, layer);
  const baseProviders = (base.providers ?? {}) as Record<string, ProviderConfigEntry>;
  const mergedProviders = (merged.providers ?? {}) as Record<string, ProviderConfigEntry>;
  const pools = new Map<string, string[]>();

  for (const [name, entry] of Object.entries(mergedProviders)) {
    if (entry.budget?.mode !== "hard" || !entry.budget.pool) continue;
    const names = pools.get(entry.budget.pool) ?? [];
    names.push(name);
    pools.set(entry.budget.pool, names);
  }

  for (const names of pools.values()) {
    const first = mergedProviders[names[0]].budget;
    if (names.every((name) => sameHardBudget(first, mergedProviders[name].budget))) continue;
    invalid = true;
    for (const name of names) {
      if (baseProviders[name]?.budget) mergedProviders[name].budget = baseProviders[name].budget;
    }
  }

  if (invalid) {
    console.warn("[pi-tools] Invalid provider budget override ignored");
  }
  return merged;
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
      typeof raw.targetBackends === "number"
        ? raw.targetBackends
        : DEFAULT_COMBINE_CONFIG.targetBackends,
    ),
    k: Math.max(1, typeof raw.k === "number" ? raw.k : DEFAULT_COMBINE_CONFIG.k),
  };
}

function validateDeepResearchConfig(parsed: unknown): DeepResearchConfig {
  if (!parsed || typeof parsed !== "object") return { ...DEFAULT_DEEP_RESEARCH_CONFIG };
  const raw = parsed as Record<string, unknown>;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_DEEP_RESEARCH_CONFIG.enabled,
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
  const merged = mergeConfigLayer(
    DEFAULT_CONFIG as unknown as Record<string, unknown>,
    parsed as Record<string, unknown>,
  ) as unknown as PiToolsConfig;

  const strategy =
    parsed.selectionStrategy === "auto" || parsed.selectionStrategy === "best-performing"
      ? (parsed.selectionStrategy as SelectionStrategy)
      : DEFAULT_CONFIG.selectionStrategy;

  return {
    defaultProvider: parsed.defaultProvider ?? DEFAULT_CONFIG.defaultProvider,
    selectionStrategy: strategy,
    providers: merged.providers,
    github: {
      ...DEFAULT_CONFIG.github,
      ...parsed.github,
    },
    guidance: parsed.guidance,
    ssrf: validateSsrfConfig(parsed.ssrf),
    combine: validateCombineConfig(parsed.combine),
    deepResearch: validateDeepResearchConfig(parsed.deepResearch),
    gemini: parsed.gemini,
    youtube: parsed.youtube,
    video: parsed.video,
    pdf: parsed.pdf,
  };
}

export function loadConfig(configPath?: string): PiToolsConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath || getConfigPath(), "utf-8");
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  try {
    return parseConfigFile(raw);
  } catch (e) {
    // JSON syntax errors → fall through to defaults; validation errors → propagate
    if (!(e instanceof SyntaxError)) throw e;
  }
  return { ...DEFAULT_CONFIG };
}

export function resolveApiKey(apiKey: string | undefined): string | undefined {
  if (!apiKey) return undefined;

  // Safety check: reject sentinel string values
  if (SENTINEL_VALUES.has(apiKey.toLowerCase())) return undefined;

  // Shell command: starts with !
  if (apiKey.startsWith(SHELL_CMD_PREFIX)) {
    const cmd = apiKey.slice(SHELL_CMD_PREFIX.length);
    const cached = commandValueCache.get(cmd);
    if (cached !== undefined) {
      return cached.value;
    }
    try {
      const value = execSync(cmd, {
        timeout: SHELL_TIMEOUT_MS,
        encoding: "utf-8",
      }).trim();
      commandValueCache.set(cmd, { value });
      return value;
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "unknown error";
      commandValueCache.set(cmd, { errorMessage });
      return undefined;
    }
  }

  // Env var name: all uppercase with underscores
  if (ENV_VAR_PATTERN.test(apiKey)) {
    const value = process.env[apiKey] ?? undefined;
    if (!value) {
      console.warn(`[pi-tools] Environment variable ${apiKey} is referenced but not set`);
    }
    return value;
  }

  // Literal key value
  return apiKey;
}

/**
 * Resolve an API key for a named provider.
 *
 * Resolution order:
 * 1. Explicit config key (passed through resolveApiKey)
 * 2. Fallback env var from FALLBACK_ENV_MAP
 *
 * Note: When configKey is an unset env var, resolveApiKey will log a warning
 * before falling through to the fallback. This is acceptable — the warning
 * helps users notice misconfigurations even when a fallback exists.
 */
export function resolveProviderKey(providerName: string, configKey?: string): string | undefined {
  if (configKey) {
    const resolved = resolveApiKey(configKey);
    if (resolved) return resolved;
  }

  const fallbackEnv = FALLBACK_ENV_MAP[providerName];
  if (fallbackEnv) {
    const envValue = process.env[fallbackEnv];
    if (envValue && envValue.trim().length > 0) return envValue.trim();
  }

  return undefined;
}

// --- Trust Gating ---

const SENSITIVE_KEYS = new Set(["apiKey", "apiSecret", "token"]);
const SENSITIVE_PATHS = new Set([
  "ssrf.allowRanges",
  "gemini.cloudflareApiKey",
  "gemini.allowBrowserCookies",
]);

/**
 * Recursively remove sensitive fields from a config object.
 * Returns a shallow clone at each level with sensitive keys omitted.
 */
export function stripSensitiveFields(
  config: Record<string, unknown>,
  prefix = "",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(config)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (SENSITIVE_KEYS.has(key) || SENSITIVE_PATHS.has(fullPath)) continue;
    const value = config[key];
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = stripSensitiveFields(value as Record<string, unknown>, fullPath);
    } else {
      result[key] = value;
    }
  }
  return result;
}

const MAX_WALK_DEPTH = 10;
const PROJECT_CONFIG_RELATIVE = path.join(CONFIG_DIR_NAME, "tools.json");

/**
 * Walk up from `startDir` looking for Pi's project tools config.
 * Returns the absolute path if found, or undefined.
 * Stops at the filesystem root or after MAX_WALK_DEPTH levels.
 */
export function findProjectConfigPath(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    const candidate = path.join(dir, PROJECT_CONFIG_RELATIVE);
    if (fs.existsSync(candidate)) return candidate;

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function readOptionalConfig(
  filePath: string,
  strict: boolean,
): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch (error) {
    const missing =
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      (error instanceof Error && error.message.includes("ENOENT"));
    if (missing || !strict) return undefined;
    throw error;
  }
}

/**
 * Load config with three-layer resolution:
 *   1. Project `.pi/tools.json` (highest priority)
 *   2. Global `<Pi agent dir>/extensions/tools.json`
 *   3. Built-in defaults (lowest priority)
 *
 * Layers are deep-merged: nested objects merge recursively,
 * scalars and arrays from higher-priority sources replace lower-priority values.
 */
export function loadMergedConfig(cwd?: string, strict = false): PiToolsConfig {
  let merged = deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, {});

  // Layer 2: global config
  const globalConfig = readOptionalConfig(getConfigPath(), strict);
  if (globalConfig) merged = mergeConfigLayer(merged, globalConfig);

  // Layer 1: project config (highest priority)
  if (cwd) {
    const projectPath = findProjectConfigPath(cwd);
    if (projectPath) {
      const raw = readOptionalConfig(projectPath, strict);
      if (raw) {
        const trusted = isProjectTrustedCached(cwd);
        const sanitized = trusted ? raw : stripSensitiveFields(raw);
        if (!trusted && JSON.stringify(sanitized) !== JSON.stringify(raw)) {
          console.warn(
            "[pi-tools] Untrusted project: sensitive config fields ignored. Trust the project in Pi to allow full config.",
          );
        }
        merged = mergeConfigLayer(merged, sanitized);
      }
    }
  }

  return merged as unknown as PiToolsConfig;
}
