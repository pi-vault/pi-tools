# Search Providers Expansion — Parent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand pi-tools from 14 to 21 search providers, add credential caching, and extract pure response parsers.

**Architecture:** 8 phases ordered simplest-to-complex. Each phase is atomic: it produces a working increment with passing tests. Phases 1 (credentials) and 2 (marginalia + parsers.ts creation) are infrastructure; Phases 3-5 add providers; Phase 6 extracts existing parsers; Phase 7 replaces openai-native; Phase 8 reviews existing providers.

**Tech Stack:** TypeScript, Vitest, native `fetch`, `execSync` for shell commands

**Spec:** `docs/superpowers/specs/2026-07-12-search-providers-design.md`

---

## Phase Index

Each phase has its own detailed plan file. Execute in order.

| Phase | Plan File                                                  | Summary                                              |
| ----- | ---------------------------------------------------------- | ---------------------------------------------------- |
| 1     | `2026-07-12-search-providers-phase-1-credentials.md`       | Credential caching, fallback env vars, safety checks |
| 2     | `2026-07-12-search-providers-phase-2-marginalia.md`        | Marginalia provider + create parsers.ts              |
| 3     | `2026-07-12-search-providers-phase-3-langsearch.md`        | LangSearch provider                                  |
| 4     | `2026-07-12-search-providers-phase-4-brave-llm.md`         | Brave LLM Context provider                           |
| 5     | `2026-07-12-search-providers-phase-5-batch-providers.md`   | Linkup, You.com, fastCRW, Sofya providers            |
| 6     | `2026-07-12-search-providers-phase-6-parser-extraction.md` | Extract existing inline parsers to parsers.ts        |
| 7     | `2026-07-12-search-providers-phase-7-openai-codex.md`      | Dual-mode OpenAI Codex (replaces openai-native)      |
| 8     | `2026-07-12-search-providers-phase-8-provider-review.md`   | Review and improve existing providers                |

---

## Prerequisites

- Node.js 22+
- pnpm 11+
- All existing tests pass: `pnpm test`
- Working branch: create from `master`

## Verification Between Phases

After each phase:

```bash
pnpm test          # all tests pass
pnpm run lint      # no lint errors
pnpm run typecheck # no type errors
```

## Key Reference Files

| File                            | Purpose                                                           |
| ------------------------------- | ----------------------------------------------------------------- |
| `src/config.ts`                 | Config loading, `resolveApiKey()`, `ProviderConfigEntry` type     |
| `src/config-manager.ts`         | Provider registration, config refresh                             |
| `src/providers/types.ts`        | `ProviderMeta`, `SearchProvider`, `FetchProvider`, `SearchResult` |
| `src/providers/http-adapter.ts` | `createHttpSearchProvider()` factory                              |
| `src/providers/all.ts`          | Provider metadata array (import + register)                       |
| `src/providers/brave.ts`        | Reference provider (http-adapter pattern)                         |
| `tests/helpers.ts`              | `stubFetch()`, `createMockPi()`, `stubExec()`                     |

## Patterns to Follow

**New provider file:** Export `providerMeta: ProviderMeta`. Use `createHttpSearchProvider` for simple HTTP APIs.

**Provider registration:** Add import + array entry in `src/providers/all.ts`.

**Test pattern:**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { stubFetch } from "../helpers.ts";

describe("ProviderName", () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  beforeEach(() => {
    fetchStub = stubFetch();
  });
  afterEach(() => {
    fetchStub.restore();
  });

  it("returns search results", async () => {
    fetchStub.addResponse("api.example.com", {
      body: {
        /* fixture */
      },
    });
    // create provider, call search, assert results
  });
});
```
