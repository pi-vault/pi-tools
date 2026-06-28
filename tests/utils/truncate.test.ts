import { describe, expect, it } from "vitest";
import { truncateContent } from "../../src/utils/truncate.ts";

const INLINE_LIMIT = 15_000;

describe("truncateContent", () => {
  it("returns content as-is when under limit", () => {
    const result = truncateContent("short text", INLINE_LIMIT);
    expect(result.text).toBe("short text");
    expect(result.truncated).toBe(false);
  });

  it("truncates content over the limit", () => {
    const long = "a".repeat(INLINE_LIMIT + 1000);
    const result = truncateContent(long, INLINE_LIMIT);
    expect(result.text.length).toBeLessThanOrEqual(INLINE_LIMIT);
    expect(result.truncated).toBe(true);
  });

  it("appends truncation notice when truncated", () => {
    const long = "a".repeat(INLINE_LIMIT + 1000);
    const result = truncateContent(long, INLINE_LIMIT);
    expect(result.text).toContain("[truncated]");
  });

  it("reports original character count", () => {
    const text = "a".repeat(20_000);
    const result = truncateContent(text, INLINE_LIMIT);
    expect(result.originalChars).toBe(20_000);
  });
});
