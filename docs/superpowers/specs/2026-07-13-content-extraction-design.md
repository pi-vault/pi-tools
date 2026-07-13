# Content Extraction & YouTube/Video Design

Port content extraction enhancements, YouTube transcript extraction, and local video analysis from `pi-web-access` into `pi-tools`.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Feature scope | Full port | YouTube transcripts, local video analysis, frame extraction, thumbnails |
| Gemini auth | Both modes | Cookie-auth Web (primary, free) + API key (fallback) |
| Gemini for HTML | Yes | Add as fallback tier after Jina Reader for JS-heavy pages |
| Interface | Extend flat | Add optional `thumbnail?`, `frames?`, `duration?` to existing ExtractedContent |
| Tool surface | Extend web_fetch + auto-detect | Single tool, detects YouTube/video URLs, optional video params |
| Gemini placement | src/extract/ (flat) | Alongside existing extractors |
| Config | Extend existing | Add youtube/video/gemini sections to main config |
| Cookie gate | Both paths | Config field OR env var enables cookie extraction |

## Architecture

### New Modules

```
src/extract/
├── pipeline.ts          # MODIFIED — YouTube/video routing + Gemini HTML fallback
├── youtube.ts           # NEW — YouTube transcript + thumbnail extraction
├── video.ts             # NEW — Local video analysis via Gemini Files API
├── frames.ts            # NEW — Frame extraction (ffmpeg/yt-dlp)
├── gemini-api.ts        # NEW — Gemini REST API client
├── gemini-web.ts        # NEW — Gemini Web client (cookie-auth)
└── chrome-cookies.ts    # NEW — Chromium cookie extraction (gated)
```

### Modified Files

- `src/extract/pipeline.ts` — Add YouTube/video detection at top of chain; Gemini as HTML fallback after Jina
- `src/config.ts` — Add `youtube`, `video`, `gemini` config sections
- `src/tools/web-fetch.ts` — Add `prompt`, `timestamp`, `frames`, `model` parameters

### Extraction Pipeline (Updated)

```
extractContent(url, signal, options)
  │
  ├─→ Has timestamp/frames params?
  │   ├─→ YouTube URL? → frames.ts (yt-dlp + ffmpeg)
  │   └─→ Local video path? → frames.ts (ffmpeg)
  │
  ├─→ Local video file? → video.ts (Gemini Files API → Gemini Web fallback)
  │
  ├─→ YouTube URL? → youtube.ts (Gemini Web → Gemini API → Perplexity)
  │
  ├─→ GitHub URL? → github.ts (existing 3-tier)
  │
  └─→ HTTP fetch
      ├─→ PDF? → pdf.ts (existing)
      ├─→ HTML? → html.ts → rsc.ts → jina-reader.ts → gemini-web.ts → raw strip
      └─→ Text/JSON? → direct return
```

## Data Model

### VideoFrame

```typescript
export interface VideoFrame {
  data: string;        // base64-encoded JPEG
  mimeType: string;    // "image/jpeg"
  timestamp: string;   // formatted: "1:23:45" or "0:05:30"
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
  duration?: number;  // video duration in seconds
}
```

### ExtractOptions (Extended)

```typescript
export interface ExtractOptions {
  // Existing
  timeoutMs?: number;
  forceClone?: boolean;
  // New video options
  prompt?: string;      // question/instruction for video analysis
  timestamp?: string;   // frame extraction: "1:23:45", "23:41-25:00", "85"
  frames?: number;      // number of frames to extract (1-12)
  model?: string;       // Gemini model override
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
- `"html:gemini-url-context"` — Gemini URL Context API

## Gemini Clients

### gemini-api.ts

Gemini REST API client:

- `generateContent(model, contents, config, signal)` — Core generation endpoint. Text prompts + URL/file references.
- `uploadFile(filePath, mimeType, signal)` — Resumable upload to Files API for local video. Polls until state = ACTIVE.
- `deleteFile(fileUri)` — Cleanup after video analysis.
- Uses `GEMINI_API_KEY` from config (resolved via existing credential system).
- Supports `gemini.baseUrl` for Cloudflare AI Gateway or custom endpoints.
- Timeout: configurable per-request, default 120s for video analysis.

### gemini-web.ts

Gemini Web client (cookie-auth):

- `generateFromUrl(url, prompt, model, signal)` — URL + prompt for analysis (YouTube, HTML pages).
- `generateFromFile(filePath, prompt, model, signal)` — Upload + analyze local file.
- Authenticates via cookies from Chromium browsers.
- Falls back gracefully if cookies expired/missing (returns null).
- Gated: active only when `gemini.allowBrowserCookies: true` OR `PI_ALLOW_BROWSER_COOKIES=1`.

### chrome-cookies.ts

Cookie extraction:

- Reads cookies from Chrome/Chromium/Edge stores on disk.
- macOS: Keychain-encrypted SQLite. Linux: DPAPI or plaintext SQLite.
- Returns cookies for `gemini.google.com` domain.
- Caches decrypted cookies in memory (session lifetime).
- No network requests — local file reads + decryption only.

### Fallback Order

1. Gemini Web (free, no key, requires cookies + opt-in)
2. Gemini API (requires key, reliable, metered)
3. Feature-specific fallback (Perplexity for YouTube, skip for video)

## YouTube Extraction

### URL Detection

Matches: `youtube.com/watch`, `youtu.be/`, `youtube.com/shorts/`, `youtube.com/live/`

Exports `isYouTubeURL(url): { videoId: string } | null`

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
): Promise<ExtractedContent | null>
```

### Fallback Chain

1. Gemini Web (cookie-auth) — free, best quality
2. Gemini API — reliable, requires key
3. Perplexity — text-only summary. Accessed via ProviderRegistry: if a Perplexity search provider is registered (user has key configured), call its search with the video URL as query. Returns snippet-level text only, no visual understanding.

### Thumbnail

- Fetched from `https://img.youtube.com/vi/{videoId}/hqdefault.jpg`
- Converted to base64, stored in `result.thumbnail`
- Non-blocking — failure does not affect transcript extraction

### Return

- `text`: Full transcript/analysis markdown
- `title`: Video title
- `extractionChain`: e.g. `["youtube:gemini-web"]`
- `thumbnail`: `{ data: base64, mimeType: "image/jpeg" }`
- `duration`: Video duration in seconds (if available)

## Local Video Extraction

### File Detection

- Matches local paths with extensions: `.mp4`, `.mov`, `.webm`, `.avi`, `.mpeg`, `.mpg`, `.wmv`, `.flv`, `.3gp`
- Exports `isVideoFile(path): boolean`
- Validates file exists and is within size limit

### Default Prompt

```
Analyze this video. Include:
1. A brief summary of the content
2. Full transcript with timestamps
3. Descriptions of any code, terminal commands, diagrams, slides, or UI shown
Format as markdown.
```

Custom `prompt` overrides the default.

### Function Signature

```typescript
export async function extractVideo(
  filePath: string,
  signal?: AbortSignal,
  options?: ExtractOptions,
): Promise<ExtractedContent | null>
```

### Fallback Chain

1. Gemini API (Files API) — upload, poll until ACTIVE, query, cleanup
2. Gemini Web — if API key unavailable

### Size Limit

`video.maxSizeMB` (default 50MB). Files exceeding this return an error result.

### File Lifecycle

1. Validate path + size
2. Upload to Gemini Files API (resumable, chunked)
3. Poll file state until ACTIVE (with timeout)
4. Call generateContent with file URI + prompt
5. Delete uploaded file
6. Return extracted text

### Error Cases

- File not found → error result
- File too large → error result with size info
- Upload timeout → return null
- Gemini processing fails → return null

## Frame Extraction

### Exported Functions

```typescript
export async function extractYouTubeFrames(
  url: string,
  timestamps: number[],
  signal?: AbortSignal,
): Promise<{ frames: VideoFrame[]; duration: number; error: string | null }>

export async function extractLocalFrames(
  filePath: string,
  timestamps: number[],
  signal?: AbortSignal,
): Promise<{ frames: VideoFrame[]; duration: number; error: string | null }>

export function parseTimestampParam(
  timestamp: string,
  frames?: number,
  duration?: number,
): number[]
```

### Timestamp Parsing

- Single: `"1:23:45"` → `[5025]`, `"23:45"` → `[1425]`, `"85"` → `[85]`
- Range: `"23:41-25:00"` → evenly-spaced array (default 6 frames, or `frames` param)
- Single + frames: `"5:00"` + `frames: 3` → `[300, 305, 310]` (5s intervals)
- Frames only (no timestamp): sample evenly across entire video duration

### YouTube Frame Pipeline

1. `yt-dlp --get-url --get-duration` → stream URL + duration
2. Per timestamp: `ffmpeg -ss {t} -i {streamUrl} -frames:v 1 -f image2 pipe:1`
3. Capture stdout → base64 encode
4. Return VideoFrame[] with formatted timestamps

### Local Frame Pipeline

1. `ffprobe` → duration (for "sample entire video" mode)
2. Per timestamp: `ffmpeg -ss {t} -i {filePath} -frames:v 1 -f image2 pipe:1`
3. Same base64 encoding

### Constraints

- Max 12 frames per request
- Each frame ~100-200KB as JPEG (quality 85)
- Requires ffmpeg in PATH (graceful error if missing)
- YouTube requires yt-dlp in PATH (graceful error if missing)
- Total timeout: 60s for all frames

### Graceful Degradation

- ffmpeg not installed → error: "ffmpeg required for frame extraction"
- yt-dlp not installed → error: "yt-dlp required for YouTube frame extraction"
- Individual frame fails → skip, return partial results
- Partial success is acceptable

## Gemini HTML Fallback

### Position in Chain

```
HTML → Readability+Turndown → RSC parser → Jina Reader → Gemini → raw strip
```

### Behavior

When Readability produces < 500 chars and RSC/Jina fail:

1. Gemini URL Context API (if API key available) — sends URL to Gemini
2. Gemini Web (if cookies available) — same via cookie-auth

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
  // existing fields...
  
  gemini?: {
    apiKey?: string;              // or GEMINI_API_KEY env var / shell command
    baseUrl?: string;             // default: "https://generativelanguage.googleapis.com"
    allowBrowserCookies?: boolean; // default: false; also PI_ALLOW_BROWSER_COOKIES=1
  };
  
  youtube?: {
    enabled?: boolean;            // default: true
    preferredModel?: string;      // default: "gemini-2.5-flash"
  };
  
  video?: {
    enabled?: boolean;            // default: true
    preferredModel?: string;      // default: "gemini-2.5-flash"
    maxSizeMB?: number;           // default: 50
  };
}
```

### Key Resolution

Uses existing credential resolution:
1. Config field `gemini.apiKey` (string or `!op read ...` shell command)
2. Environment variable `GEMINI_API_KEY`
3. Cookie-auth only mode (if enabled)

### Cookie Auth Enablement

Either path enables cookie extraction:
- Config: `gemini.allowBrowserCookies: true`
- Environment: `PI_ALLOW_BROWSER_COOKIES=1`

### Behavior When Unconfigured

- No API key + no cookies → YouTube/video extraction returns null, falls through
- YouTube URLs with no Gemini → Perplexity fallback if available, else regular HTML
- Local video with no Gemini → error result explaining Gemini is required

### Example Config

```json
{
  "providers": {},
  "gemini": {
    "apiKey": "!op read op://dev/gemini/api-key",
    "allowBrowserCookies": true
  },
  "youtube": {
    "enabled": true,
    "preferredModel": "gemini-2.5-flash"
  },
  "video": {
    "enabled": true,
    "maxSizeMB": 100
  }
}
```

## web_fetch Tool Extension

### New Parameters

```typescript
parameters: Type.Object({
  // Existing
  url: Type.Optional(Type.String()),
  urls: Type.Optional(Type.Array(Type.String())),
  forceClone: Type.Optional(Type.Boolean()),
  maxChars: Type.Optional(Type.Integer()),
  // New
  prompt: Type.Optional(Type.String({
    description: "Question or instruction for video/YouTube analysis."
  })),
  timestamp: Type.Optional(Type.String({
    description: "Extract frame(s): '1:23:45' (single), '23:41-25:00' (range)."
  })),
  frames: Type.Optional(Type.Integer({
    minimum: 1, maximum: 12,
    description: "Number of frames to extract."
  })),
  model: Type.Optional(Type.String({
    description: "Override Gemini model for video/YouTube analysis."
  })),
})
```

### Auto-Detection Behavior

- YouTube URL without video params → automatic transcript with default prompt
- YouTube URL with `prompt` → focused analysis
- YouTube URL with `timestamp`/`frames` → frame extraction
- Local video path → video analysis with Gemini
- Regular HTTP URL → existing extraction (video params ignored)
- `prompt` on non-video URL → ignored

### Tool Description

```
Fetch URL(s) and extract readable content as markdown. Supports web pages,
PDFs, GitHub repositories, YouTube videos (transcripts + thumbnails), and
local video files. For YouTube/video: pass a specific question via `prompt`
to focus extraction on what matters. Frame extraction requires ffmpeg/yt-dlp.
```

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
└── pipeline.test.ts      # MODIFIED
tests/tools/
└── web-fetch.test.ts     # MODIFIED
```

### Testing Approach

- All external calls mocked via `stubFetch()` and `stubExec()`
- Cookie extraction tested with fixture SQLite databases
- Frame extraction tested by mocking ffmpeg stdout
- YouTube URL detection tested with comprehensive patterns
- Fallback chains tested by simulating tier failures

### Error Handling Strategy

- Network errors (timeout, 429, 500) → return null, let next fallback handle
- Missing tools (ffmpeg, yt-dlp) → descriptive error in text field
- Config errors (no key + no cookies) → skip silently, fall through
- File errors (too large, not found) → error result with explanation
- Partial success (some frames extracted) → return partial + error note
- Cookie expiry → 401 → fall through to Gemini API

### Graceful Degradation Principle

Video features are additive. If Gemini is not configured, the tool works for everything else. No existing functionality breaks.

## External Dependencies

### Required (already in pi-tools)

- `@mozilla/readability` — HTML extraction
- `linkedom` — DOM parsing
- `turndown` — HTML to Markdown
- `unpdf` — PDF extraction

### Optional System Tools

- `ffmpeg` — Frame extraction (graceful error if missing)
- `yt-dlp` — YouTube stream URLs (graceful error if missing)

### No New npm Dependencies Required

The Gemini API client is a thin HTTP wrapper using native `fetch`. Cookie decryption uses Node.js built-in `crypto` and `node:sqlite` (stable in Node >= 24.15.0, which this project requires). No new npm packages needed.
