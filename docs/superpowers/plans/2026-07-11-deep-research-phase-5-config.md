# Deep Research — Phase 5: Config Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `DeepResearchConfig` interface and parsing to the config system so users can enable/disable deep research, override mode defaults, and set global output schemas via `tools.json`.

**Architecture:** Extends the existing `PiToolsConfig` interface with a `deepResearch: DeepResearchConfig` field. A new `validateDeepResearchConfig` function parses and validates the section. The default enables deep research (actual availability still depends on Exa key resolution at registration time).

**Tech Stack:** TypeScript, Vitest, existing config test patterns (`vi.mock("node:fs")`)

**Spec:** `docs/superpowers/specs/2026-07-11-deep-research-design.md`
**Main plan:** `docs/superpowers/plans/2026-07-11-deep-research.md`

**Depends on:** Phase 1 (`ResearchMode`, `ResearchModeDefaults` types for the modeDefaults interface)
**Produces:** Config interface and parsing ready for tool registration in Phase 6.

---

## Context for the Engineer

The config system lives in `src/config.ts` (257 lines). Key structures:

- `PiToolsConfig` interface — the master config type
- `DEFAULT_CONFIG` — built-in defaults
- `parseConfigFile()` — parses JSON from disk into `PiToolsConfig`
- `loadConfig()` / `loadMergedConfig()` — load from filesystem with fallbacks
- `resolveApiKey()` — resolves API keys from env vars, shell commands, or literals

Each config section has a pattern:

1. Interface definition (e.g., `CombineConfig`)
2. Default constant (e.g., `DEFAULT_COMBINE_CONFIG`)
3. Validator function (e.g., `validateCombineConfig`)
4. Added to `DEFAULT_CONFIG` and `parseConfigFile` return

Tests in `tests/config.test.ts` mock `node:fs` with `vi.mock("node:fs")` and use `vi.mocked(fs.readFileSync).mockReturnValue(...)`.

---

### Task 5: Add DeepResearchConfig to config system

**Files:**

- Modify: `src/config.ts`
- Test: `tests/config-deep-research.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/config-deep-research.test.ts`:

```typescript
import * as fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.ts";
import type { DeepResearchConfig } from "../src/config.ts";

vi.mock("node:fs");

describe("DeepResearchConfig loading", () => {
  it("returns default deepResearch config when not in file", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));
    const config = loadConfig();
    expect(config.deepResearch).toEqual({ enabled: true });
  });

  it("parses deepResearch.enabled = false", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ deepResearch: { enabled: false } }),
    );
    const config = loadConfig();
    expect(config.deepResearch.enabled).toBe(false);
  });

  it("parses modeDefaults overrides", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        deepResearch: {
          enabled: true,
          modeDefaults: {
            standard: { numResults: 60, textMaxCharacters: 20000 },
          },
        },
      }),
    );
    const config = loadConfig();
    expect(config.deepResearch.modeDefaults?.standard?.numResults).toBe(60);
    expect(config.deepResearch.modeDefaults?.standard?.textMaxCharacters).toBe(
      20000,
    );
  });

  it("parses outputSchema override", () => {
    const schema = {
      type: "object",
      properties: { summary: { type: "string" } },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ deepResearch: { outputSchema: schema } }),
    );
    const config = loadConfig();
    expect(config.deepResearch.outputSchema).toEqual(schema);
  });

  it("parses guidance override", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        deepResearch: { guidance: { promptSnippet: "Custom snippet" } },
      }),
    );
    const config = loadConfig();
    expect(config.deepResearch.guidance?.promptSnippet).toBe("Custom snippet");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/config-deep-research.test.ts`
Expected: FAIL — `DeepResearchConfig` not exported, `config.deepResearch` is undefined

- [ ] **Step 3: Add DeepResearchConfig to config.ts**

Add the interface after `CombineConfig` (after line 38 in `src/config.ts`):

```typescript
export interface DeepResearchConfig {
  enabled: boolean;
  modeDefaults?: Partial<
    Record<
      string,
      Partial<{
        type: string;
        numResults: number;
        textMaxCharacters: number;
        timeoutSeconds: number;
        highlightsMaxCharacters: number;
        highlightNumSentences: number;
        highlightsPerUrl: number;
        summaryQuery: string;
        maxAgeHours: number;
        category: string;
        outputSchema: Record<string, unknown>;
      }>
    >
  >;
  outputSchema?: Record<string, unknown> | null;
  guidance?: GuidanceOverride;
}
```

Add default constant after `DEFAULT_COMBINE_CONFIG`:

```typescript
export const DEFAULT_DEEP_RESEARCH_CONFIG: DeepResearchConfig = {
  enabled: true,
};
```

Add `deepResearch: DeepResearchConfig;` field to the `PiToolsConfig` interface (after `combine: CombineConfig;`).

Add `deepResearch: DEFAULT_DEEP_RESEARCH_CONFIG,` to the `DEFAULT_CONFIG` object.

Add the validator function (place it after `validateCombineConfig`):

```typescript
function validateDeepResearchConfig(parsed: unknown): DeepResearchConfig {
  if (!parsed || typeof parsed !== "object")
    return { ...DEFAULT_DEEP_RESEARCH_CONFIG };
  const raw = parsed as Record<string, unknown>;
  return {
    enabled:
      typeof raw.enabled === "boolean"
        ? raw.enabled
        : DEFAULT_DEEP_RESEARCH_CONFIG.enabled,
    modeDefaults:
      raw.modeDefaults && typeof raw.modeDefaults === "object"
        ? (raw.modeDefaults as DeepResearchConfig["modeDefaults"])
        : undefined,
    outputSchema:
      raw.outputSchema && typeof raw.outputSchema === "object"
        ? (raw.outputSchema as Record<string, unknown>)
        : undefined,
    guidance:
      raw.guidance && typeof raw.guidance === "object"
        ? (raw.guidance as GuidanceOverride)
        : undefined,
  };
}
```

In `parseConfigFile`, add `deepResearch` to the return object (after the `combine` line):

```typescript
    deepResearch: validateDeepResearchConfig(parsed.deepResearch),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/config-deep-research.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to ensure no regressions**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/config.ts tests/config-deep-research.test.ts
git commit -m "feat(config): add deepResearch config section"
```
