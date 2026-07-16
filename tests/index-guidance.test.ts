import { describe, expect, it } from "vitest";
import { buildAugmentedGuidance } from "../src/utils/capabilities.ts";
import type { GuidanceOverride } from "../src/config.ts";

describe("buildAugmentedGuidance", () => {
  it("appends gh guideline when hasGhCli is true", () => {
    const base: GuidanceOverride = {
      promptGuidelines: ["Use web_fetch when you have a specific URL to read."],
    };
    const caps = { hasGhCli: true, hasYtDlp: false, hasFfmpeg: false };

    const result = buildAugmentedGuidance(base, caps);

    expect(result.promptGuidelines).toHaveLength(2);
    expect(result.promptGuidelines![1]).toContain("gh");
  });

  it("appends yt-dlp and ffmpeg guidelines when available", () => {
    const caps = { hasGhCli: false, hasYtDlp: true, hasFfmpeg: true };

    const result = buildAugmentedGuidance(undefined, caps);

    expect(result.promptGuidelines).toHaveLength(2);
    expect(result.promptGuidelines!.some((g) => g.includes("yt-dlp"))).toBe(true);
    expect(result.promptGuidelines!.some((g) => g.includes("ffmpeg"))).toBe(true);
  });

  it("returns base guidance unchanged when no capabilities detected", () => {
    const base: GuidanceOverride = {
      promptSnippet: "Custom snippet",
      promptGuidelines: ["Custom guideline"],
    };
    const caps = { hasGhCli: false, hasYtDlp: false, hasFfmpeg: false };

    const result = buildAugmentedGuidance(base, caps);

    expect(result.promptSnippet).toBe("Custom snippet");
    expect(result.promptGuidelines).toEqual(["Custom guideline"]);
  });

  it("returns undefined promptGuidelines when no base and no capabilities", () => {
    const caps = { hasGhCli: false, hasYtDlp: false, hasFfmpeg: false };

    const result = buildAugmentedGuidance(undefined, caps);

    expect(result.promptGuidelines).toBeUndefined();
  });
});
