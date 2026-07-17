import { afterEach, describe, expect, it, vi } from "vitest";
import * as configModule from "../../src/config.ts";
import { extractContent } from "../../src/extract/pipeline.ts";
import { SSRFError } from "../../src/utils/ssrf.ts";

describe("extractContent SSRF with allowRanges", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks a private IP by default", async () => {
    await expect(extractContent("http://198.18.1.1/page")).rejects.toThrow(SSRFError);
  });

  it("allows a private IP when in allowRanges", async () => {
    // Use a short timeout so the network call fails quickly without hanging.
    // The key assertion: SSRF validation passes (no SSRFError) — any other error is fine.
    const config = configModule.loadMergedConfig(process.cwd());
    vi.spyOn(configModule, "loadMergedConfig").mockReturnValue({
      ...config,
      ssrf: { allowRanges: ["198.18.0.0/15"] },
    });

    const signal = AbortSignal.timeout(300);
    const result = extractContent("http://198.18.1.1/page", signal);
    // Should reject with a network/abort error, never SSRFError
    await expect(result).rejects.toSatisfy((err) => !(err instanceof SSRFError));
  }, 2000);
});
