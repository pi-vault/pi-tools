import { describe, expect, it } from "vitest";
import createExtension from "../src/index.ts";

describe("tools extension", () => {
  it("exports a function", () => {
    expect(typeof createExtension).toBe("function");
  });
});
