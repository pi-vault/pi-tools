import { loadConfig, resolveApiKey, type GeminiConfig } from "../config.ts";
import { activityMonitor } from "../monitor/activity-monitor.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_API_HOST = "https://generativelanguage.googleapis.com";
const API_VERSION = "v1beta";
export const DEFAULT_MODEL = "gemini-3-flash-preview";
const DEFAULT_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeminiApiOptions {
  model?: string;
  mimeType?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface GenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

// ---------------------------------------------------------------------------
// Config loading (lazy, module-scoped cache via loadConfig)
// ---------------------------------------------------------------------------

let cachedGeminiConfig: GeminiConfig | null = null;

function getGeminiConfig(): GeminiConfig {
  if (cachedGeminiConfig) return cachedGeminiConfig;
  cachedGeminiConfig = loadConfig().gemini ?? {};
  return cachedGeminiConfig;
}

/** Reset config cache — exposed for testing only. */
export function _resetConfigCache(): void {
  cachedGeminiConfig = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeBaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : null;
}

function isCloudflareGateway(): boolean {
  try {
    return new URL(getApiHost()).hostname === "gateway.ai.cloudflare.com";
  } catch {
    return false;
  }
}

function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the Gemini API key.
 *
 * Resolution order:
 * 1. `GEMINI_API_KEY` environment variable
 * 2. `config.gemini.apiKey` (passed through resolveApiKey for shell/env indirection)
 */
export function getApiKey(): string | null {
  return (
    normalizeString(process.env.GEMINI_API_KEY) ??
    normalizeString(resolveApiKey(getGeminiConfig().apiKey)) ??
    null
  );
}

/**
 * Resolve the API host URL.
 *
 * Resolution order:
 * 1. `GOOGLE_GEMINI_BASE_URL` environment variable
 * 2. `config.gemini.baseUrl`
 * 3. Default: `https://generativelanguage.googleapis.com`
 */
function getApiHost(): string {
  return (
    normalizeBaseUrl(process.env.GOOGLE_GEMINI_BASE_URL) ??
    normalizeBaseUrl(getGeminiConfig().baseUrl) ??
    DEFAULT_API_HOST
  );
}

/**
 * Returns the versioned API base URL (host + version).
 */
export function getVersionedApiBase(): string {
  return `${getApiHost()}/${API_VERSION}`;
}

/**
 * Resolve the Cloudflare API key for AI Gateway routing.
 *
 * Resolution order:
 * 1. `CLOUDFLARE_API_KEY` environment variable
 * 2. `config.gemini.cloudflareApiKey` (passed through resolveApiKey for shell/env indirection)
 */
function getCloudflareApiKey(): string | null {
  return (
    normalizeString(process.env.CLOUDFLARE_API_KEY) ??
    normalizeString(resolveApiKey(getGeminiConfig().cloudflareApiKey)) ??
    null
  );
}

/**
 * Returns true if the Gemini API is available (direct key or Cloudflare gateway).
 */
export function isGeminiApiAvailable(): boolean {
  return getApiKey() !== null || (isCloudflareGateway() && getCloudflareApiKey() !== null);
}

/**
 * Build authentication headers for the request.
 * For Cloudflare AI Gateway, adds the cf-aig-authorization header.
 * For direct API access, returns empty (key is in URL query param).
 */
function buildAuthHeaders(): Record<string, string> {
  if (!isCloudflareGateway()) return {};
  const cloudflareApiKey = getCloudflareApiKey();
  return cloudflareApiKey
    ? { "cf-aig-authorization": `Bearer ${cloudflareApiKey}` }
    : {};
}

/**
 * Build the API key query parameter string.
 * Returns empty string for Cloudflare gateway (key is in headers instead).
 */
function buildKeyParam(apiKey: string | null): string {
  if (!apiKey || isCloudflareGateway()) return "";
  return `?key=${apiKey}`;
}

/**
 * Query the Gemini generateContent API with a prompt and file/URL URI.
 *
 * @param prompt - The text prompt to send
 * @param videoUri - A file URI (from Files API upload) or URL (YouTube/web page)
 * @param options - Model, mimeType, signal, timeout overrides
 * @returns The generated text response
 * @throws Error if API is not configured, HTTP error, or empty response
 */
export async function queryGeminiApi(
  prompt: string,
  videoUri: string,
  options: GeminiApiOptions = {},
): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey && !(isCloudflareGateway() && getCloudflareApiKey() !== null)) {
    throw new Error(
      "Gemini API not configured. Either:\n" +
        "  1. Set GEMINI_API_KEY environment variable or config.gemini.apiKey\n" +
        "  2. Set GOOGLE_GEMINI_BASE_URL + CLOUDFLARE_API_KEY for Cloudflare AI Gateway",
    );
  }

  const model = options.model ?? DEFAULT_MODEL;
  const signal = withTimeout(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const url = `${getVersionedApiBase()}/models/${model}:generateContent${buildKeyParam(apiKey)}`;

  // Build fileData — include mimeType only if specified
  const fileData: Record<string, string> = { fileUri: videoUri };
  if (options.mimeType) fileData.mimeType = options.mimeType;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ fileData }, { text: prompt }],
      },
    ],
  };

  const entryId = activityMonitor.logStart({ type: "api", query: `gemini:${model}` });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildAuthHeaders() },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    activityMonitor.logError(entryId, `HTTP ${res.status}`);
    const errorText = await res.text();
    throw new Error(
      `Gemini API error ${res.status}: ${errorText.slice(0, 300)}`,
    );
  } else {
    activityMonitor.logComplete(entryId, res.status);
  }

  const data = (await res.json()) as GenerateContentResponse;
  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .filter(Boolean)
    .join("\n");

  if (!text) throw new Error("Gemini API returned empty response");
  return text;
}
