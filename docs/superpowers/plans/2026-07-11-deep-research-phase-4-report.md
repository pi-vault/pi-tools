# Deep Research — Phase 4: Report Rendering

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the findings report renderer that produces structured markdown from deep research responses.

**Architecture:** `src/research/report.ts` exports `renderFindingsReport` (produces the markdown report), `defaultRawOutputPath` (derives sidecar path), and `buildRawSidecar` (builds the metadata+raw JSON structure). The renderer handles both structured output (from Exa's outputSchema) and unstructured responses with graceful fallbacks.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-07-11-deep-research-design.md`
**Main plan:** `docs/superpowers/plans/2026-07-11-deep-research.md`
**Reference:** `pi-web-tools/src/tools/web-research.ts` (canonical implementation)

**Depends on:** Phase 1 (`DeepResearchResponse` type), Phase 3 (`WebResearchInput` type)
**Produces:** Tested report renderer ready for the tool's file-writing flow.

---

## Context for the Engineer

The findings report is a structured markdown document with these sections:

1. Title / Research Question
2. Executive Summary (from structured `executiveSummary` or synthesized answer)
3. Key Findings (from structured `keyFindings` or top source snippets)
4. Evidence and Sources (numbered source list + per-source evidence)
5. Tradeoffs / Alternatives
6. Recommendation / Decision Criteria (followed by a guidance paragraph)
7. Risks / Unknowns
8. Revisit Conditions
9. Research Metadata (mode, type, query count, sources)

When Exa returns structured output (via `outputSchema`), the content lives at `response.raw.output.content`. When it doesn't, the renderer falls back to source-derived content.

The `defaultRawOutputPath` function replaces the file extension with `.raw.json` (e.g., `findings.md` -> `findings.raw.json`).

All fallback text must match the pi-web-tools reference exactly. The spec describes this as a "full 1:1 port."

---

### Task 4: Findings report renderer

**Files:**

- Create: `src/research/report.ts`
- Test: `tests/research/report.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/research/report.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  renderFindingsReport,
  defaultRawOutputPath,
  buildRawSidecar,
} from "../../src/research/report.ts";
import type { DeepResearchResponse } from "../../src/research/types.ts";

describe("defaultRawOutputPath", () => {
  it("replaces extension with .raw.json", () => {
    expect(defaultRawOutputPath("/out/findings.md")).toBe(
      "/out/findings.raw.json",
    );
  });

  it("appends .raw.json when no extension", () => {
    expect(defaultRawOutputPath("/out/findings")).toBe(
      "/out/findings.raw.json",
    );
  });
});

describe("buildRawSidecar", () => {
  it("includes metadata and raw response", () => {
    const response: DeepResearchResponse = {
      answer: "test",
      results: [],
      raw: { foo: "bar" },
      metadata: { researchMode: "standard", type: "deep-reasoning" },
    };
    const sidecar = buildRawSidecar(response, "/out/findings.raw.json");
    expect(sidecar.metadata.researchMode).toBe("standard");
    expect(sidecar.metadata.rawOutputPath).toBe("/out/findings.raw.json");
    expect(sidecar.raw).toEqual({ foo: "bar" });
  });
});

describe("renderFindingsReport", () => {
  const baseResponse: DeepResearchResponse = {
    answer: "This is the executive summary.",
    results: [
      {
        title: "Source One",
        url: "https://example.com/1",
        text: "Full text from source one",
        summary: "Source one summary",
        highlights: ["Key highlight"],
        publishedDate: "2025-06-15",
      },
      {
        title: "Source Two",
        url: "https://example.com/2",
        text: "Full text from source two",
      },
    ],
    raw: {},
    metadata: {
      researchMode: "standard",
      type: "deep-reasoning",
      queryCount: 1,
      sourceCount: 2,
      uniqueSourceCount: 2,
    },
  };

  it("includes research question", () => {
    const report = renderFindingsReport({ query: "What is X?" }, baseResponse);
    expect(report).toContain("## Research Question");
    expect(report).toContain("What is X?");
  });

  it("includes executive summary from answer", () => {
    const report = renderFindingsReport({ query: "test" }, baseResponse);
    expect(report).toContain("## Executive Summary");
    expect(report).toContain("This is the executive summary.");
  });

  it("includes evidence and sources section", () => {
    const report = renderFindingsReport({ query: "test" }, baseResponse);
    expect(report).toContain("## Evidence and Sources");
    expect(report).toContain("Source One");
    expect(report).toContain("https://example.com/1");
    expect(report).toContain("2025-06-15");
  });

  it("includes metadata section", () => {
    const report = renderFindingsReport({ query: "test" }, baseResponse);
    expect(report).toContain("## Research Metadata");
    expect(report).toContain("Mode: standard");
    expect(report).toContain("deep-reasoning");
  });

  it("uses reportTitle for heading when provided", () => {
    const report = renderFindingsReport(
      { query: "test", reportTitle: "Custom Title" },
      baseResponse,
    );
    expect(report).toContain("# Findings: Custom Title");
  });

  it("falls back to query for heading", () => {
    const report = renderFindingsReport({ query: "What is X?" }, baseResponse);
    expect(report).toContain("# Findings: What is X?");
  });

  it("renders structured output when present in raw", () => {
    const structured: DeepResearchResponse = {
      ...baseResponse,
      raw: {
        output: {
          content: {
            executiveSummary: "Structured summary",
            keyFindings: ["Finding A", "Finding B"],
            tradeoffs: ["Tradeoff 1"],
            recommendation: "Do X",
            risks: ["Risk 1"],
            revisitConditions: ["Condition 1"],
          },
        },
      },
    };
    const report = renderFindingsReport({ query: "test" }, structured);
    expect(report).toContain("Structured summary");
    expect(report).toContain("Finding A");
    expect(report).toContain("Finding B");
    expect(report).toContain("Tradeoff 1");
    expect(report).toContain("Do X");
    expect(report).toContain("Risk 1");
    expect(report).toContain("Condition 1");
  });

  it("includes recommendation guidance line", () => {
    const report = renderFindingsReport({ query: "test" }, baseResponse);
    expect(report).toContain(
      "Use the source evidence above as decision criteria; validate any project-specific assumptions before irreversible work.",
    );
  });

  it("handles response with no answer gracefully", () => {
    const noAnswer: DeepResearchResponse = {
      ...baseResponse,
      answer: undefined,
    };
    const report = renderFindingsReport({ query: "test" }, noAnswer);
    expect(report).toContain("## Executive Summary");
    expect(report).toContain("Source One");
    expect(report).toContain("strongest source clusters");
  });

  it("handles response with no sources", () => {
    const noSources: DeepResearchResponse = {
      answer: undefined,
      results: [],
      raw: {},
      metadata: { researchMode: "standard" },
    };
    const report = renderFindingsReport({ query: "test" }, noSources);
    expect(report).toContain("Re-run with broader terms or fewer filters");
    expect(report).toContain("No source URLs returned by Exa");
  });

  it("includes rawOutputPath in metadata when provided", () => {
    const report = renderFindingsReport({ query: "test" }, baseResponse, {
      rawOutputPath: "./out.raw.json",
    });
    expect(report).toContain("out.raw.json");
  });

  it("falls back to input researchMode in metadata", () => {
    const noModeResponse: DeepResearchResponse = {
      ...baseResponse,
      metadata: {},
    };
    const report = renderFindingsReport(
      { query: "test", researchMode: "lite" },
      noModeResponse,
    );
    expect(report).toContain("Mode: lite");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/research/report.test.ts`
Expected: FAIL -- module not found

- [ ] **Step 3: Write the implementation**

Create `src/research/report.ts`:

````typescript
import { extname } from "node:path";
import type { DeepResearchResponse } from "./types.ts";
import type { WebResearchInput } from "./prepare.ts";

export function defaultRawOutputPath(outputPath: string): string {
  const ext = extname(outputPath);
  return ext
    ? `${outputPath.slice(0, -ext.length)}.raw.json`
    : `${outputPath}.raw.json`;
}

export interface RawResearchSidecar {
  metadata: Record<string, unknown> & { rawOutputPath?: string };
  raw: unknown;
}

export function buildRawSidecar(
  response: DeepResearchResponse,
  rawOutputPath?: string,
): RawResearchSidecar {
  return {
    metadata: { ...response.metadata, rawOutputPath },
    raw: response.raw,
  };
}

function structuredOutputContent(
  response: DeepResearchResponse,
): Record<string, unknown> | undefined {
  const raw: any = response.raw;
  if (
    raw?.output?.content &&
    typeof raw.output.content === "object" &&
    !Array.isArray(raw.output.content)
  ) {
    return raw.output.content;
  }
  return undefined;
}

function sanitizeEvidenceText(value: string): string {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/g, "")
        .replace(/^\s{0,3}>\s*/g, "")
        .replace(/^\s*```.*$/g, "")
        .trim(),
    )
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function oneLine(value: string, max = 260): string {
  const cleaned = sanitizeEvidenceText(value).replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}\u2026` : cleaned;
}

function resultSnippet(
  result: DeepResearchResponse["results"][number],
  max = 900,
): string {
  return oneLine(
    [result.summary, ...(result.highlights ?? []), result.text]
      .filter(Boolean)
      .join(" "),
    max,
  );
}

function listMarkdown(value: unknown, fallback: string): string {
  if (Array.isArray(value) && value.length) {
    return value
      .map(
        (item) =>
          `- ${sanitizeEvidenceText(typeof item === "string" ? item : JSON.stringify(item))}`,
      )
      .join("\n");
  }
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

function isGenericNoAnswer(value: string | undefined): boolean {
  return (
    !value?.trim() ||
    /Exa returned (sources|\d+ sources) but no synthesized answer field/i.test(
      value,
    )
  );
}

function fallbackSummary(response: DeepResearchResponse): string {
  if (!isGenericNoAnswer(response.answer)) return response.answer!.trim();
  if (response.results.length === 0)
    return "No sources were returned. Re-run with broader terms or fewer filters before making a decision.";
  const themes = response.results
    .slice(0, 5)
    .map((r, i) => `(${i + 1}) ${r.title ?? r.url ?? "Untitled"}`)
    .join("; ");
  return `Exa returned ${response.results.length} sources but no synthesized answer field. The strongest source clusters are: ${themes}. Treat the findings below as an evidence brief and validate recommendations against primary sources before committing.`;
}

function keyFindings(response: DeepResearchResponse): string {
  if (!isGenericNoAnswer(response.answer)) return response.answer!.trim();
  if (response.results.length === 0)
    return "- No source-backed findings were returned.";
  return response.results
    .slice(0, 8)
    .map(
      (r, i) =>
        `- [${i + 1}] ${r.title ?? r.url ?? "Untitled"}: ${resultSnippet(r, 260) || "Review source directly."}`,
    )
    .join("\n");
}

function bulletSources(response: DeepResearchResponse): string {
  if (response.results.length === 0) return "- No source URLs returned by Exa.";
  return response.results
    .map(
      (r, i) =>
        `- [${i + 1}] ${r.title ?? r.url ?? "Untitled"}${r.url ? ` \u2014 ${r.url}` : ""}${r.publishedDate ? ` (${r.publishedDate})` : ""}`,
    )
    .join("\n");
}

export function renderFindingsReport(
  input: Pick<WebResearchInput, "query" | "reportTitle" | "researchMode" | "type">,
  response: DeepResearchResponse,
  options: { rawOutputPath?: string } = {},
): string {
  const title = input.reportTitle || input.query;
  const structured = structuredOutputContent(response);

  const answer =
    typeof structured?.executiveSummary === "string"
      ? structured.executiveSummary.trim()
      : fallbackSummary(response);

  const findings = structured
    ? listMarkdown(
        structured.keyFindings ?? structured.findings,
        keyFindings(response),
      )
    : keyFindings(response);

  const tradeoffs = structured
    ? listMarkdown(
        structured.tradeoffs,
        "- Compare benefits against implementation cost, operational risk, and project-specific constraints before committing.\n- Prefer primary-source documentation and current release notes when evidence conflicts.",
      )
    : "- Compare benefits against implementation cost, operational risk, and project-specific constraints before committing.\n- Prefer primary-source documentation and current release notes when evidence conflicts.";

  const recommendation =
    typeof structured?.recommendation === "string" &&
    structured.recommendation.trim()
      ? structured.recommendation.trim()
      : answer;

  const risks = structured
    ? listMarkdown(
        structured.risks,
        "- Verify source freshness and applicability to this project.\n- Re-run research if provider APIs, pricing, or release notes change.\n- Treat uncited or snippet-only claims as hypotheses until confirmed by primary sources.",
      )
    : "- Verify source freshness and applicability to this project.\n- Re-run research if provider APIs, pricing, or release notes change.\n- Treat uncited or snippet-only claims as hypotheses until confirmed by primary sources.";

  const revisit = structured
    ? listMarkdown(
        structured.revisitConditions,
        "- New primary-source documentation contradicts these findings.\n- Implementation constraints differ from the context supplied to research.\n- Exa Deep Search returns materially different source coverage in a later run.",
      )
    : "- New primary-source documentation contradicts these findings.\n- Implementation constraints differ from the context supplied to research.\n- Exa Deep Search returns materially different source coverage in a later run.";

  const evidence = response.results
    .map((r, i) => {
      const snippet = sanitizeEvidenceText(resultSnippet(r, 1200))
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      return `### [${i + 1}] ${r.title ?? r.url ?? "Untitled"}\n\n${r.url ?? ""}\n\n${snippet || "> No snippet returned."}`;
    })
    .join("\n\n");

  const metadata = [
    `- Mode: ${response.metadata.researchMode ?? input.researchMode ?? "standard"}`,
    `- Exa type: ${response.metadata.type ?? input.type ?? "deep-reasoning"}`,
    `- Queries: ${response.metadata.queryCount ?? 1}`,
    `- Sources: ${response.metadata.uniqueSourceCount ?? response.results.length} unique${response.metadata.sourceCount && response.metadata.sourceCount !== response.results.length ? ` (${response.metadata.sourceCount} returned before dedupe)` : ""}`,
    options.rawOutputPath
      ? `- Raw metadata sidecar: ${options.rawOutputPath}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");

  return `# Findings: ${title}\n\n## Research Question\n\n${input.query}\n\n## Executive Summary\n\n${answer}\n\n## Key Findings\n\n${findings}\n\n## Evidence and Sources\n\n${bulletSources(response)}\n\n${evidence}\n\n## Tradeoffs / Alternatives\n\n${tradeoffs}\n\n## Recommendation / Decision Criteria\n\n${recommendation}\n\nUse the source evidence above as decision criteria; validate any project-specific assumptions before irreversible work.\n\n## Risks / Unknowns\n\n${risks}\n\n## Revisit Conditions\n\n${revisit}\n\n## Research Metadata\n\n${metadata}\n`;
}
````

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/research/report.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/research/report.ts tests/research/report.test.ts
git commit -m "feat(research): add findings report renderer"
```
