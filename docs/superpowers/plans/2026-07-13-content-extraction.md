# Content Extraction & YouTube/Video — Parent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port YouTube transcript extraction, local video analysis, frame extraction, and Gemini HTML fallback from pi-web-access into pi-tools.

**Architecture:** 7 phases ordered simplest-to-complex. Each phase is atomic with passing tests. Phase 1 lays type/config foundation. Phases 2-3 build Gemini client infrastructure. Phases 4-6 implement extraction features. Phase 7 wires everything into the pipeline and tool.

**Tech Stack:** TypeScript, Vitest, native `fetch`, `node:crypto`, `node:sqlite`, `execFileSync` for ffmpeg/yt-dlp

**Spec:** `docs/superpowers/specs/2026-07-13-content-extraction-design.md`

---

## Phase Index

Each phase has its own detailed plan file. Execute in order.

| Phase | Plan File | Summary |
|-------|-----------|---------|
| 1 | `2026-07-13-content-extraction-phase-1-config-types.md` | Extend config schema, ExtractOptions, ExtractedContent with video fields |
| 2 | `2026-07-13-content-extraction-phase-2-gemini-api.md` | Gemini REST API client (queryGeminiApi, key resolution, Cloudflare gateway) |
| 3 | `2026-07-13-content-extraction-phase-3-gemini-web.md` | Chrome cookie extraction + Gemini Web cookie-auth client |
| 4 | `2026-07-13-content-extraction-phase-4-youtube.md` | YouTube URL detection, transcript extraction, Perplexity fallback, thumbnails |
| 5 | `2026-07-13-content-extraction-phase-5-frames.md` | Frame extraction via ffmpeg/yt-dlp (timestamp parsing, YouTube + local) |
| 6 | `2026-07-13-content-extraction-phase-6-video.md` | Local video file detection, Files API upload, Gemini analysis, auto-thumbnail |
| 7 | `2026-07-13-content-extraction-phase-7-integration.md` | Pipeline routing (YouTube/video/Gemini HTML fallback) + web_fetch tool extension |

---

## Prerequisites

- Node.js >= 24.15.0
- pnpm
- All existing tests pass: `pnpm test`
- Working branch: `20260713-content-extraction-planning` (or create feature branch from it)

## Verification Between Phases

After each phase:

```bash
pnpm test          # all tests pass
pnpm run lint      # no lint errors (biome)
pnpm run typecheck # no type errors
```

## Key Reference Files

| File | Role |
|------|------|
| `src/extract/pipeline.ts` | Main extraction orchestrator (modified in Phase 7) |
| `src/config.ts` | Config loading, key resolution (modified in Phase 1) |
| `src/tools/web-fetch.ts` | web_fetch tool (modified in Phase 7) |
| `src/cache.ts` | In-memory LRU cache (no changes needed) |
| `src/storage.ts` | Content store (no changes needed) |
| `tests/helpers.ts` | stubFetch, stubExec, createMockPi test utilities |

## Source Reference

The pi-web-access package at `/Users/lanh/Developer/pi-packages/nicobailon-pi-web-access` is the reference implementation:

| pi-web-access file | Maps to pi-tools |
|---|---|
| `gemini-api.ts` | `src/extract/gemini-api.ts` |
| `gemini-web.ts` + `gemini-web-config.ts` | `src/extract/gemini-web.ts` |
| `chrome-cookies.ts` | `src/extract/chrome-cookies.ts` |
| `youtube-extract.ts` | `src/extract/youtube.ts` |
| `video-extract.ts` | `src/extract/video.ts` |
| `perplexity.ts` (YouTube fallback parts) | `src/extract/perplexity.ts` |
| Frame extraction (in youtube-extract + video-extract) | `src/extract/frames.ts` |
