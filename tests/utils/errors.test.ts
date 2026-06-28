import { describe, expect, it } from "vitest";
import { sanitizeError } from "../../src/utils/errors.ts";

describe("sanitizeError", () => {
  it("redacts Bearer tokens", () => {
    const msg = "Authorization: Bearer sk-abc123456789xyz";
    expect(sanitizeError(msg)).not.toContain("sk-abc123456789xyz");
    expect(sanitizeError(msg)).toContain("[redacted]");
  });

  it("redacts api_key values", () => {
    const msg = "api_key=supersecretkey123";
    expect(sanitizeError(msg)).not.toContain("supersecretkey123");
    expect(sanitizeError(msg)).toContain("[redacted]");
  });

  it("redacts apiKey values", () => {
    const msg = "apiKey: my-secret-api-key-value";
    expect(sanitizeError(msg)).not.toContain("my-secret-api-key-value");
    expect(sanitizeError(msg)).toContain("[redacted]");
  });

  it("redacts token values", () => {
    const msg = "token=abcdefghijklmnop";
    expect(sanitizeError(msg)).not.toContain("abcdefghijklmnop");
    expect(sanitizeError(msg)).toContain("[redacted]");
  });

  it("redacts secret values", () => {
    const msg = "secret: mysecretvalue123456";
    expect(sanitizeError(msg)).not.toContain("mysecretvalue123456");
    expect(sanitizeError(msg)).toContain("[redacted]");
  });

  it("redacts password values", () => {
    const msg = "password=hunter2ishunter2";
    expect(sanitizeError(msg)).not.toContain("hunter2ishunter2");
    expect(sanitizeError(msg)).toContain("[redacted]");
  });

  it("truncates to 300 chars max", () => {
    const msg = "a".repeat(500);
    expect(sanitizeError(msg).length).toBeLessThanOrEqual(300);
  });

  it("preserves short safe messages", () => {
    const msg = "Network timeout after 30s";
    expect(sanitizeError(msg)).toBe("Network timeout after 30s");
  });

  it("handles Error objects", () => {
    const err = new Error("token=mysecrettoken12345");
    expect(sanitizeError(err)).toContain("[redacted]");
    expect(sanitizeError(err)).not.toContain("mysecrettoken12345");
  });

  it("handles non-string non-Error values", () => {
    expect(sanitizeError(42)).toBe("42");
    expect(sanitizeError(null)).toBe("Unknown error");
    expect(sanitizeError(undefined)).toBe("Unknown error");
  });
});
