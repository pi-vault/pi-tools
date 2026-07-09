import { describe, expect, it } from "vitest";
import { extractContent } from "../../src/extract/pipeline.ts";
import { SSRFError } from "../../src/utils/ssrf.ts";

describe("extractContent SSRF with allowRanges", () => {
  it("blocks a private IP by default", async () => {
    await expect(extractContent("http://198.18.1.1/page")).rejects.toThrow(
      SSRFError,
    );
  });

  it("allows a private IP when in allowRanges", async () => {
    // Use a short timeout so the network call fails quickly without hanging.
    // The key assertion: SSRF validation passes (no SSRFError) — any other error is fine.
    const signal = AbortSignal.timeout(300);
    const result = extractContent("http://198.18.1.1/page", signal, {
      allowRanges: ["198.18.0.0/15"],
    });
    // Expect a network/abort error, not an SSRFError
    await expect(result).rejects.not.toThrow(SSRFError);
  }, 2000);
});
