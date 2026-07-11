# Deep Research — Phase 3: Input Preparation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement query/context file resolution, mode application with config overrides, and input preparation for the research tool.

**Architecture:** `src/research/prepare.ts` exports utilities for resolving paths (stripping `@` prefix, absolutifying), expanding simple globs, applying research mode defaults with three-layer resolution (per-call > config > built-in), and preparing the full research input (reading queryFile, building system prompt with context).

**Tech Stack:** TypeScript, Vitest, `node:fs/promises` (mocked in tests)

**Spec:** `docs/superpowers/specs/2026-07-11-deep-research-design.md`
**Main plan:** `docs/superpowers/plans/2026-07-11-deep-research.md`

**Depends on:** Phase 1 (`src/research/types.ts` — `researchModeDefaults`, `ResearchMode`, `ResearchModeDefaults`)
**Produces:** Tested input preparation module ready for the tool's execute function.

---

## Context for the Engineer

The `prepareResearchInput` function is called by the tool's `execute` at the start. It:

1. Resolves the query (from `query` string or `queryFile` path)
2. Resolves context files (explicit `contextFiles` array + `contextGlob` expansion)
3. Reads context file contents and appends them to the system prompt
4. Returns the prepared input with a guaranteed `query` and `systemPrompt`

The `applyResearchMode` function merges mode defaults from three layers:

- Per-call params (highest priority)
- Config `modeDefaults` (from `tools.json` deepResearch section)
- Built-in defaults from `researchModeDefaults` (lowest priority)

Path resolution: all paths can be absolute or relative to `ctx.cwd`. A leading `@` character is stripped (convention from pi-web-tools for file references).

---

### Task 3: Prepare research input

**Files:**

- Create: `src/research/prepare.ts`
- Test: `tests/research/prepare.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/research/prepare.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as fs from "node:fs/promises";
import {
  prepareResearchInput,
  applyResearchMode,
  resolveOutputPath,
  expandSimpleGlob,
  MAX_CONTEXT_FILES,
} from "../../src/research/prepare.ts";
import { researchModeDefaults } from "../../src/research/types.ts";

vi.mock("node:fs/promises");

describe("resolveOutputPath", () => {
  it("resolves relative path against cwd", () => {
    expect(resolveOutputPath("/project", "findings.md")).toMatch(
      /\/project\/findings.md$/,
    );
  });

  it("returns absolute path unchanged", () => {
    expect(resolveOutputPath("/project", "/tmp/out.md")).toBe("/tmp/out.md");
  });

  it("strips leading @ from path", () => {
    expect(resolveOutputPath("/project", "@docs/out.md")).toMatch(
      /\/project\/docs\/out.md$/,
    );
  });
});

describe("applyResearchMode", () => {
  it("returns lite defaults for lite mode", () => {
    const result = applyResearchMode({ researchMode: "lite" });
    expect(result.type).toBe("deep-lite");
    expect(result.numResults).toBe(15);
    expect(result.textMaxCharacters).toBe(10000);
    expect(result.timeoutSeconds).toBe(300);
  });

  it("returns standard defaults for standard mode", () => {
    const result = applyResearchMode({ researchMode: "standard" });
    expect(result.type).toBe("deep-reasoning");
    expect(result.numResults).toBe(50);
    expect(result.outputSchema).toBeDefined();
  });

  it("defaults to standard when researchMode not specified", () => {
    const result = applyResearchMode({});
    expect(result.type).toBe("deep-reasoning");
    expect(result.numResults).toBe(50);
  });

  it("per-call params override mode defaults", () => {
    const result = applyResearchMode({
      researchMode: "standard",
      numResults: 30,
      textMaxCharacters: 8000,
      type: "deep-lite",
    });
    expect(result.type).toBe("deep-lite");
    expect(result.numResults).toBe(30);
    expect(result.textMaxCharacters).toBe(8000);
  });

  it("config modeDefaults override built-in defaults", () => {
    const configDefaults = {
      standard: { numResults: 60, textMaxCharacters: 20000 },
    };
    const result = applyResearchMode(
      { researchMode: "standard" },
      configDefaults,
    );
    expect(result.numResults).toBe(60);
    expect(result.textMaxCharacters).toBe(20000);
  });

  it("per-call params override config modeDefaults", () => {
    const configDefaults = { standard: { numResults: 60 } };
    const result = applyResearchMode(
      { researchMode: "standard", numResults: 25 },
      configDefaults,
    );
    expect(result.numResults).toBe(25);
  });

  it("throws on invalid research mode", () => {
    expect(() => applyResearchMode({ researchMode: "invalid" as any })).toThrow(
      /invalid/i,
    );
  });
});

describe("expandSimpleGlob", () => {
  it("returns single path when no wildcard", async () => {
    const result = await expandSimpleGlob("/project", "docs/file.md");
    expect(result).toEqual(["/project/docs/file.md"]);
  });

  it("expands wildcard in filename", async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: "context-01.md", isFile: () => true },
      { name: "context-02.md", isFile: () => true },
      { name: "other.txt", isFile: () => true },
    ] as any);
    const result = await expandSimpleGlob("/project", "docs/context-*.md");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatch(/context-01\.md$/);
    expect(result[1]).toMatch(/context-02\.md$/);
  });

  it("throws when glob matches exceed limit", async () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      name: `file-${i}.md`,
      isFile: () => true,
    }));
    vi.mocked(fs.readdir).mockResolvedValue(entries as any);
    await expect(
      expandSimpleGlob("/project", "docs/file-*.md"),
    ).rejects.toThrow(/limit/);
  });

  it("throws on multiple wildcards", async () => {
    await expect(expandSimpleGlob("/project", "docs/*/*.md")).rejects.toThrow(
      /one '\*' wildcard/,
    );
  });
});

describe("prepareResearchInput", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses query directly when provided", async () => {
    const result = await prepareResearchInput("/project", {
      query: "What is X?",
    });
    expect(result.query).toBe("What is X?");
  });

  it("reads query from queryFile", async () => {
    vi.mocked(fs.readFile).mockResolvedValue("Question from file");
    const result = await prepareResearchInput("/project", {
      queryFile: "question.txt",
    });
    expect(result.query).toBe("Question from file");
  });

  it("throws when neither query nor queryFile provided", async () => {
    await expect(prepareResearchInput("/project", {})).rejects.toThrow(
      /requires query or queryFile/,
    );
  });

  it("appends context files to system prompt", async () => {
    vi.mocked(fs.readFile).mockImplementation(async (path) => {
      if (String(path).includes("question")) return "My question";
      return "Context content here";
    });
    const result = await prepareResearchInput("/project", {
      query: "test",
      contextFiles: ["context.md"],
    });
    expect(result.systemPrompt).toContain("Context content here");
    expect(result.systemPrompt).toContain("---");
  });

  it("uses default system prompt when no custom one provided", async () => {
    const result = await prepareResearchInput("/project", { query: "test" });
    expect(result.systemPrompt).toContain("evidence-backed");
  });

  it("uses custom system prompt when provided", async () => {
    const result = await prepareResearchInput("/project", {
      query: "test",
      systemPrompt: "Custom instructions",
    });
    expect(result.systemPrompt).toBe("Custom instructions");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/research/prepare.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/research/prepare.ts`:

```typescript
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  researchModeDefaults,
  type ResearchMode,
  type ResearchModeDefaults,
} from "./types.ts";

export const MAX_CONTEXT_FILES = 25;

export interface WebResearchInput {
  query?: string;
  queryFile?: string;
  contextFiles?: string[];
  contextGlob?: string;
  researchMode?: ResearchMode;
  type?: string;
  systemPrompt?: string;
  additionalQueries?: string[];
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
  outputSchema?: Record<string, unknown>;
  outputPath?: string;
  reportTitle?: string;
  reportFormat?: string;
  rawOutputPath?: string;
}

type ModeDefaultOverrides = Partial<
  Record<ResearchMode, Partial<ResearchModeDefaults>>
>;

function cleanPath(p: string): string {
  return p.startsWith("@") ? p.slice(1) : p;
}

export function resolveOutputPath(cwd: string, rawPath: string): string {
  const cleaned = cleanPath(rawPath.trim());
  return isAbsolute(cleaned) ? cleaned : resolve(cwd, cleaned);
}

export async function expandSimpleGlob(
  cwd: string,
  rawGlob: string,
  limit = MAX_CONTEXT_FILES,
): Promise<string[]> {
  const cleaned = cleanPath(rawGlob.trim());
  if (!cleaned.includes("*")) return [resolveOutputPath(cwd, cleaned)];

  const normalized = cleaned.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const dirPart = slash >= 0 ? normalized.slice(0, slash) : ".";
  const basePattern = slash >= 0 ? normalized.slice(slash + 1) : normalized;

  if (basePattern.split("*").length > 2) {
    throw new Error(
      `contextGlob supports one '*' wildcard in the file name: ${rawGlob}`,
    );
  }

  const [prefix, suffix] = basePattern.split("*") as [string, string];
  const dir = resolveOutputPath(cwd, dirPart);
  const entries = await readdir(dir, { withFileTypes: true });
  const matches = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(prefix) &&
        entry.name.endsWith(suffix),
    )
    .map((entry) => join(dir, entry.name))
    .sort();

  if (matches.length > limit) {
    throw new Error(
      `contextGlob matched ${matches.length} files; limit is ${limit}: ${rawGlob}`,
    );
  }
  return matches;
}

export function applyResearchMode(
  input: Pick<
    WebResearchInput,
    | "researchMode"
    | "type"
    | "numResults"
    | "textMaxCharacters"
    | "highlightsMaxCharacters"
    | "highlightNumSentences"
    | "highlightsPerUrl"
    | "summaryQuery"
    | "maxAgeHours"
    | "category"
    | "outputSchema"
  >,
  configDefaults?: ModeDefaultOverrides,
) {
  const researchMode: ResearchMode =
    (input.researchMode as ResearchMode) ?? "standard";
  const defaults = researchModeDefaults[researchMode];
  if (!defaults) {
    throw new Error(
      `Invalid researchMode '${researchMode}'. Expected one of: lite, standard, full.`,
    );
  }
  const profile = configDefaults?.[researchMode] ?? {};

  return {
    researchMode,
    type: input.type ?? profile.type ?? defaults.type,
    numResults: input.numResults ?? profile.numResults ?? defaults.numResults,
    textMaxCharacters:
      input.textMaxCharacters ??
      profile.textMaxCharacters ??
      defaults.textMaxCharacters,
    timeoutSeconds: profile.timeoutSeconds ?? defaults.timeoutSeconds,
    highlightsMaxCharacters:
      input.highlightsMaxCharacters ??
      profile.highlightsMaxCharacters ??
      defaults.highlightsMaxCharacters,
    highlightNumSentences:
      input.highlightNumSentences ??
      profile.highlightNumSentences ??
      defaults.highlightNumSentences,
    highlightsPerUrl:
      input.highlightsPerUrl ??
      profile.highlightsPerUrl ??
      defaults.highlightsPerUrl,
    summaryQuery:
      input.summaryQuery ?? profile.summaryQuery ?? defaults.summaryQuery,
    maxAgeHours:
      input.maxAgeHours ?? profile.maxAgeHours ?? defaults.maxAgeHours,
    category: input.category ?? profile.category ?? defaults.category,
    outputSchema:
      input.outputSchema ?? profile.outputSchema ?? defaults.outputSchema,
  };
}

async function resolveContextPaths(
  cwd: string,
  params: WebResearchInput,
): Promise<string[]> {
  const explicit = (params.contextFiles ?? []).map((p) =>
    resolveOutputPath(cwd, p),
  );
  const globbed = params.contextGlob
    ? await expandSimpleGlob(cwd, params.contextGlob)
    : [];
  return Array.from(new Set([...explicit, ...globbed])).sort();
}

const DEFAULT_SYSTEM_PROMPT =
  "You are producing an evidence-backed research findings report. Prioritize primary sources, current documentation, tradeoffs, risks, and concrete revisit conditions. Include source URLs for material claims when Exa returns citations.";

export async function prepareResearchInput(
  cwd: string,
  params: WebResearchInput,
): Promise<WebResearchInput & { query: string; systemPrompt: string }> {
  let query = params.query?.trim() ?? "";
  if (params.queryFile) {
    query = (
      await readFile(resolveOutputPath(cwd, params.queryFile), "utf8")
    ).trim();
  }
  if (!query) throw new Error("web_research requires query or queryFile.");

  const contextPaths = await resolveContextPaths(cwd, params);
  const contextParts: string[] = [];
  for (const p of contextPaths) {
    contextParts.push(`Context from ${p}:\n${await readFile(p, "utf8")}`);
  }

  const basePrompt = params.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
  const systemPrompt = contextParts.length
    ? [basePrompt, ...contextParts].join("\n\n---\n\n")
    : basePrompt;

  return { ...params, query, systemPrompt };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/research/prepare.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/research/prepare.ts tests/research/prepare.test.ts
git commit -m "feat(research): add input preparation and mode resolution"
```
