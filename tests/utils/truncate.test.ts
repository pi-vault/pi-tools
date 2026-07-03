import { describe, expect, it } from "vitest";
import { truncateContent } from "../../src/utils/truncate.ts";

const INLINE_LIMIT = 15_000;

describe("truncateContent", () => {
  it("returns original text when under limit", () => {
    const result = truncateContent("short text", INLINE_LIMIT);
    expect(result).toBe("short text");
  });

  it("truncates and appends notice when over limit", () => {
    const long = "a".repeat(INLINE_LIMIT + 1000);
    const result = truncateContent(long, INLINE_LIMIT);
    expect(result.length).toBeLessThanOrEqual(INLINE_LIMIT);
    expect(result).toContain("[truncated]");
  });

  it("includes original char count in notice", () => {
    const text = "a".repeat(20_000);
    const result = truncateContent(text, INLINE_LIMIT);
    expect(result).toContain("20000 chars");
  });
});
