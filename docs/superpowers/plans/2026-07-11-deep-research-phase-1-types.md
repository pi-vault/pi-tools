# Deep Research — Phase 1: Types and Interfaces

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define all research-related types, interfaces, mode defaults, and the default structured output schema.

**Architecture:** A new `src/research/types.ts` module exports all shared types (`ExaDeepType`, `ResearchMode`, `DeepResearchParams`, `DeepResearchResult`, `DeepResearchResponse`, `ResearchModeDefaults`) and constants (`researchModeDefaults`, `defaultResearchOutputSchema`). These are consumed by later phases (client, preparation, report, tool).

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-07-11-deep-research-design.md`
**Main plan:** `docs/superpowers/plans/2026-07-11-deep-research.md`

**Depends on:** Nothing (first phase)
**Produces:** Tested types module with mode defaults and output schema, ready for all downstream phases.

---

## Context for the Engineer

pi-tools is a Pi coding agent extension providing web search tools. It uses TypeScript with Vitest for testing and Biome for formatting/linting.

Run tests: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run <path>`
Run all checks: `npm run check` (lint + typecheck + tests)

The project uses `typebox` for schema definitions but pure TypeScript types for internal interfaces. The new `src/research/` directory doesn't exist yet — create it.

---

### Task 1: Research types module

**Files:**

- Create: `src/research/types.ts`
- Test: `tests/research/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/research/types.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  researchModeDefaults,
  defaultResearchOutputSchema,
  type ResearchMode,
  type ExaDeepType,
  type DeepResearchParams,
  type DeepResearchResult,
  type DeepResearchResponse,
  type ResearchModeDefaults,
} from "../../src/research/types.ts";

describe("researchModeDefaults", () => {
  it("has lite, standard, and full modes", () => {
    expect(Object.keys(researchModeDefaults).sort()).toEqual([
      "full",
      "lite",
      "standard",
    ]);
  });

  it("lite uses deep-lite type with 15 results", () => {
    const lite = researchModeDefaults.lite;
    expect(lite.type).toBe("deep-lite");
    expect(lite.numResults).toBe(15);
    expect(lite.textMaxCharacters).toBe(10000);
    expect(lite.highlightsMaxCharacters).toBe(600);
    expect(lite.highlightNumSentences).toBe(3);
    expect(lite.highlightsPerUrl).toBe(1);
    expect(lite.timeoutSeconds).toBe(300);
    expect(lite.outputSchema).toBeUndefined();
  });

  it("standard uses deep-reasoning type with 50 results and output schema", () => {
    const standard = researchModeDefaults.standard;
    expect(standard.type).toBe("deep-reasoning");
    expect(standard.numResults).toBe(50);
    expect(standard.textMaxCharacters).toBe(16000);
    expect(standard.highlightsMaxCharacters).toBe(900);
    expect(standard.highlightNumSentences).toBe(4);
    expect(standard.highlightsPerUrl).toBe(2);
    expect(standard.timeoutSeconds).toBe(600);
    expect(standard.outputSchema).toBeDefined();
  });

  it("full uses deep-reasoning type with 150 results and output schema", () => {
    const full = researchModeDefaults.full;
    expect(full.type).toBe("deep-reasoning");
    expect(full.numResults).toBe(150);
    expect(full.textMaxCharacters).toBe(24000);
    expect(full.highlightsMaxCharacters).toBe(1200);
    expect(full.highlightNumSentences).toBe(5);
    expect(full.highlightsPerUrl).toBe(3);
    expect(full.timeoutSeconds).toBe(1800);
    expect(full.outputSchema).toBeDefined();
  });
});

describe("defaultResearchOutputSchema", () => {
  it("has required fields", () => {
    expect(defaultResearchOutputSchema.required).toContain("executiveSummary");
    expect(defaultResearchOutputSchema.required).toContain("keyFindings");
    expect(defaultResearchOutputSchema.required).toContain("recommendation");
    expect(defaultResearchOutputSchema.required).toContain("risks");
    expect(defaultResearchOutputSchema.required).toContain("revisitConditions");
  });

  it("defines properties for all required fields", () => {
    for (const field of defaultResearchOutputSchema.required) {
      expect(defaultResearchOutputSchema.properties).toHaveProperty(field);
    }
  });

  it("includes optional tradeoffs property", () => {
    expect(defaultResearchOutputSchema.properties).toHaveProperty("tradeoffs");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/research/types.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/research/types.ts`:

```typescript
export type ExaDeepType = "deep-reasoning" | "deep-lite" | "deep";

export type ResearchMode = "lite" | "standard" | "full";

export type ReportFormat = "findings" | "markdown" | "json";

export interface DeepResearchParams {
  query: string;
  type: ExaDeepType;
  numResults?: number;
  textMaxCharacters?: number;
  highlightsMaxCharacters?: number;
  highlightNumSentences?: number;
  highlightsPerUrl?: number;
  summaryQuery?: string;
  maxAgeHours?: number;
  category?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  additionalQueries?: string[];
  systemPrompt?: string;
  outputSchema?: Record<string, unknown>;
}

export interface DeepResearchResult {
  title?: string;
  url?: string;
  text?: string;
  summary?: string;
  highlights?: string[];
  publishedDate?: string;
}

export interface DeepResearchResponse {
  answer?: string;
  results: DeepResearchResult[];
  raw: unknown;
  metadata: Record<string, unknown>;
}

export interface ResearchModeDefaults {
  type: ExaDeepType;
  numResults: number;
  textMaxCharacters: number;
  timeoutSeconds: number;
  highlightsMaxCharacters: number;
  highlightNumSentences: number;
  highlightsPerUrl: number;
  summaryQuery?: string;
  maxAgeHours?: number;
  category?: string;
  outputSchema?: Record<string, unknown>;
}

export const defaultResearchOutputSchema = {
  type: "object" as const,
  required: [
    "executiveSummary",
    "keyFindings",
    "recommendation",
    "risks",
    "revisitConditions",
  ],
  properties: {
    executiveSummary: {
      type: "string",
      description: "Concise source-grounded summary.",
    },
    keyFindings: {
      type: "array",
      items: { type: "string" },
      description: "Important findings with specifics.",
    },
    tradeoffs: {
      type: "array",
      items: { type: "string" },
      description: "Tradeoffs and alternatives.",
    },
    recommendation: {
      type: "string",
      description: "Recommended decision or criteria.",
    },
    risks: {
      type: "array",
      items: { type: "string" },
      description: "Known risks or uncertainties.",
    },
    revisitConditions: {
      type: "array",
      items: { type: "string" },
      description: "Conditions that trigger re-research.",
    },
  },
};

export const researchModeDefaults: Record<ResearchMode, ResearchModeDefaults> =
  {
    lite: {
      type: "deep-lite",
      numResults: 15,
      textMaxCharacters: 10000,
      timeoutSeconds: 300,
      highlightsMaxCharacters: 600,
      highlightNumSentences: 3,
      highlightsPerUrl: 1,
    },
    standard: {
      type: "deep-reasoning",
      numResults: 50,
      textMaxCharacters: 16000,
      timeoutSeconds: 600,
      highlightsMaxCharacters: 900,
      highlightNumSentences: 4,
      highlightsPerUrl: 2,
      summaryQuery:
        "Summarize the source evidence relevant to the research question, preserving concrete facts and tradeoffs.",
      outputSchema: defaultResearchOutputSchema,
    },
    full: {
      type: "deep-reasoning",
      numResults: 150,
      textMaxCharacters: 24000,
      timeoutSeconds: 1800,
      highlightsMaxCharacters: 1200,
      highlightNumSentences: 5,
      highlightsPerUrl: 3,
      summaryQuery:
        "Summarize the source evidence relevant to the research question, emphasizing decision criteria, tradeoffs, risks, and revisit triggers.",
      outputSchema: defaultResearchOutputSchema,
    },
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/research/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/research/types.ts tests/research/types.test.ts
git commit -m "feat(research): add types and mode defaults"
```
