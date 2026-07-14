# Content Extraction & YouTube/Video Design

Port content extraction enhancements, YouTube transcript extraction, and local video analysis from `pi-web-access` into `pi-tools`.

## Decisions

| Decision         | Choice                         | Rationale                                                                      |
| ---------------- | ------------------------------ | ------------------------------------------------------------------------------ |
| Feature scope    | Full port                      | YouTube transcripts, local video analysis, frame extraction, thumbnails        |
| Gemini auth      | Both modes                     | Cookie-auth Web (primary, free) + API key (fallback)                           |
| Gemini for HTML  | Yes                            | Add as fallback tier after Jina Reader for JS-heavy pages                      |
| Interface        | Extend flat                    | Add optional `thumbnail?`, `frames?`, `duration?` to existing ExtractedContent |
| Tool surface     | Extend web_fetch + auto-detect | Single tool, detects YouTube/video URLs, optional video params                 |
| Gemini placement | src/extract/ (flat)            | Alongside existing extractors                                                  |
| Config           | Extend existing                | Add youtube/video/gemini sections to main config                               |
| Cookie gate      | Both paths                     | Config field OR env var enables cookie extraction                              |

## Architecture

### New Modules

```
src/extract/
├── pipeline.ts          # MODIFIED — YouTube/video routing + Gemini HTML fallback
├── youtube.ts           # NEW — YouTube transcript + thumbnail extraction
├── video.ts             # NEW — Local video analysis (Files API upload + Gemini query)
├── frames.ts            # NEW — Frame extraction (ffmpeg/yt-dlp)
├── gemini-api.ts        # NEW — Gemini REST API client (generateContent only)
├── gemini-web.ts        # NEW — Gemini Web client (cookie-auth, single queryWithCookies fn)
├── chrome-cookies.ts    # NEW — Chromium cookie extraction (gated)
└── perplexity.ts        # NEW — Perplexity chat completion for YouTube fallback
```

### Modified Files

- `src/extract/pipeline.ts` — Add YouTube/video detection at top of chain; Gemini as HTML fallback after Jina
- `src/config.ts` — Add `youtube`, `video`, `gemini` config sections + `GEMINI_API_KEY` to FALLBACK_ENV_MAP
- `src/tools/web-fetch.ts` — Add `prompt`, `timestamp`, `frames`, `model` parameters; return ImageContent for thumbnails/frames

### Extraction Pipeline (Updated)

```
extractContent(url, signal, options)
  │
  ├─→ Has timestamp/frames params?
  │   ├─→ YouTube URL? → frames.ts (yt-dlp + ffmpeg)
  │   └─→ Local video path? → frames.ts (ffmpeg)
  │
  ├─→ Local video file? → video.ts (Gemini API Files → Gemini Web fallback)
  │
  ├─→ YouTube URL? → youtube.ts (Gemini Web → Gemini API → Perplexity)
  │
  ├─→ GitHub URL? → github.ts (existing 3-tier)
  │
  └─→ HTTP fetch (existing)
      ├─→ PDF? → pdf.ts (existing)
      ├─→ HTML? → html.ts → rsc.ts → jina-reader.ts → gemini-web.ts → raw strip
      └─→ Text/JSON? → direct return
```

## Data Model

### VideoFrame

```typescript
export interface VideoFrame {
  data: string; // base64-encoded JPEG
  mimeType: string; // "image/jpeg"
  timestamp: string; // formatted: "1:23:45" or "0:05:30"
}
```

### ExtractedContent (Extended)

```typescript
export interface ExtractedContent {
  // Existing fields (unchanged)
  text: string;
  title?: string;
  url: string;
  extractionChain: string[];
  chars: number;
  truncated: boolean;
  contentId?: string;
  // New video fields
  thumbnail?: { data: string; mimeType: string };
  frames?: VideoFrame[];
  duration?: number; // video duration in seconds
}
```

### ExtractOptions (Extended)

The current interface is `{ raw?, github?: GitHubConfig, allowRanges?: string[] }`. Extended with video fields:

```typescript
export interface ExtractOptions {
  // Existing (unchanged)
  raw?: boolean;
  github?: GitHubConfig;
  allowRanges?: string[];
  // New video options
  prompt?: string; // question/instruction for video analysis
  timestamp?: string; // frame extraction: "1:23:45", "23:41-25:00", "85"
  frames?: number; // number of frames to extract (1-12)
  model?: string; // Gemini model override
}
```

### Extraction Chain Values

- `"youtube:gemini-web"` — Gemini Web cookie auth
- `"youtube:gemini-api"` — Gemini API key
- `"youtube:perplexity"` — Perplexity text fallback
- `"video:gemini-api"` — Local video via Files API
- `"video:gemini-web"` — Local video via Gemini Web
- `"frames:youtube"` — YouTube frame extraction
- `"frames:local"` — Local video frame extraction
- `"html:gemini-web"` — Gemini Web as HTML fallback
- `"html:gemini-api"` — Gemini API URL-based as HTML fallback

## Gemini Clients

### gemini-api.ts

Thin Gemini REST API client. Mirrors pi-web-access `gemini-api.ts` design:

**Exports:**

- `getApiKey(): string | null` — resolve from config or `GEMINI_API_KEY` env var
- `getApiHost(): string` — custom base URL or default `https://generativelanguage.googleapis.com`
- `isGeminiApiAvailable(): boolean` — key or Cloudflare gateway configured
- `queryGeminiApi(prompt: string, videoUri: string, options?: GeminiApiOptions): Promise<string>` — core generation. Sends prompt + file/URL URI to Gemini's generateContent endpoint. Used for both YouTube URLs and uploaded local video file URIs.
- `buildAuthHeaders(): Record<string, string>` — Cloudflare AI Gateway headers if applicable

**GeminiApiOptions:**

```typescript
interface GeminiApiOptions {
  model?: string; // default: "gemini-3-flash-preview"
  mimeType?: string; // for uploaded files
  signal?: AbortSignal;
  timeoutMs?: number; // default: 120000
}
```

**Key design notes:**

- For YouTube: passes the YouTube URL directly as `videoUri` — Gemini processes it server-side (no download)
- For local video: receives a Gemini Files API URI (e.g., `files/abc123`) after upload
- For HTML fallback: passes the page URL as `videoUri` for URL Context extraction
- Supports Cloudflare AI Gateway routing via `GOOGLE_GEMINI_BASE_URL` + `CLOUDFLARE_API_KEY`
- Does NOT handle file uploads — that logic lives in `video.ts`

### gemini-web.ts

Gemini Web client using browser cookie authentication. Mirrors pi-web-access design:

**Exports:**

- `isGeminiWebAvailable(chromeProfile?: string): Promise<CookieMap | null>` — checks cookies enabled + valid cookies exist
- `queryWithCookies(prompt: string, cookies: CookieMap, options?: GeminiWebOptions): Promise<string>` — single function for all Gemini Web interactions

**GeminiWebOptions:**

```typescript
interface GeminiWebOptions {
  youtubeUrl?: string; // appended to prompt for YouTube extraction
  files?: string[]; // local file paths to upload for analysis
  model?: string; // "gemini-2.5-flash" (default), "gemini-2.5-pro", "gemini-3-pro"
  signal?: AbortSignal;
  timeoutMs?: number; // default: 120000
}
```

**Key design notes:**

- Single `queryWithCookies` function handles all modes (YouTube URL, file upload, plain prompt)
- Cookies obtained separately via `isGeminiWebAvailable()` → null means unavailable
- Only supports specific models with known header IDs: `"gemini-3-pro"`, `"gemini-2.5-pro"`, `"gemini-2.5-flash"`. Unknown models fall back to `"gemini-2.5-flash"`.
- Model fallback: if requested model returns unavailable error, retries with `"gemini-2.5-flash"`
- Streams response via BardChatUi StreamGenerate endpoint
- Fetches access token from gemini.google.com app page
- Gated: `isGeminiWebAvailable()` returns null unless cookies enabled AND valid cookies present

### chrome-cookies.ts

Cookie extraction from Chromium-based browsers:

- Uses `node:sqlite` (dynamic import with experimental warning suppression) for SQLite queries
- Uses `node:crypto` (`pbkdf2Sync` + `createDecipheriv` AES-128-CBC) for cookie decryption
- macOS: reads password from Keychain via `security find-generic-password`
- Linux: reads from `secret-tool` (GNOME Keyring)
- Supports browsers: Chrome, Arc, Helium (macOS); Chrome, Chromium (Linux)
- Copies cookie DB to temp dir before querying (avoids locking active browser DB)
- Handles Chrome cookie DB v24+ hash-prefixed values
- Returns `{ cookies: CookieMap, warnings: string[] } | null`
- Required cookies for Gemini: `__Secure-1PSID`, `__Secure-1PSIDTS`
- No network requests — purely local file reads + decryption

### perplexity.ts

Perplexity chat completion for YouTube text-only fallback:

**Exports:**

- `isPerplexityAvailable(): boolean` — checks `PERPLEXITY_API_KEY` env var or config
- `queryPerplexity(query: string, signal?: AbortSignal): Promise<string>` — calls Perplexity `chat/completions` with `model: "sonar"`, returns the answer text

**Key design notes:**

- Direct API call to `https://api.perplexity.ai/chat/completions` — NOT via the ProviderRegistry
- Uses the Perplexity API key from pi-tools' existing credential resolution (`FALLBACK_ENV_MAP` already includes perplexity)
- Returns the raw answer string, not SearchResult[]
- Different from pi-tools' existing Perplexity search provider which wraps answers as SearchResult with 500-char truncation
- Only used as last-resort YouTube fallback — returns text summary, no visual understanding

### Fallback Order

1. Gemini Web (free, no key, requires cookies + opt-in)
2. Gemini API (requires key, reliable, metered)
3. Feature-specific fallback (Perplexity chat for YouTube, skip for video)

## YouTube Extraction

### URL Detection

Regex: `/(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?.*v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/`

Excludes playlist URLs (`/playlist` path).

Exports `isYouTubeURL(url): { isYouTube: boolean; videoId: string | null }`

Canonicalizes to `https://www.youtube.com/watch?v={videoId}`

### Default Prompt

```
Extract the complete content of this YouTube video. Include:
1. Video title, channel name, and duration
2. A brief summary (2-3 sentences)
3. Full transcript with timestamps
4. Descriptions of any code, terminal commands, diagrams, slides, or UI shown on screen

Format as markdown.
```

Custom `prompt` from ExtractOptions replaces the default for focused analysis.

### Function Signature

```typescript
export async function extractYouTube(
  url: string,
  signal?: AbortSignal,
  options?: ExtractOptions,
): Promise<ExtractedContent | null>;
```

### Fallback Chain

1. **Gemini Web** (cookie-auth) — `isGeminiWebAvailable()` → `queryWithCookies(prompt, cookies, { youtubeUrl })`
2. **Gemini API** — `queryGeminiApi(prompt, youtubeUrl, { model })` — passes YouTube URL directly
3. **Perplexity** — `queryPerplexity("Summarize this YouTube video: {url}", signal)` — text-only, last resort

### Thumbnail

- Fetched from `https://img.youtube.com/vi/{videoId}/hqdefault.jpg`
- Converted to base64, stored in `result.thumbnail`
- Non-blocking — failure does not affect transcript extraction
- Only fetched on successful extraction (not on error)

### Return

- `text`: Full transcript/analysis markdown
- `title`: Extracted from first heading in response, or "YouTube Video"
- `extractionChain`: e.g. `["youtube:gemini-web"]`
- `thumbnail`: `{ data: base64, mimeType: "image/jpeg" }`
- `duration`: Video duration in seconds (if available from response)

## Local Video Extraction

### File Detection (Two-Step Pattern)

Step 1 — Detection: `isVideoFile(input: string): VideoFileInfo | null`

```typescript
interface VideoFileInfo {
  absolutePath: string;
  mimeType: string;
  sizeBytes: number;
}
```

- Matches paths starting with `/`, `./`, `../`, or `file://`
- Checks extension against supported formats: `.mp4`, `.mov`, `.webm`, `.avi`, `.mpeg`, `.mpg`, `.wmv`, `.flv`, `.3gp`
- Validates file exists and size is within `video.maxSizeMB` limit
- Handles Unicode space normalization in filenames
- Returns null if disabled, wrong extension, not found, or too large

Step 2 — Extraction: `extractVideo(info: VideoFileInfo, signal?, options?)`

### Default Prompt

```
Extract the complete content of this video. Include:
1. Video title (infer from content if not explicit), duration
2. A brief summary (2-3 sentences)
3. Full transcript with timestamps
4. Descriptions of any code, terminal commands, diagrams, slides, or UI shown on screen

Format as markdown.
```

Custom `prompt` overrides the default.

### Function Signature

```typescript
export async function extractVideo(
  info: VideoFileInfo,
  signal?: AbortSignal,
  options?: ExtractOptions,
): Promise<ExtractedContent | null>;
```

### Fallback Chain

1. **Gemini API (Files API)** — upload via resumable protocol, poll until ACTIVE, query with file URI, cleanup
2. **Gemini Web** — `queryWithCookies(prompt, cookies, { files: [info.absolutePath] })`

### Files API Upload (in video.ts, not gemini-api.ts)

```typescript
async function uploadToFilesApi(
  info: VideoFileInfo,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ name: string; uri: string }>;
```

1. POST to `https://generativelanguage.googleapis.com/upload/v1beta/files` with resumable upload headers
2. PUT file data to returned upload URL
3. Returns `{ name, uri }` for subsequent generateContent call

```typescript
async function pollFileState(
  fileName: string,
  apiKey: string,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<void>;
```

- Polls GET `/{fileName}` every 5s until `state === "ACTIVE"`
- Throws on `"FAILED"` state or timeout (default 120s)

```typescript
function deleteGeminiFile(fileName: string, apiKey: string): void;
```

- Fire-and-forget DELETE (errors logged, not thrown)

### Auto-Thumbnail

After successful extraction, extracts a single frame at t=1s via ffmpeg as thumbnail. Stored in `result.thumbnail`. Non-blocking — ffmpeg failure doesn't affect the text result.

### Size Limit

`video.maxSizeMB` (default 50MB). Checked during `isVideoFile()` detection — oversized files return null (never reach extraction).

### Error Cases

- File not found → `isVideoFile()` returns null, pipeline skips video path
- File too large → same (null from detection)
- Upload timeout → return null (pipeline falls through)
- Gemini processing fails → return null
- Both Gemini modes fail → return null

## Frame Extraction

### Exported Functions

```typescript
export async function extractYouTubeFrames(
  videoId: string,
  timestamps: number[],
  signal?: AbortSignal,
): Promise<{
  frames: VideoFrame[];
  duration: number | null;
  error: string | null;
}>;

export async function extractLocalFrames(
  filePath: string,
  timestamps: number[],
  signal?: AbortSignal,
): Promise<{
  frames: VideoFrame[];
  duration: number | null;
  error: string | null;
}>;

export function parseTimestampParam(
  timestamp: string | undefined,
  frames?: number,
  duration?: number,
): number[];

export async function getYouTubeStreamInfo(
  videoId: string,
): Promise<{ streamUrl: string; duration: number | null } | { error: string }>;

export async function getLocalVideoDuration(
  filePath: string,
): Promise<number | { error: string }>;
```

### Timestamp Parsing

- Single: `"1:23:45"` → `[5025]`, `"23:45"` → `[1425]`, `"85"` → `[85]`
- Range: `"23:41-25:00"` → evenly-spaced array (default 6 frames, or `frames` param)
- Single + frames: `"5:00"` + `frames: 3` → `[300, 305, 310]` (5s intervals)
- Frames only (no timestamp): sample evenly across entire video duration

### YouTube Frame Pipeline

1. `yt-dlp --print duration -g {url}` → stream URL + duration (15s timeout)
2. Per timestamp: `ffmpeg -ss {t} -i {streamUrl} -frames:v 1 -f image2pipe -vcodec mjpeg pipe:1`
3. Capture stdout buffer → base64 encode (maxBuffer: 5MB, timeout: 30s per frame)
4. Return VideoFrame[] with `formatSeconds(t)` timestamps

### Local Frame Pipeline

1. `ffprobe -v quiet -show_entries format=duration -of csv=p=0 {filePath}` → duration (10s timeout)
2. Per timestamp: `ffmpeg -ss {t} -i {filePath} -frames:v 1 -f image2pipe -vcodec mjpeg pipe:1`
3. Same base64 encoding

### Constraints

- Max 12 frames per request
- Each frame ~100-200KB as JPEG
- Requires ffmpeg in PATH (graceful error if missing)
- YouTube requires yt-dlp in PATH (graceful error if missing)
- Per-frame timeout: 30s. yt-dlp timeout: 15s.

### Graceful Degradation

- ffmpeg not installed → error: "ffmpeg required for frame extraction" (ENOENT detection)
- yt-dlp not installed → error: "yt-dlp is not installed. Install with: brew install yt-dlp"
- Private/unavailable video → descriptive error from yt-dlp stderr
- Individual frame fails → skip, return partial results
- Partial success is acceptable — return whatever frames succeeded

## Gemini HTML Fallback

### Position in Chain

```
HTML → Readability+Turndown → RSC parser → Jina Reader → Gemini → raw strip
```

### Behavior

When Readability produces < 500 chars and RSC/Jina fail:

1. **Gemini Web** (if cookies available) — `queryWithCookies(prompt, cookies, {})` with page URL in prompt
2. **Gemini API** (if API key available) — `queryGeminiApi(prompt, pageUrl, { model })` using URL Context

### Prompt

```
Extract the main readable content from this web page. Return it as clean markdown.
Ignore navigation, ads, footers, and sidebars. Focus on the primary article or content.
```

### Conditions to Attempt

- Previous tiers produced < 500 chars
- Gemini is configured (API key OR cookies enabled)
- URL is not binary content type

### Not Attempted When

- Readability produced good content (>= 500 chars)
- URL is GitHub (dedicated extractor)
- URL is a video (video pipeline)
- Gemini not configured

## Configuration

### Schema

```typescript
interface PiToolsConfig {
  // existing fields (unchanged)
  defaultProvider: string;
  selectionStrategy: SelectionStrategy;
  providers: Record<string, ProviderConfigEntry>;
  github: GitHubConfig;
  guidance?: Record<string, GuidanceOverride>;
  ssrf: SsrfConfig;
  combine: CombineConfig;
  deepResearch: DeepResearchConfig;

  // New sections
  gemini?: {
    apiKey?: string; // or GEMINI_API_KEY env var / !shell command
    baseUrl?: string; // default: "https://generativelanguage.googleapis.com"
    cloudflareApiKey?: string; // for Cloudflare AI Gateway routing
    allowBrowserCookies?: boolean; // default: false; also PI_ALLOW_BROWSER_COOKIES=1
    chromeProfile?: string; // Chrome profile name (default: "Default")
  };

  youtube?: {
    enabled?: boolean; // default: true
    preferredModel?: string; // default: "gemini-3-flash-preview"
  };

  video?: {
    enabled?: boolean; // default: true
    preferredModel?: string; // default: "gemini-3-flash-preview"
    maxSizeMB?: number; // default: 50
  };
}
```

### Key Resolution

Uses existing `resolveApiKey()` function:

1. Config field `gemini.apiKey` (string or `!op read ...` shell command)
2. Environment variable `GEMINI_API_KEY` (add to `FALLBACK_ENV_MAP`)
3. Cookie-auth only mode (if enabled and no key found)

### Cookie Auth Enablement

Either path enables cookie extraction:

- Config: `gemini.allowBrowserCookies: true`
- Environment: `PI_ALLOW_BROWSER_COOKIES=1`

### Behavior When Unconfigured

- No API key + no cookies → YouTube/video extraction returns null, falls through
- YouTube URLs with no Gemini → Perplexity fallback if available, else treated as regular HTML page
- Local video with no Gemini → `isVideoFile()` still detects it but extraction returns null

### Example Config

```json
{
  "providers": {},
  "gemini": {
    "apiKey": "!op read op://dev/gemini/api-key",
    "allowBrowserCookies": true,
    "chromeProfile": "Default"
  },
  "youtube": {
    "enabled": true,
    "preferredModel": "gemini-3-flash-preview"
  },
  "video": {
    "enabled": true,
    "maxSizeMB": 100
  }
}
```

## web_fetch Tool Extension

### Current Parameters (unchanged)

```typescript
url: Type.Optional(Type.String({ description: "HTTP(S) URL to fetch" })),
urls: Type.Optional(Type.Array(Type.String(), { maxItems: 20, description: "Multiple URLs to fetch concurrently" })),
raw: Type.Optional(Type.Boolean({ default: false, description: "Return raw HTTP body without extraction" })),
fresh: Type.Optional(Type.Boolean({ default: false, description: "Bypass content cache" })),
```

### New Parameters (added)

```typescript
prompt: Type.Optional(Type.String({
  description: "Question or instruction for video/YouTube analysis. Pass the user's specific question to focus extraction."
})),
timestamp: Type.Optional(Type.String({
  description: "Extract frame(s): '1:23:45' (single), '23:41-25:00' (range). Requires ffmpeg + yt-dlp."
})),
frames: Type.Optional(Type.Integer({
  minimum: 1, maximum: 12,
  description: "Number of frames to extract. Combine with timestamp for density, or alone to sample entire video."
})),
model: Type.Optional(Type.String({
  description: "Override Gemini model for video/YouTube analysis (e.g. 'gemini-2.5-flash', 'gemini-3-flash-preview')."
})),
```

### Auto-Detection Behavior

- YouTube URL without video params → automatic transcript with default prompt
- YouTube URL with `prompt` → focused analysis
- YouTube URL with `timestamp`/`frames` → frame extraction mode
- Local video path (starts with `/`, `./`, `../`) → video analysis with Gemini
- Regular HTTP URL → existing extraction (video params ignored)
- `prompt` on non-video URL → ignored (no-op)

### Image Rendering in Tool Results

Pi core's `AgentToolResult.content` supports `(TextContent | ImageContent)[]`. When extraction returns thumbnails or frames:

```typescript
// In tool execute():
const result: AgentToolResult = {
  content: [
    { type: "text", text: extractedContent.text },
    // Include thumbnail as ImageContent (rendered in terminal)
    ...(extractedContent.thumbnail ? [{
      type: "image" as const,
      data: extractedContent.thumbnail.data,
      mimeType: extractedContent.thumbnail.mimeType,
    }] : []),
    // Include frames as ImageContent
    ...(extractedContent.frames?.map(f => ({
      type: "image" as const,
      data: f.data,
      mimeType: f.mimeType,
    })) ?? []),
  ],
  details: { ... },
};
```

Images are automatically rendered in supported terminals (Kitty, iTerm2, WezTerm, Ghostty) and sent to the LLM as image content.

### Tool Description (updated)

```
Fetch URL(s) and extract readable content as markdown. Supports web pages,
PDFs, GitHub repositories, YouTube videos (transcripts + thumbnails), and
local video files. For YouTube/video: pass a specific question via `prompt`
to focus extraction on what matters. Frame extraction requires ffmpeg/yt-dlp.
```

## Storage Considerations

`ContentStore` currently persists only `{ url, title, text, chars, source }`. Binary data (thumbnails, frames) is NOT persisted in storage — it flows directly through the tool result to the LLM and terminal.

The `ContentCache` (in-memory LRU) stores the full `ExtractedContent` including optional video fields, so repeated fetches within a session return cached thumbnails/frames. This is acceptable since cache lifetime is session-scoped.

## Testing

### New Test Files

```
tests/extract/
├── youtube.test.ts
├── video.test.ts
├── frames.test.ts
├── gemini-api.test.ts
├── gemini-web.test.ts
├── chrome-cookies.test.ts
├── perplexity.test.ts
└── pipeline.test.ts      # MODIFIED
tests/tools/
└── web-fetch.test.ts     # MODIFIED
```

### Testing Approach

- All external calls mocked via `stubFetch()` and `stubExec()`
- Cookie extraction tested with fixture SQLite databases (mock `node:sqlite`)
- Frame extraction tested by mocking `execFileSync` (return fixture JPEG buffers)
- YouTube URL detection tested with comprehensive URL patterns (watch, shorts, live, embed, youtu.be, playlists excluded)
- Fallback chains tested by simulating tier failures (each try\* function returns null)
- Gemini Web model fallback tested (unavailable model → retry with gemini-2.5-flash)

### Error Handling Strategy

- Network errors (timeout, 429, 500) → return null, let next fallback handle
- Missing tools (ffmpeg, yt-dlp) → descriptive error in text field with install instructions
- Config errors (no key + no cookies) → skip silently, fall through
- File errors (too large, not found) → `isVideoFile()` returns null, pipeline skips
- Partial success (some frames extracted) → return partial + error note
- Cookie expiry → Gemini Web returns error → fall through to Gemini API
- Rate limits → Perplexity has built-in rate limit tracking (10 req/min)

### Graceful Degradation Principle

Video features are additive. If Gemini is not configured, the tool works for everything else. No existing functionality breaks. The pipeline falls through gracefully at each detection point.

## External Dependencies

### Required (already in pi-tools)

- `@mozilla/readability` — HTML extraction
- `linkedom` — DOM parsing
- `turndown` — HTML to Markdown
- `unpdf` — PDF extraction

### Optional System Tools

- `ffmpeg` / `ffprobe` — Frame extraction and video duration (graceful error if missing)
- `yt-dlp` — YouTube stream URLs for frame extraction (graceful error if missing)

### No New npm Dependencies Required

- Gemini API client: thin HTTP wrapper using native `fetch`
- Cookie decryption: `node:crypto` (pbkdf2Sync + createDecipheriv)
- Cookie database: `node:sqlite` (dynamic import, available in Node >= 22.5, stable in >= 24.15 which this project requires)
- Keychain access (macOS): `security` CLI via `node:child_process`
- Secret storage (Linux): `secret-tool` CLI via `node:child_process`
