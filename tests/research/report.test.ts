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
    expect(report).toContain(
      "- [1] Source One \u2014 https://example.com/1 (2025-06-15)",
    );
    expect(report).toContain("- [2] Source Two \u2014 https://example.com/2");
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
