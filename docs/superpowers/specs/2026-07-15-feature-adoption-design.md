# Feature Adoption Spec: 11 Competitive Features

**Date:** 2026-07-15
**Status:** Draft
**Branch:** 20260715-refactor

---

## Overview

Adopt 11 features identified in the competitive analysis, organized into 5 atomic phases ordered from simplest to most complex. Each phase is independently mergeable and produces a usable result.

### Phase Summary

| Phase | Features | Est. Lines | Complexity |
|-------|----------|-----------|------------|
| 1 | Cloudflare Bot Retry, Cloudflare AI Gateway | ~40 | Trivial |
| 2 | Content Negotiation, Dynamic Guidance Injection | ~120 | Small |
| 3 | PDF OCR Fallback, Project Trust Gating, Large File Reorg | ~350 | Medium |
| 4 | Ollama Support, OpenAI Native Web Search | ~500 | Large |
| 5 | Interactive Setup, Activity Monitor Widget | ~700 | Complex |

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
  baseUrl?: string;              // default: "https://generativelanguage.googleapis.com"
  cloudflareApiKey?: string;     // injected as cf-aig-authorization when gateway detected
  allowBrowserCookies?: boolean;
  chromeProfile?: string;
}
```

**Detection logic:**
```
const isGateway = baseUrl.includes("aigateway") || baseUrl.includes("cloudflareai");
if (isGateway && cloudflareApiKey) {
  headers["cf-aig-authorization"] = `Bearer ${cloudflareApiKey}`;
}
```

**Tests:**
- Verify header injection when base URL contains "aigateway"
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

| Tool | Capability | Added Guideline |
|------|-----------|----------------|
| web_fetch | hasGhCli | "For GitHub repository URLs, consider using the `gh` CLI directly for richer file access." |
| web_fetch | hasYtDlp | "YouTube frame extraction is available (yt-dlp detected)." |
| web_fetch | hasFfmpeg | "Local video analysis with frame extraction is available (ffmpeg detected)." |

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

### 3a. PDF OCR Fallback via Gemini Vision

**Problem:** Scanned PDFs yield empty text from `unpdf` extraction. Pi-tools has no fallback for image-based PDFs.

**Solution:** When PDF text extraction yields < 100 characters from a multi-page PDF, rasterize pages and send to Gemini vision for OCR.

**New file: `src/extract/pdf-ocr.ts`**

```typescript
export interface PdfOcrOptions {
  maxPages: number;       // default: 5
  geminiApiKey: string;
  geminiBaseUrl?: string;
  model?: string;         // default: "gemini-2.5-flash"
}

// Returns extracted text from scanned PDF pages via vision API
export async function extractPdfWithOcr(
  pdfBuffer: Uint8Array,
  options: PdfOcrOptions,
  signal?: AbortSignal,
): Promise<string | null>;
```

**Logic:**
1. Render first N pages to PNG using pdf.js canvas (via `unpdf`'s underlying pdfjs-dist)
2. Encode each page as base64 PNG
3. Send to Gemini vision API with prompt: "Extract all text from these document pages. Preserve structure, headings, and paragraphs. Output as plain text."
4. Return concatenated response text
5. If Gemini call fails → return null (caller falls through to error)

**Integration in `pipeline.ts`:**
```
// After existing PDF extraction attempt:
if (text.length < 100 && pageCount > 1) {
  chain.push("pdf:thin");
  const geminiKey = resolveApiKey(geminiConfig?.apiKey);
  if (geminiKey) {
    const ocrText = await extractPdfWithOcr(buffer, {
      maxPages: pdfConfig?.ocrMaxPages ?? 5,
      geminiApiKey: geminiKey,
      geminiBaseUrl: geminiConfig?.baseUrl,
    }, signal);
    if (ocrText && ocrText.length > 100) {
      chain.push("pdf-ocr:gemini");
      return { text: ocrText, ... };
    }
    chain.push("pdf-ocr:fail");
  }
  throw new Error(`Could not extract content from ${url}. Tried: ${chain.join(" -> ")}`);
}
```

**Config additions:**
```typescript
// In PiToolsConfig:
pdf?: {
  ocrEnabled?: boolean;    // default: true
  ocrMaxPages?: number;    // default: 5
}
```

**Tests:**
- Mock a PDF buffer that yields empty text → OCR triggered
- Mock Gemini returning text → OCR result returned
- Mock Gemini failing → null returned, error thrown
- PDF with good text extraction → OCR NOT triggered
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

**Trust detection:**
- Primary: Check `process.env.PI_PROJECT_TRUSTED === "1"` (set by Pi framework for trusted workspaces)
- Fallback: Check if `.pi/trust` marker file exists in the project root
- Default: untrusted (safe default)

**New helper in `src/config.ts`:**
```typescript
const SENSITIVE_PATTERNS = [/\.apiKey$/, /\.apiSecret$/, /\.token$/, /^ssrf\.allowRanges$/, /^gemini\.(cloudflareApiKey|allowBrowserCookies)$/];

// Recursively removes fields matching SENSITIVE_PATTERNS from config object.
// Returns a shallow clone with sensitive keys omitted.
export function stripSensitiveFields(
  config: Record<string, unknown>,
): Record<string, unknown>;

export function isProjectTrusted(projectDir: string): boolean;
```

**Integration in `loadMergedConfig()`:**
```
// Layer 1: project config (highest priority)
if (cwd) {
  const projectPath = findProjectConfigPath(cwd);
  if (projectPath) {
    const raw = JSON.parse(fs.readFileSync(projectPath, "utf-8"));
    const trusted = isProjectTrusted(cwd);
    const sanitized = trusted ? raw : stripSensitiveFields(raw);
    if (!trusted && raw !== sanitized) {
      console.warn("[pi-tools] Untrusted project config: sensitive fields ignored. Trust the project to allow full config.");
    }
    merged = deepMerge(merged, sanitized);
  }
}
```

**Tests:**
- Untrusted project with apiKey in config → field stripped
- Trusted project with apiKey → field preserved
- Untrusted project with `guidance` → field preserved (non-sensitive)
- Trust detection via env var
- Trust detection via marker file

---

### 3c. Large File Organization (Refactoring)

**Problem:** `src/tools/web-fetch.ts` (448 lines) mixes single-URL logic, multi-URL orchestration, concurrency control, image collection, and rendering.

**Solution:** Extract multi-URL logic and the generic concurrency limiter into separate files.

**File changes:**

| Current | After | Responsibility |
|---------|-------|---------------|
| `src/tools/web-fetch.ts` (448 lines) | `src/tools/web-fetch.ts` (~200 lines) | Tool definition, single-URL path, buildResult, errorResult, rendering |
| (same file) | `src/tools/web-fetch-multi.ts` (~150 lines) | Multi-URL orchestration, deduplication, manifest mode, per-URL caps |
| (same file) | `src/utils/concurrency.ts` (~30 lines) | Generic `fetchWithConcurrencyLimit<T>()` |

**No behavioral changes.** Pure mechanical extraction. The `createWebFetchTool` factory in `web-fetch.ts` calls into `executeMultiUrl()` from `web-fetch-multi.ts` for the multi-URL path.

**Verification:** All existing `web-fetch.test.ts` and `web-fetch-video.test.ts` tests must pass without modification.

---

## Phase 4: Ollama & OpenAI Native

### 4a. Self-Hosted Ollama Support

**Problem:** Users wanting local-first web tooling without external API keys have no option. Ollama provides local LLM inference with optional vision capabilities.

**Solution:** Add Ollama as a tier-3 search provider and as an alternative extraction backend for vision tasks (PDF OCR, video analysis).

**New file: `src/providers/ollama.ts`**

```typescript
export function createOllamaProvider(config: OllamaConfig): {
  search?: SearchProvider;
  fetch?: FetchProvider;
} | null;
```

**Search Provider:**
- Uses Ollama's `/api/chat` endpoint with a system prompt instructing the model to generate search-like results from its knowledge
- Model: configurable (default: "llama3.1")
- Response parsed into `SearchResult[]` format (title, url, snippet)
- Caveat: Results are model-generated, not web-crawled. Quality depends on model's training data recency.
- Marked as tier 3 (lowest priority) — only used when all web-based providers are exhausted

**Extraction Backend:**
- Vision-capable models (llava, llama3.2-vision) for:
  - PDF OCR alternative (Phase 3a can route here instead of Gemini)
  - Video frame analysis alternative
- Endpoint: POST `{baseUrl}/api/chat` with base64 image attachments
- Acts as a drop-in alternative to Gemini vision calls

**Config additions:**
```typescript
// In PiToolsConfig:
ollama?: {
  enabled?: boolean;         // default: false (opt-in)
  baseUrl?: string;          // default: "http://localhost:11434"
  model?: string;            // default: "llama3.1"
  visionModel?: string;      // default: "llava"
  apiKey?: string;           // only for cloud Ollama instances
}
```

**Registration in `src/providers/all.ts`:**
- Added to `allProviders` array with `tier: 3`, `monthlyQuota: null`, `requiresKey: false`
- `create()` factory: check if Ollama is reachable (HEAD to baseUrl) before registering
- If unreachable: skip silently (no error, no provider registered)

**SSRF exception:** Ollama's `baseUrl` is exempt from SSRF validation (loopback is expected for local instances).

**Error handling:**
- Connection refused → helpful message: "Ollama not running. Start with `ollama serve`"
- Model not found → suggest: "Run `ollama pull llama3.1` to download the model"
- Timeout (30s default) → standard timeout error

**Tests:**
- Mock Ollama chat response → parsed into SearchResult[]
- Mock vision response → text extracted from image
- Connection refused → provider not registered (graceful)
- Invalid model → clear error message

---

### 4b. OpenAI Native Web Search Integration (Hybrid)

**Problem:** When running on OpenAI/Codex models that include built-in web search, pi-tools still uses its own providers (costing API quota). The native search is free and well-integrated with the model.

**Solution:** Register OpenAI native web search as a provider. On Codex models, route simple searches through the model's native capability. Advanced searches (fusion, domain filters) still use our provider pipeline.

**Relationship to existing `openai-codex` provider:** The existing `openai-codex.ts` provides code search via Pi-managed authentication. The new `openai-native.ts` is a separate search provider that uses OpenAI's Responses API with `web_search_preview` tool — a different endpoint and authentication path. They coexist without conflict.

**New file: `src/providers/openai-native.ts`**

```typescript
export function createOpenAiNativeProvider(apiKey: string, config?: OpenAiNativeConfig): {
  search: SearchProvider;
};
```

**Implementation:**
- Makes a POST to OpenAI's `/v1/responses` endpoint with:
  - `tools: [{ type: "web_search_preview" }]`
  - `input: query`
- Parses the response: extracts citations and text into `SearchResult[]`
- Each citation becomes a result: `{ title: annotation.title, url: annotation.url, snippet: surrounding_text }`

**Config additions:**
```typescript
// In ProviderConfigEntry (already exists for openai-codex):
// Uses existing "openai-codex" provider config or new:
"openai-native"?: {
  enabled: boolean;        // default: true when OPENAI_API_KEY available
  apiKey?: string;         // default: "OPENAI_API_KEY" env var
  model?: string;          // default: "gpt-4.1-mini" (cheapest with web search)
}
```

**Registration:**
- Tier 1 (highest priority when available)
- No monthly quota (pay-per-use)
- Requires: `OPENAI_API_KEY` environment variable or configured key

**Smart routing in `web_search` execute:**
```
// In the execute function:
const candidates = resolveCandidates(params.provider, combineActive);

// If "openai-native" is in candidates and search is "simple":
//   - No combine mode
//   - No domain filters
//   - No explicit provider override (or provider === "openai-native")
// Then: openai-native is first candidate (natural tier-1 ordering handles this)
```

Since openai-native is registered as tier 1, the existing `selectSearchCandidates()` logic already prioritizes it. No special routing needed — it naturally goes first.

**Fallback:** If OpenAI native fails (rate limit, API error), the existing fallback chain tries the next provider. Standard `executeWithFallback` handles this.

**Tests:**
- Mock OpenAI response with citations → parsed into SearchResult[]
- API error → fallback to next provider
- Domain filters present → openai-native still works (filters are best-effort server-side)
- Provider explicitly set to "brave" → openai-native not used

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
  updater: (config: Partial<PiToolsConfig>) => Partial<PiToolsConfig>
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

**Solution:** An event-driven activity monitor that collects request telemetry and renders a toggle-able panel via Pi's TUI.

**New files:**
- `src/monitor/types.ts` — event type definitions
- `src/monitor/event-bus.ts` — pub/sub event system
- `src/monitor/activity-store.ts` — ring buffer for recent events
- `src/monitor/widget.ts` — TUI rendering

**Event types:**
```typescript
interface RequestStartEvent {
  id: string;
  type: "search" | "fetch" | "extract";
  provider: string;
  target: string;         // query or URL
  timestamp: number;
}

interface RequestEndEvent {
  id: string;
  provider: string;
  latencyMs: number;
  status: "success" | "error";
  statusCode?: number;
  resultCount?: number;
  bytes?: number;
}
```

**EventBus (singleton):**
```typescript
class ActivityEventBus {
  private listeners: Set<(event: ActivityEvent) => void>;
  emit(event: ActivityEvent): void;
  subscribe(listener: (event: ActivityEvent) => void): () => void;  // returns unsubscribe
}

export const activityBus = new ActivityEventBus();
```

**ActivityStore (ring buffer):**
```typescript
class ActivityStore {
  private events: ActivityEvent[] = [];  // max 50
  private providerStats: Map<string, { ok: number; fail: number; avgMs: number }>;
  
  record(event: ActivityEvent): void;
  getRecent(n?: number): ActivityEvent[];
  getProviderSummary(): Map<string, ProviderActivitySummary>;
}
```

**Instrumentation points (emit events from existing code):**

| Location | Event |
|----------|-------|
| `src/providers/execute.ts` (executeWithFallback) | request_start, request_end |
| `src/providers/fusion.ts` (executeWithFusion) | request_start per provider, request_end per provider |
| `src/extract/pipeline.ts` (HTTP fetch) | request_start, request_end |
| `src/extract/gemini-api.ts` (Gemini calls) | request_start, request_end |

**Widget rendering:**
```
┌─ Activity ──────────────────────────────────────────┐
│ 14:23:01  brave     search "react hooks"   234ms  OK │
│ 14:23:02  http:200  fetch  example.com      89ms  OK │
│ 14:23:03  exa       search "typescript"       --  429│
│─────────────────────────────────────────────────────── │
│ Session: brave(3 OK) exa(1 FAIL) jina(2 OK)          │
└───────────────────────────────────────────────────────┘
```

**Toggle via `/tools monitor on|off`:**
- `on`: Create ActivityStore, subscribe to EventBus, register widget with Pi TUI
- `off`: Unsubscribe, deregister widget
- Default: off (opt-in per session)

**Pi TUI integration strategy:**
- Primary: Use `pi.registerWidget()` if available in the ExtensionAPI
- Fallback: If widget API not available, use `ctx.ui.notify()` to output last N events on toggle
- Investigation needed: Determine exact Pi TUI widget registration API during implementation

**Performance considerations:**
- EventBus is synchronous fire-and-forget (no await)
- Ring buffer caps at 50 events (no memory growth)
- Widget re-renders only on new events (no polling)
- When monitor is off, events still emit (other consumers could listen) but store doesn't accumulate

**Tests:**
- EventBus: emit → listener called
- ActivityStore: ring buffer eviction at capacity
- ActivityStore: provider summary aggregation
- Widget rendering: format matches expected output
- Toggle on/off: subscribe/unsubscribe lifecycle

---

## Cross-Cutting Concerns

### Testing Strategy

Each phase adds tests for its new functionality. No phase should break existing tests.

| Phase | New Test Files | Existing Tests Modified |
|-------|---------------|------------------------|
| 1 | `tests/extract/cloudflare.test.ts` | None |
| 2 | `tests/extract/head-probe.test.ts`, `tests/utils/capabilities.test.ts` | None |
| 3 | `tests/extract/pdf-ocr.test.ts`, `tests/config-trust.test.ts` | `tests/tools/web-fetch.test.ts` (import path changes) |
| 4 | `tests/providers/ollama.test.ts`, `tests/providers/openai-native.test.ts` | None |
| 5 | `tests/commands/tools-setup.test.ts`, `tests/commands/tools-subcommands.test.ts`, `tests/monitor/*.test.ts` | `tests/commands/tools.test.ts` (updated for new arg parsing) |

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
  gemini?: GeminiConfig;          // Phase 1b adds gatewayBaseUrl awareness
  youtube?: YouTubeConfig;
  video?: VideoConfig;

  // New (added by phases)
  pdf?: PdfConfig;                // Phase 3a
  ollama?: OllamaConfig;         // Phase 4a
}
```

### Dependency Changes

| Phase | New Dependencies | Reason |
|-------|-----------------|--------|
| 1-2 | None | Uses existing Node APIs |
| 3a | None | Uses existing unpdf + Gemini API |
| 3b-3c | None | Pure logic |
| 4 | None | HTTP calls to Ollama/OpenAI (no SDK) |
| 5 | None | Uses existing Pi TUI framework |

No new npm dependencies across all 5 phases. All features use `fetch()`, existing libraries, or Pi's framework APIs.

### Migration & Backward Compatibility

- All new config fields are optional with defaults matching current behavior
- No existing tool names, parameters, or behaviors change
- Phase 3c (file reorg) changes import paths internally but exports remain stable
- Users who don't configure new features experience zero changes
