# Architecture Deepening — Parent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen 12 shallow modules across four refactoring phases, then correct config initialization against Pi's session lifecycle while preserving external interfaces.

**Architecture:** Each phase is independently mergeable via its own PR and produces a usable result. Phase 4 depends on Phase 3 (config threading removed first). Phase 5 depends on Phase 2 (both touch index.ts). All other phases are independent. No new npm dependencies.

**Tech Stack:** TypeScript (ES2022, Node16 modules), Vitest, native `fetch`, Pi ExtensionAPI (`@earendil-works/pi-coding-agent`), Pi TUI (`@earendil-works/pi-tui`)

**Spec:** `docs/superpowers/specs/2026-07-16-architecture-deepening-design.md`

---

## Phase Index

Each phase has its own detailed plan file. Execute in order.

| Phase | Plan File | Summary |
|-------|-----------|---------|
| 1 | `2026-07-16-phase-1-consolidate-providers.md` | Consolidate 9 shallow HTTP search providers into data-driven definitions |
| 2 | `2026-07-16-phase-2-session-lifecycle.md` | Extract session lifecycle logic from index.ts into session.ts |
| 3 | `2026-07-16-phase-3-config-self-resolution.md` | Extraction pipeline resolves its own config via loadMergedConfig |
| 4 | `2026-07-16-phase-4-collapse-web-fetch-multi.md` | Absorb web-fetch-multi into web-fetch, fix fallback asymmetry |
| 5 | `2026-07-16-phase-5-config-lifecycle.md` | Initialize config and tools from Pi's trusted session context |

---

## Prerequisites

- Node.js 22+
- pnpm 11+
- All existing tests pass: `pnpm test`
- Working branch: `20260716-improve-codebase-architecture`

## Verification Between Phases

After each phase:

```bash
pnpm test          # all tests pass
pnpm run typecheck # no type errors
pnpm run lint      # no lint errors
```

## Key Reference Files

| File | Role |
|------|------|
| `src/index.ts` | Extension entry point (`createExtension`). Tool/command registration, event handlers. |
| `src/config.ts` | `PiToolsConfig` interface, `loadMergedConfig()`, `resolveApiKey()`, config types |
| `src/config-manager.ts` | `ConfigManager` class: TTL-cached config + provider lifecycle |
| `src/extract/pipeline.ts` | `extractContent()`, `ExtractOptions`, extraction chain orchestration |
| `src/providers/all.ts` | `allProviders` array — imports all `ProviderMeta` definitions |
| `src/providers/http-adapter.ts` | `createHttpSearchProvider()` factory, `HttpSearchConfig` interface |
| `src/providers/registry.ts` | `ProviderRegistry` class: registration, metrics, selection |
| `src/providers/types.ts` | `SearchProvider`, `FetchProvider`, `ProviderMeta` interfaces |
| `src/tools/web-fetch.ts` | `createWebFetchTool()` — single + multi URL fetch tool |
| `src/tools/web-fetch-multi.ts` | `executeMultiUrl()` — multi-URL orchestration |
| `tests/helpers.ts` | `stubFetch()`, `createMockPi()`, `makeCtx()` test utilities |

## Key Interfaces

```typescript
// src/providers/types.ts
interface ProviderMeta {
  name: string;
  tier: ProviderTier;
  monthlyQuota: number | null;
  requiresKey: boolean;
  create: (key?: string, config?: ProviderConfigEntry) => {
    search?: SearchProvider;
    fetch?: FetchProvider;
    codeSearch?: CodeSearchProvider;
    docs?: DocsProvider;
  };
}

// src/providers/http-adapter.ts
interface HttpSearchConfig {
  name: string;
  label: string;
  endpoint: string | ((query: string, maxResults: number, filters?: SearchFilters) => string);
  method: "GET" | "POST";
  authHeader?: string;
  authPrefix?: string;
  buildHeaders?: (apiKey: string) => Record<string, string>;
  buildBody?: (query: string, maxResults: number, filters?: SearchFilters) => unknown;
  extractResults: (data: unknown) => Array<{ title: string; url: string; snippet: string }>;
}

// src/extract/pipeline.ts (current — Phase 3 will shrink this)
interface ExtractOptions {
  raw?: boolean;
  github?: GitHubConfig;
  allowRanges?: string[];
  prompt?: string;
  timestamp?: string;
  frames?: number;
  model?: string;
  pdf?: PdfConfig;
  gemini?: GeminiConfig;
  ctx?: ExtensionContext;
}
```
