# Architecture Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce architectural friction across 6 phases — config rename, pipeline config injection, provider registration collapse, unified fallback, registry consolidation, and conditional HTTP adapter extraction.

**Architecture:** Each phase is independently shippable. Phases 1-3 are fully independent. Phases 4-5 assume Phase 3's structure. Phase 6 is conditional on Phase 3. Each phase follows TDD with frequent commits.

**Tech Stack:** TypeScript 6, Vitest 4, Node 24+, biome (lint/format)

---

## Overview

| Phase | Plan File | Summary |
|-------|-----------|---------|
| 7 | `2026-07-02-phase7-config-rename.md` | Rename `pi-tools.json` → `tools.json` with backward compat |
| 8 | `2026-07-02-phase8-pipeline-config-injection.md` | Inject GitHubConfig into pipeline via ExtractOptions |
| 9 | `2026-07-02-phase9-provider-registration.md` | Collapse providerFactories into per-provider meta exports |
| 10 | `2026-07-02-phase10-unified-fallback.md` | Extract executeWithFallback from duplicated tool logic |
| 11 | `2026-07-02-phase11-registry-consolidation.md` | Absorb UsageTracker into ProviderRegistry |
| 12 | `2026-07-02-phase12-http-adapter.md` | Extract HTTP scaffolding (conditional) |

## Verification command (all phases)

```bash
pnpm check   # runs: biome lint . && tsc --noEmit && vitest run
```

Run this after every phase. It must pass before moving to the next phase.

## Phase dependencies

```
Phase 7  ──→ shippable (independent)
Phase 8  ──→ shippable (independent)
Phase 9  ──→ shippable (independent)
Phase 10 ──→ shippable (requires Phase 9 complete)
Phase 11 ──→ shippable (requires Phase 9 complete)
Phase 12 ──→ conditional (requires Phase 9 complete)
```

## File map (all phases)

### Phase 7
- Modify: `src/config.ts` (rename constants)
- Modify: `src/commands/tools.ts` (path references)
- Modify: `tests/config.test.ts` (fixture updates)
- Modify: `README.md` (documentation)

### Phase 8
- Modify: `src/extract/pipeline.ts` (remove loadConfig, accept options)
- Modify: `src/extract/github.ts` (remove duplicate defaults)
- Modify: `src/tools/web-fetch.ts` (pass github config)
- Modify: `src/index.ts` (thread config)
- Modify: `tests/extract/pipeline.test.ts` (pass config in tests)

### Phase 9
- Modify: `src/providers/brave.ts` (add providerMeta)
- Modify: `src/providers/duckduckgo.ts` (add providerMeta)
- Modify: `src/providers/exa.ts` (add providerMeta)
- Modify: `src/providers/exa-mcp.ts` (add providerMeta)
- Modify: `src/providers/firecrawl.ts` (add providerMeta)
- Modify: `src/providers/jina.ts` (add providerMeta)
- Modify: `src/providers/openai-native.ts` (add providerMeta)
- Modify: `src/providers/parallel.ts` (add providerMeta)
- Modify: `src/providers/perplexity.ts` (add providerMeta)
- Modify: `src/providers/searxng.ts` (add providerMeta)
- Modify: `src/providers/serper.ts` (add providerMeta)
- Modify: `src/providers/tavily.ts` (add providerMeta)
- Modify: `src/providers/websearchapi.ts` (add providerMeta)
- Create: `src/providers/all.ts` (barrel)
- Modify: `src/index.ts` (consume barrel, delete factory map)
- Modify: `src/utils/errors.ts` (inline ProviderError)

### Phase 10
- Create: `src/providers/execute.ts` (executeWithFallback)
- Create: `tests/providers/execute.test.ts`
- Modify: `src/tools/web-search.ts` (delegate fallback)
- Modify: `src/tools/web-fetch.ts` (delegate fallback)
- Modify: `src/utils/truncate.ts` (simplify return)
- Modify: `tests/utils/truncate.test.ts` (update assertions)

### Phase 11
- Modify: `src/providers/registry.ts` (absorb usage + persistence adapter)
- Delete: `src/providers/usage.ts`
- Modify: `src/index.ts` (remove UsageTracker)
- Modify: `tests/providers/registry.test.ts` (use in-memory adapter)
- Delete: `tests/providers/usage.test.ts`

### Phase 12 (conditional)
- Create: `src/providers/http-adapter.ts`
- Create: `tests/providers/http-adapter.test.ts`
- Modify: 11 provider files to use adapter
