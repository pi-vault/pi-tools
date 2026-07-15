# Feature Adoption Spec: 11 Competitive Features

**Date:** 2026-07-15
**Status:** Draft
**Branch:** 20260715-refactor

---

## Overview

Adopt 11 features identified in the competitive analysis, organized into 5 atomic phases ordered from simplest to most complex. Each phase is independently mergeable and produces a usable result.

### Phase Summary

| Phase | Features                                                        | Est. Lines | Complexity |
| ----- | --------------------------------------------------------------- | ---------- | ---------- |
| 1     | Cloudflare Bot Retry, Cloudflare AI Gateway                     | ~50        | Trivial    |
| 2     | Content Negotiation, Dynamic Guidance Injection                 | ~120       | Small      |
| 3     | PDF OCR Fallback (dual), Project Trust Gating, Large File Reorg | ~450       | Medium     |
| 4     | Ollama Support, OpenAI Native Web Search (layered)              | ~600       | Large      |
| 5     | Interactive Setup, Activity Monitor Widget                      | ~600       | Complex    |

---

## Phase 1: Cloudflare Defenses

### 1a. Cloudflare Bot Detection Retry

**Problem:** Cloudflare blocks requests with fake browser User-Agents by issuing a 403 with `cf-mitigated: challenge`. Pi-tools currently treats this as a terminal failure.

**Solution:** After receiving a 403 with the `cf-mitigated: challenge` header, retry once with an honest User-Agent.

**Location:** `src/extract/pipeline.ts` (inside the HTTP fetch block, after the initial response check)

**Logic:**

```
if (response.status === 403) {
  const cfMitigated = response.headers.get("cf-mitigated");
  if (cfMitigated === "challenge") {
    // Retry with honest bot identity
    response = await fetch(url, {
      headers: { ...BROWSER_HEADERS, "User-Agent": "pi-tools/0.3.0 (content extraction)" },
      signal,
      redirect: "follow",
    });
  }
}
```

**Fallback:** If the retry also fails, proceed to the existing error handling (non-retryable for 4xx, retryable for 5xx).

**Tests:**

- Mock a 403 with `cf-mitigated: challenge` header, verify retry fires
- Mock a 403 without the header, verify no retry
- Mock retry succeeding with 200

---

### 1b. Cloudflare AI Gateway Support

**Problem:** Users routing Gemini calls through Cloudflare AI Gateway need a custom base URL and an authorization header.

**Solution:** Use the existing `gemini.baseUrl` config field. When the base URL matches a Cloudflare gateway pattern, inject `cf-aig-authorization` header using `gemini.cloudflareApiKey`.

**Location:** `src/extract/gemini-api.ts` (where Gemini HTTP requests are made)

**Config (already partially defined in config.ts):**

```typescript
interface GeminiConfig {
  apiKey?: string;
  baseUrl?: string; // default: "https://generativelanguage.googleapis.com"
  cloudflareApiKey?: string; // injected as cf-aig-authorization when gateway detected
  allowBrowserCookies?: boolean;
  chromeProfile?: string;
}
```

**Detection logic:**

```
const isGateway = baseUrl.includes("gateway.ai.cloudflare.com");
if (isGateway && cloudflareApiKey) {
  headers["cf-aig-authorization"] = `Bearer ${cloudflareApiKey}`;
}
```

**Key detail:** When the gateway is active, the `?key=` query parameter must be **omitted** from the URL. Authentication is header-only via `cf-aig-authorization`. The Gemini API key is still needed for non-gateway use.

```
// In the URL-building code:
const keyParam = isGateway ? "" : `?key=${apiKey}`;
const url = `${baseUrl}/v1beta/models/${model}:generateContent${keyParam}`;
```

**Tests:**

- Verify header injection when base URL contains "gateway.ai.cloudflare.com"
- Verify `?key=` param is omitted when gateway is active
- Verify no injection for default googleapis URL
- Verify no injection when cloudflareApiKey is missing

---

## Phase 2: Smarter Fetching & Guidance

### 2a. Content Negotiation (HEAD Probe)

**Problem:** Pi-tools always performs a full GET request before checking content-type. This wastes bandwidth on large binary files that will be rejected.

**Solution:** Send a HEAD request before the full GET to pre-check content-type and content-length. Skip the full download if the content is binary or too large.

**Location:** `src/extract/pipeline.ts` (new helper function called before the existing `fetch()`)

**New function: `probeUrl(url, signal) -> { contentType?, contentLength?, skip: boolean, reason? }`**

**Logic:**

1. HEAD request with same `BROWSER_HEADERS`, 5-second timeout
2. If HEAD fails (405 Method Not Allowed, network error, timeout) → return `{ skip: false }` (fall through to GET)
3. If content-type is binary (image/, audio/, video/, application/zip, application/gzip, application/octet-stream) AND NOT application/pdf → return `{ skip: true, reason: "binary content type" }`
4. If content-length > 50MB for PDF → return `{ skip: true, reason: "PDF too large" }`
5. If content-length > 10MB for non-PDF → return `{ skip: true, reason: "response too large" }`
6. Otherwise → return `{ skip: false, contentType, contentLength }`

**Integration in pipeline.ts:**

```
// Before the existing fetch() call:
const probe = await probeUrl(url, signal);
if (probe.skip) {
  throw new Error(`Skipped: ${probe.reason} (${url})`);
}
// Proceed to full GET as before
```

**Performance impact:** Adds ~50ms per request when HEAD succeeds. Saves potentially seconds on large binary downloads that would be rejected anyway.

**Tests:**

- HEAD returns image/png → skip
- HEAD returns text/html → proceed
- HEAD returns 405 → proceed (graceful fallback)
- HEAD times out → proceed
- Content-length > 10MB with text/html → skip
- PDF under 50MB → proceed; over 50MB → skip

---

### 2b. Dynamic Guidance Injection

**Problem:** Tool guidance (promptGuidelines) is evaluated once at registration time. It cannot adapt to the user's environment (e.g., whether `gh` CLI, `yt-dlp`, or `ffmpeg` are available).

**Solution:** Detect environment capabilities at extension startup and inject relevant guidelines into tool definitions.

**New file: `src/utils/capabilities.ts`**

```typescript
export interface EnvironmentCapabilities {
  hasGhCli: boolean;
  hasYtDlp: boolean;
  hasFfmpeg: boolean;
}

// Detect available CLI tools (cached, run once at startup)
export function detectCapabilities(): EnvironmentCapabilities;
```

**Detection method:** `which <tool>` (or `command -v` on POSIX). Cache result — run once at extension load.

**Guidance additions per tool:**

| Tool      | Capability | Added Guideline                                                                            |
| --------- | ---------- | ------------------------------------------------------------------------------------------ |
| web_fetch | hasGhCli   | "For GitHub repository URLs, consider using the `gh` CLI directly for richer file access." |
| web_fetch | hasYtDlp   | "YouTube frame extraction is available (yt-dlp detected)."                                 |
| web_fetch | hasFfmpeg  | "Local video analysis with frame extraction is available (ffmpeg detected)."               |

**Integration in `src/index.ts`:**

```
const caps = detectCapabilities();
// Merge capability-based guidelines with static/config guidelines
const fetchGuidelines = [
  ...(configManager.current.guidance?.web_fetch?.promptGuidelines ?? DEFAULT_GUIDELINES),
  ...(caps.hasGhCli ? ["For GitHub repository URLs, consider using the `gh` CLI..."] : []),
  ...(caps.hasYtDlp ? ["YouTube frame extraction is available..."] : []),
  ...(caps.hasFfmpeg ? ["Local video analysis with frame extraction is available..."] : []),
];
```

**Tests:**

- Mock `which` to return success → guideline added
- Mock `which` to return failure → guideline omitted
- Verify guidelines array merges correctly with config overrides

---

## Phase 3: PDF OCR, Trust, File Reorg

### 3a. PDF OCR Fallback (Dual Strategy)

**Problem:** Scanned PDFs yield empty text from `unpdf` extraction. Pi-tools has no fallback for image-based PDFs.

**Solution:** Two-tier OCR strategy. When PDF text extraction looks like a scanned document, rasterize pages to PNG. First, try attaching images as content blocks in the tool result (letting the calling model OCR them via its vision capability). If the calling model doesn't support image input, fall back to calling Gemini vision API directly.

**Scanned PDF heuristic:** `looksLikeScannedPdf(text, byteLength)`

- Extracted text is empty after whitespace normalization, OR
- PDF byte size > 5KB AND extracted text < 200 characters

**New file: `src/extract/pdf-ocr.ts`**

```typescript
export interface RasterizeOptions {
  maxPages?: number; // default: 5, max: 20
  dpi?: number; // default: 150, range: 72-300
}

export interface PdfPageImage {
  type: "image";
  mimeType: "image/png";
  data: string; // base64-encoded PNG
  pageNumber: number;
}

export interface RasterizeResult {
  pageCount: number;
  images: PdfPageImage[];
  truncated: boolean; // true if pageCount > maxPages
}

// Rasterize PDF pages to PNG using pdftoppm (poppler-utils)
export async function rasterizePdfPages(
  pdfBuffer: Uint8Array,
  options?: RasterizeOptions,
): Promise<RasterizeResult>;

// Returns true if the calling model accepts image input
export function modelSupportsImages(ctx: ExtensionContext): boolean;

// OCR via Gemini vision (fallback when calling model lacks vision)
export async function extractTextWithGeminiVision(
  images: PdfPageImage[],
  geminiApiKey: string,
  options?: { geminiBaseUrl?: string; model?: string },
  signal?: AbortSignal,
): Promise<string | null>;
```

**Rasterization method:** Uses `pdftoppm` CLI from poppler-utils (same approach as vanillagreen). Writes PDF to temp dir, runs `pdftoppm -png -r <dpi> -f 1 -l <lastPage>`, reads output PNGs as base64. Cleans up temp dir in `finally` block.

**Integration in `pipeline.ts`:**

```
// After existing PDF extraction attempt:
if (pdfConfig?.ocrEnabled !== false && looksLikeScannedPdf(text, buffer.byteLength)) {
  chain.push("pdf:scanned");
  try {
    const result = await rasterizePdfPages(buffer, {
      maxPages: pdfConfig?.ocrMaxPages ?? 5,
      dpi: pdfConfig?.ocrDpi ?? 150,
    });

    if (modelSupportsImages(ctx)) {
      // Strategy 1: Attach images as content blocks, let the calling model OCR
      chain.push("pdf-ocr:content-blocks");
      const imagesNote = `\n\n[${result.images.length} scanned PDF page images attached for vision OCR]`;
      return {
        text: text + imagesNote,
        images: result.images,  // attached as { type: "image", mimeType, data }
        ...
      };
    }

    // Strategy 2: Call Gemini vision API directly
    const geminiKey = resolveApiKey(geminiConfig?.apiKey);
    if (geminiKey) {
      const ocrText = await extractTextWithGeminiVision(result.images, geminiKey, {
        geminiBaseUrl: geminiConfig?.baseUrl,
      }, signal);
      if (ocrText && ocrText.length > 100) {
        chain.push("pdf-ocr:gemini");
        return { text: ocrText, ... };
      }
      chain.push("pdf-ocr:gemini-fail");
    }
  } catch (error) {
    chain.push("pdf-ocr:error");
    // pdftoppm not installed or other rasterization failure — fall through
  }
}
```

**Model vision detection:** Check `ctx.model?.input` array for `"image"`. Pi's `Model` interface includes `input: ("text" | "image")[]`.

```typescript
export function modelSupportsImages(ctx: ExtensionContext): boolean {
  return ctx.model?.input?.includes("image") ?? false;
}
```

**Config additions:**

```typescript
// In PiToolsConfig:
pdf?: {
  ocrEnabled?: boolean;    // default: true
  ocrMaxPages?: number;    // default: 5, max: 20
  ocrDpi?: number;         // default: 150, range: 72-300
}
```

**Tests:**

- Mock pdftoppm output → images rasterized correctly
- Model supports images → content blocks returned (no Gemini call)
- Model lacks images → Gemini vision API called
- Gemini returns text → OCR result used
- Gemini fails → falls through to error
- Good text extraction → OCR NOT triggered (heuristic)
- pdftoppm not installed → graceful fallback (no crash)
- Config ocrEnabled: false → OCR skipped

---

### 3b. Project Trust Gating

**Problem:** Project-level `.pi/tools.json` is loaded unconditionally. A malicious project config could alter credential resolution or SSRF rules.

**Solution:** Distinguish sensitive vs. non-sensitive config fields. Project config cannot override sensitive fields unless the project is explicitly trusted.

**Sensitive fields (blocked from untrusted projects):**

- `providers.*.apiKey`
- `ssrf.allowRanges`
- `gemini.apiKey`, `gemini.cloudflareApiKey`, `gemini.allowBrowserCookies`
- `ollama.apiKey` (Phase 4)
- Any field path matching pattern: `*.apiKey`, `*.apiSecret`, `*.token`

**Non-sensitive fields (always allowed from project config):**

- `defaultProvider`, `selectionStrategy`
- `providers.*.enabled`, `providers.*.monthlyQuota`
- `guidance.*`, `combine.*`, `github.*`
- `youtube.*`, `video.*`, `pdf.*`

**Trust detection via Pi's ExtensionContext API:**

Pi's framework provides `ctx.isProjectTrusted(): boolean` on the `ExtensionContext`. Trust state is stored in `~/.pi/agent/trust.json` (per-directory). Extensions do not check env vars or marker files — they use this API.

Since `loadMergedConfig()` runs at startup (before tool execution context is available), we use a cached trust registry pattern (same approach as vanillagreen):

```typescript
// Global symbol registry for trust state (survives across event handlers)
const TRUST_SYMBOL = Symbol.for("pi-tools.project-trust");

interface TrustRegistry {
  trusted?: Map<string, boolean>; // projectDir -> trusted
}

function trustRegistry(): TrustRegistry {
  const host = globalThis as unknown as Record<
    PropertyKey,
    TrustRegistry | undefined
  >;
  return (host[TRUST_SYMBOL] ??= {});
}

// Called from event handlers that have ctx access
export function recordProjectTrust(ctx: {
  cwd?: string;
  isProjectTrusted?: () => boolean;
}): void {
  if (!ctx.cwd) return;
  const trusted = ctx.isProjectTrusted?.() === true;
  const registry = trustRegistry();
  registry.trusted ??= new Map();
  registry.trusted.set(ctx.cwd, trusted);
}

// Called from loadMergedConfig() to check cached trust
export function isProjectTrustedCached(cwd: string): boolean {
  return trustRegistry().trusted?.get(cwd) === true;
}
```

**Trust recording points (in `src/index.ts`):**

- `pi.on("session_start", (_, ctx) => recordProjectTrust(ctx))`
- `pi.on("model_select", (_, ctx) => recordProjectTrust(ctx))`
- `pi.on("before_provider_request", (_, ctx) => recordProjectTrust(ctx))`

**New helper in `src/config.ts`:**

```typescript
const SENSITIVE_PATTERNS = [
  /\.apiKey$/,
  /\.apiSecret$/,
  /\.token$/,
  /^ssrf\.allowRanges$/,
  /^gemini\.(cloudflareApiKey|allowBrowserCookies)$/,
];

// Recursively removes fields matching SENSITIVE_PATTERNS from config object.
// Returns a shallow clone with sensitive keys omitted.
export function stripSensitiveFields(
  config: Record<string, unknown>,
): Record<string, unknown>;
```

**Integration in `loadMergedConfig()`:**

```
// Layer 1: project config (highest priority)
if (cwd) {
  const projectPath = findProjectConfigPath(cwd);
  if (projectPath) {
    const raw = JSON.parse(fs.readFileSync(projectPath, "utf-8"));
    const trusted = isProjectTrustedCached(cwd);
    const sanitized = trusted ? raw : stripSensitiveFields(raw);
    if (!trusted && raw !== sanitized) {
      console.warn("[pi-tools] Untrusted project: sensitive config fields ignored. Trust the project in Pi to allow full config.");
    }
    merged = deepMerge(merged, sanitized);
  }
}
```

**Tests:**

- Untrusted project with apiKey in config → field stripped
- Trusted project with apiKey → field preserved
- Untrusted project with `guidance` → field preserved (non-sensitive)
- Trust recording: mock ctx.isProjectTrusted() → cached correctly
- Trust cache miss (first load before any event) → defaults to untrusted

---

### 3c. Large File Organization (Refactoring)

**Problem:** `src/tools/web-fetch.ts` (448 lines) mixes single-URL logic, multi-URL orchestration, concurrency control, image collection, and rendering.

**Solution:** Extract multi-URL logic and the generic concurrency limiter into separate files.

**File changes:**

| Current                              | After                                       | Responsibility                                                        |
| ------------------------------------ | ------------------------------------------- | --------------------------------------------------------------------- |
| `src/tools/web-fetch.ts` (448 lines) | `src/tools/web-fetch.ts` (~200 lines)       | Tool definition, single-URL path, buildResult, errorResult, rendering |
| (same file)                          | `src/tools/web-fetch-multi.ts` (~150 lines) | Multi-URL orchestration, deduplication, manifest mode, per-URL caps   |
| (same file)                          | `src/utils/concurrency.ts` (~30 lines)      | Generic `fetchWithConcurrencyLimit<T>()`                              |

**No behavioral changes.** Pure mechanical extraction. The `createWebFetchTool` factory in `web-fetch.ts` calls into `executeMultiUrl()` from `web-fetch-multi.ts` for the multi-URL path.

**Verification:** All existing `web-fetch.test.ts` and `web-fetch-video.test.ts` tests must pass without modification.

---

## Phase 4: Ollama & OpenAI Native

### 4a. Self-Hosted Ollama Support

**Problem:** Users wanting local-first web tooling without external API keys have no option. Ollama provides local inference with native web search and fetch capabilities.

**Solution:** Add Ollama as a tier-3 search and fetch provider using Ollama's native web search/fetch API endpoints (not chat-based synthesis).

**New file: `src/providers/ollama.ts`**

```typescript
export class OllamaProvider implements SearchProvider, FetchProvider {
  constructor(options: OllamaProviderOptions);
  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResponse>;
  async fetch(
    url: string,
    raw: boolean,
    signal?: AbortSignal,
  ): Promise<FetchResponse>;
}
```

**API Endpoints (verified against juicesharp's implementation):**

Ollama exposes dedicated web search/fetch endpoints (not `/api/chat`):

| Endpoint | Cloud (ollama.com) | Local (localhost)              |
| -------- | ------------------ | ------------------------------ |
| Search   | `/api/web_search`  | `/api/experimental/web_search` |
| Fetch    | `/api/web_fetch`   | `/api/experimental/web_fetch`  |

**Local vs cloud detection:**

```typescript
function isLocalHost(baseUrl: string): boolean {
  const hostname = new URL(baseUrl).hostname;
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]"
  );
}
```

Local instances use `/api/experimental/...` paths; cloud uses `/api/...` paths.

**Search implementation:**

```
POST {baseUrl}{searchPath}
Body: { query: string, max_results?: number }
Response: { results: Array<{ title, url, snippet }> }
```

**Fetch implementation:**

```
POST {baseUrl}{fetchPath}
Body: { url: string }
Response: { title: string, content: string, links: string[] }
```

**Config additions:**

```typescript
// In PiToolsConfig:
ollama?: {
  enabled?: boolean;         // default: false (opt-in)
  baseUrl?: string;          // default: "http://localhost:11434"
  apiKey?: string;           // only for cloud Ollama instances
}
```

**Registration in `src/providers/all.ts`:**

- Added to `allProviders` array with `tier: 3`, `monthlyQuota: null`, `requiresKey: false`
- Env vars: `OLLAMA_HOST` (base URL), `OLLAMA_API_KEY` (optional)
- `create()` factory: register when baseUrl is configured or env var is set
- No startup connectivity check — fail at call time with actionable message

**SSRF exception:** Ollama's `baseUrl` is exempt from SSRF validation (loopback is expected for local instances).

**Error handling — connection refused detection:**

```typescript
function isConnectionRefused(error: unknown): boolean {
  if (error instanceof TypeError) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code === "ECONNREFUSED";
  }
  return false;
}
// → "Could not connect to Ollama at {host}. Make sure Ollama is running (ollama serve)."
```

**Tests:**

- Mock Ollama search response → parsed into SearchResult[]
- Mock Ollama fetch response → title + content returned
- Local host detection → uses experimental paths
- Cloud host → uses stable paths
- Connection refused → actionable error message
- API key header included when configured

---

### 4b. OpenAI Native Web Search Integration (Layered)

**Problem:** When running on OpenAI/Codex models that include built-in web search, pi-tools still uses its own providers (costing API quota). The native search is free and well-integrated with the model.

**Solution:** Two-layer approach: (1) a transparent payload rewrite that converts our `web_search` tool to OpenAI's native format when running on OpenAI models, and (2) a separate provider that calls OpenAI's Responses API directly as a fallback for non-OpenAI models with an OpenAI API key.

**Relationship to existing `openai-codex` provider:** The existing `openai-codex.ts` provides code search via Pi-managed authentication. This feature is about _web_ search, not code search. They coexist without conflict.

#### Layer 1: Payload Rewrite (Primary — vanillagreen approach)

**Mechanism:** Hook Pi's `before_provider_request` event. When the model is OpenAI/Codex, rewrite the `web_search` function tool definition in the LLM request payload to OpenAI's native web search format. The model then uses its built-in web search — no API call from us, no quota cost.

**New file: `src/providers/openai-native-rewrite.ts`**

```typescript
// Detect OpenAI model from provider string
export function isOpenAiNativeModel(
  model: { provider?: string } | undefined,
): boolean {
  const provider = (model?.provider ?? "").toLowerCase();
  return (
    provider === "openai-codex" ||
    provider === "openai" ||
    provider.startsWith("openai-")
  );
}

// Rewrite web_search function tool to native OpenAI format
export function rewriteNativeWebSearch<T>(
  payload: T,
  options?: { externalWebAccess?: boolean },
): { payload: T; rewritten: string[] };
```

**Rewrite logic:**

```typescript
// In the payload's tools array, find function tools named "web_search":
//   { type: "function", function: { name: "web_search", ... } }
// Replace with:
//   { type: "web_search", external_web_access: true }
```

**Integration in `src/index.ts`:**

```typescript
pi.on("before_provider_request", (event, ctx) => {
  const settings = configManager.current;
  if (!settings.openaiNative?.rewriteEnabled) return undefined;
  if (!isOpenAiNativeModel(ctx.model)) return undefined;
  const result = rewriteNativeWebSearch(event.payload, {
    externalWebAccess: settings.openaiNative?.externalWebAccess ?? true,
  });
  return result.rewritten.length > 0 ? result.payload : undefined;
});
```

**What happens:** When the LLM request goes to OpenAI with `{ type: "web_search" }` in the tools array, the model uses its native web search capability. Results come back inline in the model's response with `url_citation` annotations. No parsing needed on our end — it's transparent.

#### Layer 2: Separate Provider (Fallback)

**Mechanism:** For cases where the user has an `OPENAI_API_KEY` but is running on a non-OpenAI model (e.g., Claude), register `openai-native` as a search provider that calls the OpenAI Responses API directly.

**New file: `src/providers/openai-native.ts`**

```typescript
export function createOpenAiNativeProvider(
  apiKey: string,
  config?: OpenAiNativeConfig,
): {
  search: SearchProvider;
};
```

**Implementation:**

- POST to OpenAI's `/v1/responses` endpoint:
  - `tools: [{ type: "web_search_preview" }]`
  - `input: query`
  - `model: configurable (default "gpt-4.1-mini")`
- Parse response: handles both JSON and SSE streaming responses
- Extract results from two locations in the response:
  1. Message content with `url_citation` annotations → `{ title, url, snippet }`
  2. `web_search_call` output items with sources → `{ title, url }`
- Deduplicate by URL

**Registration:**

- Tier 1 (highest priority when available)
- No monthly quota (pay-per-use)
- Requires: `OPENAI_API_KEY` environment variable or configured key
- Only registered when `openaiNative.providerEnabled` is true

**Config additions:**

```typescript
// In PiToolsConfig:
openaiNative?: {
  rewriteEnabled?: boolean;       // default: true (Layer 1)
  externalWebAccess?: boolean;    // default: true (for the rewrite)
  providerEnabled?: boolean;      // default: true (Layer 2)
  apiKey?: string;                // default: "OPENAI_API_KEY" env var
  model?: string;                 // default: "gpt-4.1-mini"
}
```

**How the layers interact:**

- On OpenAI models: Layer 1 fires via `before_provider_request`, tool is rewritten to native format. Our `web_search` execute function returns a notice message (never shown because the model uses native search instead).
- On non-OpenAI models: Layer 1 doesn't fire (model detection fails). If `openai-native` is registered as a provider, Layer 2 kicks in via normal provider selection.
- Both layers can be independently enabled/disabled via config.

**Tests:**

- Payload rewrite: function web_search → native web_search format
- Payload rewrite: non-web_search tools preserved unchanged
- Model detection: openai-codex → true, anthropic → false
- Provider: mock OpenAI response with citations → parsed into SearchResult[]
- Provider: SSE streaming response → parsed correctly
- Provider: API error → fallback to next provider
- Config: rewriteEnabled false → no rewrite
- Config: providerEnabled false → provider not registered

---

## Phase 5: Interactive Setup & Activity Monitor

### 5a. Interactive Setup Experience

**Problem:** The current `/tools` command has a basic wizard that iterates through ALL 20+ providers sequentially. Onboarding is tedious. There's no way to manage individual providers without editing JSON.

**Solution:** Enhance `/tools` with both a smart wizard (default action) and composable sub-commands for ongoing management.

**File changes:**

- Rewrite: `src/commands/tools.ts` (keep status table, enhance handler)
- New: `src/commands/tools-setup.ts` (wizard logic)
- New: `src/commands/tools-subcommands.ts` (sub-command handlers)

**Sub-commands:**

```
/tools                    → enhanced wizard (default)
/tools status             → provider status table (existing)
/tools reload             → refresh config from disk (existing)
/tools enable <name>      → enable provider in config, save
/tools disable <name>     → disable provider in config, save
/tools key <name> <value> → set API key for provider, save
/tools test [name]        → test connection to specific or all enabled providers
/tools default <name>     → set default provider, save
/tools monitor [on|off]   → toggle activity monitor (5b)
```

**Enhanced Wizard (no args):**

1. **Diagnostic preamble:**
   - Show detected environment keys (e.g., "BRAVE_API_KEY: detected")
   - Show config file status (exists? location?)
   - Provider summary: "4 active, 2 configured but no key, 14 inactive"

2. **Offer choices** (via `ctx.ui.select()`):
   - "Quick setup (top providers by tier)" → guides through tier-1 providers only
   - "Full setup (all providers)" → iterates all providers (current behavior, improved)
   - "Just show status" → display table and exit

3. **Quick setup flow:**
   - Present tier-1 providers with status (key detected? enabled?)
   - For each without a key: prompt for API key (with skip option)
   - Test each newly configured provider
   - Save config

4. **Key display:** Mask middle characters: `BSA_xxxx...7x2f` (first 4 + last 4)

**Arg parsing:**

```typescript
function parseArgs(argsStr: string): { subcommand: string; rest: string[] } {
  const parts = argsStr.trim().split(/\s+/);
  return { subcommand: parts[0] ?? "", rest: parts.slice(1) };
}
```

**Config write helper:**

```typescript
// Read existing config, apply change, write back (atomic)
function updateConfig(
  updater: (config: Partial<PiToolsConfig>) => Partial<PiToolsConfig>,
): void;
```

**Tests:**

- `/tools enable brave` → config file updated with brave.enabled = true
- `/tools key brave BSA_xxx` → config file updated with brave.apiKey = "BSA_xxx"
- `/tools test brave` → HTTP call to Brave API, report success/failure
- `/tools default exa` → config.defaultProvider = "exa"
- Wizard flow: mock ctx.ui interactions, verify config output
- Unknown sub-command → helpful error with usage

---

### 5b. Activity Monitor Widget

**Problem:** No real-time visibility into pi-tools' HTTP activity, provider selection decisions, or failure patterns during a session.

**Solution:** An event-driven activity monitor that collects request telemetry and renders a toggle-able widget via Pi's `ctx.ui.setWidget()` API.

**New files:**

- `src/monitor/types.ts` — event/entry type definitions
- `src/monitor/activity-monitor.ts` — entry store + listener pattern
- `src/monitor/widget.ts` — TUI rendering via `Text` from `@earendil-works/pi-tui`

**Entry type (unified start + end):**

```typescript
export interface ActivityEntry {
  id: string;
  type: "api" | "fetch"; // search provider call vs URL fetch
  startTime: number;
  endTime?: number;

  // For API calls
  query?: string;

  // For URL fetches
  url?: string;

  // Result
  status: number | null; // HTTP code, null = pending
  error?: string;
}
```

**ActivityMonitor (singleton, replaces separate EventBus + Store):**

```typescript
export class ActivityMonitor {
  private entries: ActivityEntry[] = []; // max 10 (ring buffer)
  private listeners = new Set<() => void>();

  logStart(partial: Omit<ActivityEntry, "id" | "startTime" | "status">): string;
  logComplete(id: string, status: number): void;
  logError(id: string, error: string): void;
  getEntries(): ReadonlyArray<ActivityEntry>;
  clear(): void;

  onUpdate(callback: () => void): () => void; // returns unsubscribe
}

export const activityMonitor = new ActivityMonitor();
```

**Instrumentation points (call `activityMonitor.logStart/logComplete/logError`):**

| Location                                         | Entry Type           | Target         |
| ------------------------------------------------ | -------------------- | -------------- |
| `src/providers/execute.ts` (executeWithFallback) | `"api"`              | query          |
| `src/providers/fusion.ts` (executeWithFusion)    | `"api"` per provider | query          |
| `src/extract/pipeline.ts` (HTTP fetch)           | `"fetch"`            | URL            |
| `src/extract/gemini-api.ts` (Gemini calls)       | `"api"`              | prompt summary |

**Widget rendering (via `ctx.ui.setWidget()`):**

Pi's framework provides `ctx.ui.setWidget(key, content, options?)` on the `ExtensionUIContext`. The `content` is a `Text` component from `@earendil-works/pi-tui`.

```typescript
function updateWidget(ctx: ExtensionContext): void {
  const theme = ctx.ui.theme;
  const entries = activityMonitor.getEntries();
  const lines: string[] = [];

  lines.push(theme.fg("accent", "--- Web Tools Activity " + "-".repeat(37)));

  if (entries.length === 0) {
    lines.push(theme.fg("muted", "  No activity yet"));
  } else {
    for (const e of entries) {
      lines.push("  " + formatEntryLine(e, theme));
    }
  }

  lines.push(theme.fg("accent", "-".repeat(60)));
  ctx.ui.setWidget("pi-tools-activity", new Text(lines.join("\n"), 0, 0));
}
```

**Entry line format:** `TYPE  TARGET                            STATUS  TIME  INDICATOR`

```
  API  "react hooks"                        200  0.2s  ✓
  GET  example.com/page                     200  0.1s  ✓
  API  "typescript patterns"                429  1.2s  ✗
  GET  video:demo.mp4                       ...  0.5s  ⋯
```

**Toggle via `/tools monitor on|off`:**

```typescript
// In tools command handler:
if (subcommand === "monitor") {
  const action = rest[0];
  if (action === "on") {
    widgetVisible = true;
    widgetUnsubscribe = activityMonitor.onUpdate(() => updateWidget(ctx));
    updateWidget(ctx);
    ctx.ui.notify("Activity monitor enabled");
  } else if (action === "off") {
    widgetVisible = false;
    widgetUnsubscribe?.();
    widgetUnsubscribe = null;
    ctx.ui.setWidget("pi-tools-activity", undefined); // removes widget
    ctx.ui.notify("Activity monitor disabled");
  }
}
```

**Session lifecycle:**

- On `session_start` / `session_shutdown`: unsubscribe, clear monitor, reset visibility
- On session change: re-subscribe with new ctx if widget was visible

**Performance considerations:**

- Listener callbacks are synchronous fire-and-forget (no await)
- Ring buffer caps at 10 entries (no memory growth)
- Widget re-renders only on new events (listener fires → updateWidget)
- When monitor is off, no entries are logged (instrumentation checks `widgetVisible` flag)

**Tests:**

- ActivityMonitor: logStart → entry created with status null
- ActivityMonitor: logComplete → entry updated with status + endTime
- ActivityMonitor: ring buffer eviction at 10 entries
- Widget rendering: format matches expected output
- Toggle on → widget visible; toggle off → widget removed
- Session shutdown → monitor cleared

---

## Cross-Cutting Concerns

### Testing Strategy

Each phase adds tests for its new functionality. No phase should break existing tests.

| Phase | New Test Files                                                                                                                                             | Existing Tests Modified                                      |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1     | `tests/extract/cloudflare.test.ts`                                                                                                                         | None                                                         |
| 2     | `tests/extract/head-probe.test.ts`, `tests/utils/capabilities.test.ts`                                                                                     | None                                                         |
| 3     | `tests/extract/pdf-ocr.test.ts`, `tests/config-trust.test.ts`                                                                                              | `tests/tools/web-fetch.test.ts` (import path changes)        |
| 4     | `tests/providers/ollama.test.ts`, `tests/providers/openai-native.test.ts`, `tests/providers/openai-native-rewrite.test.ts`                                 | None                                                         |
| 5     | `tests/commands/tools-setup.test.ts`, `tests/commands/tools-subcommands.test.ts`, `tests/monitor/activity-monitor.test.ts`, `tests/monitor/widget.test.ts` | `tests/commands/tools.test.ts` (updated for new arg parsing) |

### Config Schema Evolution

Phases add config fields incrementally. All new fields are optional with sensible defaults. No breaking changes to existing config files.

```typescript
// Full config after all phases:
interface PiToolsConfig {
  // Existing (unchanged)
  defaultProvider: string;
  selectionStrategy: SelectionStrategy;
  providers: Record<string, ProviderConfigEntry>;
  github: GitHubConfig;
  guidance?: Record<string, GuidanceOverride>;
  ssrf: SsrfConfig;
  combine: CombineConfig;
  deepResearch: DeepResearchConfig;
  gemini?: GeminiConfig; // Phase 1b adds gateway awareness
  youtube?: YouTubeConfig;
  video?: VideoConfig;

  // New (added by phases)
  pdf?: PdfConfig; // Phase 3a: { ocrEnabled, ocrMaxPages, ocrDpi }
  ollama?: OllamaConfig; // Phase 4a: { enabled, baseUrl, apiKey }
  openaiNative?: OpenAiNativeConfig; // Phase 4b: { rewriteEnabled, externalWebAccess, providerEnabled, apiKey, model }
}
```

### Dependency Changes

| Phase | New Dependencies | Reason                               |
| ----- | ---------------- | ------------------------------------ |
| 1-2   | None             | Uses existing Node APIs              |
| 3a    | None             | Uses existing unpdf + Gemini API     |
| 3b-3c | None             | Pure logic                           |
| 4     | None             | HTTP calls to Ollama/OpenAI (no SDK) |
| 5     | None             | Uses existing Pi TUI framework       |

No new npm dependencies across all 5 phases. All features use `fetch()`, existing libraries, or Pi's framework APIs.

### Migration & Backward Compatibility

- All new config fields are optional with defaults matching current behavior
- No existing tool names, parameters, or behaviors change
- Phase 3c (file reorg) changes import paths internally but exports remain stable
- Users who don't configure new features experience zero changes
