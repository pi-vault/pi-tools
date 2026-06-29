import { describe, expect, it } from "vitest";
import { extractPdf } from "../../src/extract/pdf.ts";

describe("extractPdf", () => {
  it("exports extractPdf function", () => {
    expect(typeof extractPdf).toBe("function");
  });

  it("rejects an empty buffer", async () => {
    const emptyBuffer = new Uint8Array(0);
    await expect(extractPdf(emptyBuffer)).rejects.toThrow();
  });
});
