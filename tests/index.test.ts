import { describe, expect, it } from "vitest";
import createExtension from "../src/index.ts";
import { createMockPi } from "./helpers.ts";

describe("tools extension", () => {
  it("exports a function", () => {
    expect(typeof createExtension).toBe("function");
  });

  it("registers web_search tool", () => {
    const pi = createMockPi();
    // biome-ignore lint/suspicious/noExplicitAny: MockPi satisfies ExtensionAPI at runtime
    createExtension(pi as any);
    expect(pi.tools.some((t) => t.name === "web_search")).toBe(true);
  });
});
