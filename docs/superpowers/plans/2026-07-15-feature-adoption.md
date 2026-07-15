# Feature Adoption — Parent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt 11 competitive features across 5 atomic phases, from trivial (Cloudflare retry) to complex (interactive setup + activity monitor).

**Architecture:** Each phase is independently mergeable and produces a usable result. Phases build on previous config/type additions but never depend on runtime behavior from prior phases. All features use native `fetch()`, existing libraries, or Pi framework APIs — no new npm dependencies.

**Tech Stack:** TypeScript (ES2022, Node16 modules), Vitest, native `fetch`, Pi ExtensionAPI (`@earendil-works/pi-coding-agent`), Pi TUI (`@earendil-works/pi-tui`)

**Spec:** `docs/superpowers/specs/2026-07-15-feature-adoption-design.md`

---

## Phase Index

Each phase has its own detailed plan file. Execute in order.

| Phase | Plan File | Summary |
|-------|-----------|---------|
| 1 | `2026-07-15-phase-1-cloudflare.md` | Cloudflare bot retry (1b gateway already implemented) |
| 2 | `2026-07-15-phase-2-fetching-guidance.md` | HEAD probe content negotiation, dynamic guidance injection |
| 3 | `2026-07-15-phase-3-pdf-trust-reorg.md` | PDF OCR dual strategy, project trust gating, web-fetch file split |
| 4 | `2026-07-15-phase-4-ollama-openai.md` | Ollama search/fetch provider, OpenAI native layered (rewrite + provider) |
| 5 | `2026-07-15-phase-5-setup-monitor.md` | Enhanced /tools subcommands + wizard, activity monitor widget |

---

## Prerequisites

- Node.js 22+
- pnpm 11+
- All existing tests pass: `pnpm test`
- Working branch: `20260715-refactor` (from master)

## Verification Between Phases

After each phase:

```bash
pnpm test          # all tests pass
pnpm run typecheck # no type errors
```

## Key Reference Files

| File | Role |
|------|------|
| `src/index.ts` | Extension entry point (`createExtension`). Tool/command registration, event handlers. |
| `src/config.ts` | `PiToolsConfig` interface, `loadMergedConfig()`, `GeminiConfig`, `resolveApiKey()` |
| `src/config-manager.ts` | `ConfigManager` class wrapping config loading + refresh |
| `src/extract/pipeline.ts` | `extractContent()` — HTTP fetch, response handling, PDF extraction |
| `src/extract/gemini-api.ts` | Gemini API calls. **Already has Cloudflare AI Gateway support.** |
| `src/providers/types.ts` | `SearchProvider`, `FetchProvider`, `ProviderMeta`, `SearchResult` interfaces |
| `src/providers/all.ts` | Provider registry (`allProviders` array) |
| `src/providers/execute.ts` | `executeWithFallback()` — sequential provider fallback |
| `src/providers/fusion.ts` | `executeWithFusion()` — parallel RRF fusion |
| `src/tools/web-fetch.ts` | `createWebFetchTool()` — 448 lines, target for Phase 3c split |
| `src/commands/tools.ts` | `/tools` command — status table + basic wizard |
| `tests/helpers.ts` | `stubFetch()`, `createMockPi()`, `makeCtx()` test utilities |

## Key Interfaces (from `src/providers/types.ts`)

```typescript
interface SearchResult { title: string; url: string; snippet: string; }
interface SearchProvider {
  readonly name: string;
  readonly label: string;
  search(query: string, maxResults: number, signal?: AbortSignal, filters?: SearchFilters): Promise<SearchResult[]>;
}
interface FetchProvider {
  readonly name: string;
  fetch(url: string, signal?: AbortSignal): Promise<FetchResult>;
}
interface FetchResult { text: string; title?: string; contentType?: string; }
interface ProviderMeta {
  name: string; tier: ProviderTier; monthlyQuota: number | null; requiresKey: boolean;
  create: (key?: string, config?: ProviderConfigEntry) => { search?: SearchProvider; fetch?: FetchProvider; codeSearch?: CodeSearchProvider; docs?: DocsProvider; };
}
```

## Test Patterns

- **Framework:** Vitest (`describe`, `it`, `expect` from `"vitest"`)
- **HTTP mocking:** `stubFetch()` from `tests/helpers.ts` — replaces `globalThis.fetch`, matches URL patterns
- **Pi mocking:** `createMockPi()` for ExtensionAPI, `makeCtx()` for ExtensionContext
- **Import style:** Relative paths with `.ts` extensions (`"../../src/providers/types.ts"`)
- **Test location:** Mirror source structure under `tests/` (e.g., `src/providers/brave.ts` → `tests/providers/brave.test.ts`)

## Discovery Notes

The following was discovered during verification against reference repos:

1. **Phase 1b (Cloudflare AI Gateway) is already fully implemented** in `src/extract/gemini-api.ts` with tests in `tests/extract/gemini-api.test.ts`. Gateway detection, header injection, and key param omission are all present. Phase 1 only needs the bot retry (1a).

2. **`promptGuidelines` is a static `string[]`** on `ToolDefinition`, not a function. Dynamic guidance (Phase 2b) must be evaluated at startup and baked into the registration call.

3. **Pi's trust API** is `ctx.isProjectTrusted(): boolean` on `ExtensionContext`. The test helper `makeCtx()` already mocks this (`isProjectTrusted: () => true`).

4. **Pi's widget API** is `ctx.ui.setWidget(key, content, options?)`, NOT `pi.registerWidget()`. Content is a `Text` component from `@earendil-works/pi-tui`.

5. **Pi's model API** provides `ctx.model?.provider` (string like `"openai-codex"`) and `ctx.model?.input` (array like `["text", "image"]`).

## Config Additions by Phase

```
Phase 1:  (none — GeminiConfig.cloudflareApiKey already exists)
Phase 2:  (none — uses existing guidance config)
Phase 3:  PiToolsConfig.pdf?: { ocrEnabled?: boolean; ocrMaxPages?: number; ocrDpi?: number }
Phase 4:  PiToolsConfig.ollama?: { enabled?: boolean; baseUrl?: string; apiKey?: string }
          PiToolsConfig.openaiNative?: { rewriteEnabled?: boolean; externalWebAccess?: boolean; providerEnabled?: boolean; apiKey?: string; model?: string }
Phase 5:  (none — uses existing config + new /tools subcommands)
```

## New Files by Phase

```
Phase 1:  tests/extract/cloudflare-retry.test.ts
Phase 2:  src/utils/capabilities.ts, tests/utils/capabilities.test.ts, tests/extract/head-probe.test.ts, tests/index-guidance.test.ts
Phase 3:  src/extract/pdf-ocr.ts, src/utils/trust.ts, src/tools/web-fetch-multi.ts, src/utils/concurrency.ts
          tests/extract/pdf-ocr.test.ts, tests/utils/trust.test.ts
Phase 4:  src/providers/ollama.ts, src/providers/openai-native-rewrite.ts, src/providers/openai-web-search.ts
          tests/providers/ollama.test.ts, tests/providers/openai-native-rewrite.test.ts, tests/providers/openai-web-search.test.ts
Phase 5:  src/monitor/activity-monitor.ts, src/monitor/widget.ts, src/commands/tools-subcommands.ts, src/commands/tools-setup.ts
          tests/monitor/activity-monitor.test.ts, tests/monitor/widget.test.ts, tests/commands/tools-subcommands.test.ts, tests/commands/tools-setup.test.ts
```
