import { describe, expect, it } from "vitest";
import {
  researchModeDefaults,
  defaultResearchOutputSchema,
} from "../../src/research/types.ts";

describe("researchModeDefaults", () => {
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
